const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { getConfig } = require('../config');

const ABI_PATH = path.resolve(__dirname, '../contract_abi.json');
let cachedAbi = null;

function getAbi() {
  if (!cachedAbi) {
    cachedAbi = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
  }
  return cachedAbi;
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.contractAddress && cfg.rpcUrl && cfg.backendPrivateKey);
}

function getProviderAndContract({ readOnly = false } = {}) {
  const cfg = getConfig();
  if (!cfg.contractAddress) {
    throw new Error('CONTRACT_ADDRESS is not configured.');
  }
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  if (readOnly) {
    const contract = new ethers.Contract(cfg.contractAddress, getAbi(), provider);
    return { provider, contract };
  }
  if (!cfg.backendPrivateKey) {
    throw new Error('BACKEND_PRIVATE_KEY is not configured.');
  }
  const signer = new ethers.Wallet(cfg.backendPrivateKey, provider);
  const contract = new ethers.Contract(cfg.contractAddress, getAbi(), signer);
  return { provider, signer, contract };
}

/**
 * Registers a property fingerprint on PropertyRegistry.sol.
 * Returns txHash string.
 */
async function registerProperty(fingerprint, hostWalletAddress) {
  const { contract } = getProviderAndContract();
  const hostAddr =
    hostWalletAddress && ethers.isAddress(hostWalletAddress)
      ? hostWalletAddress
      : ethers.ZeroAddress;
  const tx = await contract.registerProperty(fingerprint, hostAddr);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error('registerProperty transaction failed.');
  }
  return receipt.hash;
}

/**
 * Parses PropertyVerified event from a mined transaction receipt.
 */
function parseVerifiedEvent(receipt) {
  const iface = new ethers.Interface(getAbi());
  for (const log of receipt.logs || []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'PropertyVerified') {
        return {
          recordIndex: Number(parsed.args.index),
          blockNumber: Number(receipt.blockNumber),
        };
      }
    } catch (_) {
      // Ignore logs from other contracts/events
    }
  }
  throw new Error('PropertyVerified event not found in transaction receipt.');
}

/**
 * Checks if a transaction hash has already been mined and returns its receipt or null.
 */
async function getReceiptIfExists(txHash) {
  if (!txHash) return null;
  const { provider } = getProviderAndContract({ readOnly: true });
  return provider.getTransactionReceipt(txHash);
}

/**
 * Submits a Merkle commitment to PropertyRegistry.sol.
 * Returns { txHash, blockNumber, recordIndex }.
 */
async function submitVerification(fingerprint, merkleRoot, metadataHash) {
  const { contract } = getProviderAndContract();
  const tx = await contract.submitVerification(fingerprint, merkleRoot, metadataHash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error('submitVerification transaction failed.');
  }
  const { recordIndex, blockNumber } = parseVerifiedEvent(receipt);
  return {
    txHash: receipt.hash,
    blockNumber,
    recordIndex,
  };
}

/**
 * Reads getStatus(fingerprint) from PropertyRegistry.sol.
 */
async function getStatus(fingerprint) {
  const { contract } = getProviderAndContract({ readOnly: true });
  const [registered, active, lastVerifiedAt, count] = await contract.getStatus(fingerprint);
  return {
    registered: Boolean(registered),
    active: Boolean(active),
    lastVerifiedAt: Number(lastVerifiedAt),
    count: Number(count),
  };
}

/**
 * Reads getVerification(fingerprint, index) from PropertyRegistry.sol.
 */
async function getVerification(fingerprint, index) {
  const { contract } = getProviderAndContract({ readOnly: true });
  const record = await contract.getVerification(fingerprint, index);
  return {
    merkleRoot: record.merkleRoot,
    metadataHash: record.metadataHash,
    timestamp: Number(record.timestamp),
  };
}

/**
 * Calls PropertyRegistry.verifyPhoto(fingerprint, index, proof, leaf) on-chain.
 */
async function verifyPhoto(fingerprint, index, proof, leaf) {
  const { contract } = getProviderAndContract({ readOnly: true });
  return Boolean(await contract.verifyPhoto(fingerprint, index, proof, leaf));
}

module.exports = {
  isConfigured,
  registerProperty,
  submitVerification,
  getReceiptIfExists,
  parseVerifiedEvent,
  getStatus,
  getVerification,
  verifyPhoto,
};
