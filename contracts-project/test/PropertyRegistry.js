const { expect } = require("chai");
const { ethers } = require("hardhat");
const crypto = require("crypto");

function hashPair(a, b) {
  const [first, second] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([first, second]));
}

function makeLeafFromBytes(rawBytes) {
  const sha256Hex = "0x" + crypto.createHash("sha256").update(rawBytes).digest("hex");
  return ethers.keccak256(sha256Hex);
}

function buildMerkleTree(leaves) {
  if (leaves.length === 0) throw new Error("Empty leaves");
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) next.push(hashPair(current[i], current[i + 1]));
      else next.push(current[i]); // Promote an unpaired odd node unchanged.
    }
    levels.push(next);
  }
  return levels;
}

function getProof(levels, index) {
  const proof = [];
  let idx = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const current = levels[level];
    const siblingIdx = idx % 2 === 1 ? idx - 1 : idx + 1;
    if (siblingIdx < current.length) proof.push(current[siblingIdx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

describe("PropertyRegistry", function () {
  let registry;
  let admin, verifier, host, stranger;

  const fp1 = ethers.keccak256(ethers.toUtf8Bytes("property-1"));
  const fpUnknown = ethers.keccak256(ethers.toUtf8Bytes("unknown-property"));
  const metaHash1 = ethers.keccak256(ethers.toUtf8Bytes('{"schema_version":1}'));
  const metaHash2 = ethers.keccak256(ethers.toUtf8Bytes('{"schema_version":1,"n":2}'));

  beforeEach(async function () {
    [admin, verifier, host, stranger] = await ethers.getSigners();
    const PropertyRegistry = await ethers.getContractFactory("PropertyRegistry");
    registry = await PropertyRegistry.deploy(admin.address, verifier.address);
    await registry.waitForDeployment();
  });

  it("registers a property and emits PropertyRegistered", async function () {
    await expect(registry.connect(verifier).registerProperty(fp1, host.address))
      .to.emit(registry, "PropertyRegistered").withArgs(fp1, host.address);

    const [registered, active, lastVerifiedAt, count] = await registry.getStatus(fp1);
    expect(registered).to.equal(true);
    expect(active).to.equal(true);
    expect(lastVerifiedAt).to.equal(0n);
    expect(count).to.equal(0n);
  });

  it("reverts on duplicate property registration", async function () {
    await registry.connect(verifier).registerProperty(fp1, host.address);
    await expect(registry.connect(verifier).registerProperty(fp1, host.address))
      .to.be.revertedWith("Property already registered");
  });

  it("restricts registration, verification, and deactivation to verifiers", async function () {
    await expect(registry.connect(stranger).registerProperty(fp1, host.address)).to.be.reverted;
    await registry.connect(verifier).registerProperty(fp1, host.address);
    await expect(registry.connect(stranger).submitVerification(fp1, metaHash1, metaHash1)).to.be.reverted;
    await expect(registry.connect(stranger).deactivateProperty(fp1)).to.be.reverted;
  });

  it("rejects verification and deactivation for unknown properties", async function () {
    await expect(registry.connect(verifier).submitVerification(fpUnknown, metaHash1, metaHash1))
      .to.be.revertedWith("Unknown property");
    await expect(registry.connect(verifier).deactivateProperty(fpUnknown))
      .to.be.revertedWith("Unknown property");
  });

  it("rejects verification for inactive properties", async function () {
    await registry.connect(verifier).registerProperty(fp1, host.address);
    await expect(registry.connect(verifier).deactivateProperty(fp1))
      .to.emit(registry, "PropertyDeactivated").withArgs(fp1);
    const [, active] = await registry.getStatus(fp1);
    expect(active).to.equal(false);
    await expect(registry.connect(verifier).submitVerification(fp1, metaHash1, metaHash1))
      .to.be.revertedWith("Property inactive");
  });

  it("appends records and preserves earlier verification history", async function () {
    await registry.connect(verifier).registerProperty(fp1, host.address);
    const root1 = ethers.keccak256(ethers.toUtf8Bytes("root-1"));
    const root2 = ethers.keccak256(ethers.toUtf8Bytes("root-2"));

    await expect(registry.connect(verifier).submitVerification(fp1, root1, metaHash1))
      .to.emit(registry, "PropertyVerified");
    await expect(registry.connect(verifier).submitVerification(fp1, root2, metaHash2))
      .to.emit(registry, "PropertyVerified");

    const [, , lastVerifiedAt, count] = await registry.getStatus(fp1);
    expect(count).to.equal(2n);
    expect(lastVerifiedAt).to.be.gt(0n);

    const rec0 = await registry.getVerification(fp1, 0);
    const rec1 = await registry.getVerification(fp1, 1);
    expect(rec0.merkleRoot).to.equal(root1);
    expect(rec0.metadataHash).to.equal(metaHash1);
    expect(rec1.merkleRoot).to.equal(root2);
    expect(rec1.metadataHash).to.equal(metaHash2);
  });

  it("rejects out-of-range verification reads", async function () {
    await registry.connect(verifier).registerProperty(fp1, host.address);
    await expect(registry.getVerification(fp1, 0)).to.be.revertedWith("Invalid verification index");
  });

  it("verifies valid odd-leaf Merkle proofs and rejects invalid proofs", async function () {
    await registry.connect(verifier).registerProperty(fp1, host.address);

    const leaves = [
      makeLeafFromBytes(Buffer.from("bathroom-photo-bytes")),
      makeLeafFromBytes(Buffer.from("bedroom-photo-bytes")),
      makeLeafFromBytes(Buffer.from("living_room-photo-bytes"))
    ];
    const levels = buildMerkleTree(leaves);
    const root = levels[levels.length - 1][0];
    await registry.connect(verifier).submitVerification(fp1, root, metaHash1);

    for (let i = 0; i < leaves.length; i++) {
      expect(await registry.verifyPhoto(fp1, 0, getProof(levels, i), leaves[i])).to.equal(true);
    }

    const fakeLeaf = makeLeafFromBytes(Buffer.from("tampered-photo-bytes"));
    expect(await registry.verifyPhoto(fp1, 0, getProof(levels, 0), fakeLeaf)).to.equal(false);
    expect(await registry.verifyPhoto(fp1, 0, getProof(levels, 1), leaves[0])).to.equal(false);
    await expect(registry.verifyPhoto(fp1, 1, getProof(levels, 0), leaves[0]))
      .to.be.revertedWith("Invalid verification index");
  });
});
