const { ethers } = require('ethers');

/**
 * Ensures a 32-byte hex string is formatted as 0x + 64 lowercase hex characters.
 */
function normalizeBytes32(hexStr) {
  const clean = String(hexStr || '').replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`Expected 32-byte hex string, got '${hexStr}'`);
  }
  return '0x' + clean;
}

/**
 * Computes leaf = keccak256(photo_sha256 as 32 raw bytes).
 */
function makeLeaf(photoSha256Hex) {
  return ethers.keccak256(normalizeBytes32(photoSha256Hex));
}

/**
 * OpenZeppelin MerkleProof sorted-pair internal node:
 * keccak256(min(a, b) || max(a, b))
 */
function hashPair(a, b) {
  const normA = normalizeBytes32(a);
  const normB = normalizeBytes32(b);
  const [first, second] = BigInt(normA) <= BigInt(normB) ? [normA, normB] : [normB, normA];
  return ethers.keccak256(ethers.concat([first, second]));
}

/**
 * Builds all Merkle tree levels from leaves (level 0) up to [root].
 * Odd unpaired nodes are promoted unchanged to the next level.
 */
function buildMerkleTree(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error('Cannot build Merkle tree with zero leaves.');
  }
  const levels = [leaves.map(normalizeBytes32)];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(hashPair(current[i], current[i + 1]));
      } else {
        next.push(current[i]);
      }
    }
    levels.push(next);
  }
  return levels;
}

/**
 * Returns 0x-prefixed 32-byte Merkle root.
 */
function getMerkleRoot(leaves) {
  const levels = buildMerkleTree(leaves);
  return levels[levels.length - 1][0];
}

/**
 * Generates sibling Merkle proof for leaves[index].
 */
function getMerkleProof(leaves, index) {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`Leaf index ${index} out of range.`);
  }
  const levels = buildMerkleTree(leaves);
  const proof = [];
  let idx = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const current = levels[level];
    const siblingIdx = idx % 2 === 1 ? idx - 1 : idx + 1;
    if (siblingIdx < current.length) {
      proof.push(current[siblingIdx]);
    }
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * Off-chain sorted-pair Merkle proof check matching OpenZeppelin MerkleProof.verify.
 */
function verifyMerkleProof(leaf, proof, root) {
  let computed = normalizeBytes32(leaf);
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed === normalizeBytes32(root);
}

/**
 * Sorts photos ascending by viewLabel as plain strings and computes leaves.
 * Returns { labels, leaves, sortedPhotos }.
 */
function buildLeavesForPhotos(photos) {
  const sortedPhotos = [...photos].sort((a, b) =>
    a.viewLabel < b.viewLabel ? -1 : a.viewLabel > b.viewLabel ? 1 : 0
  );
  const labels = sortedPhotos.map((p) => p.viewLabel);
  const leaves = sortedPhotos.map((p) => makeLeaf(p.sha256));
  return { labels, leaves, sortedPhotos };
}

/**
 * Computes canonical metadata hash:
 * keccak256(UTF-8 bytes of canonical JSON with sorted keys and no whitespace).
 * Keys: merkle_root, nonce, photo_count, property_id, schema_version, server_timestamp, session_id.
 */
function computeMetadataHash({
  propertyId,
  sessionId,
  nonce,
  serverTimestamp,
  photoCount,
  merkleRoot,
}) {
  // Keys strictly in alphabetical order matching ARCHITECTURE.md Section 5
  const canonicalPayload = {
    merkle_root: String(merkleRoot),
    nonce: String(nonce),
    photo_count: Number(photoCount),
    property_id: String(propertyId),
    schema_version: 1,
    server_timestamp: String(serverTimestamp),
    session_id: String(sessionId),
  };
  const canonicalJson = JSON.stringify(canonicalPayload);
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalJson));
}

module.exports = {
  normalizeBytes32,
  makeLeaf,
  hashPair,
  buildMerkleTree,
  getMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  buildLeavesForPhotos,
  computeMetadataHash,
};
