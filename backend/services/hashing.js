const crypto = require('crypto');
const sharp = require('sharp');

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

// Precompute 32x32 DCT cosine table for fast deterministic 64-bit pHash.
const DCT_SIZE = 32;
const LOW_FREQ = 8;
const COS_TABLE = Array.from({ length: DCT_SIZE }, (_, u) =>
  Array.from({ length: DCT_SIZE }, (__, x) =>
    Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE))
  )
);

/**
 * Computes raw SHA-256 hex digest (64 lowercase hex chars) of a Buffer.
 */
function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validates that buffer is a real JPEG/PNG/WEBP image and computes a 64-bit
 * DCT perceptual hash (16-char lowercase hex string) using sharp.
 */
async function validateAndComputePhash(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Empty image buffer.');
  }

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (err) {
    throw new Error('Unsupported or corrupted image file.');
  }

  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format.toLowerCase())) {
    throw new Error(`Unsupported image format '${metadata.format || 'unknown'}'. Allowed: JPEG, PNG, WEBP.`);
  }
  if (!metadata.width || !metadata.height) {
    throw new Error('Image dimensions could not be determined.');
  }

  const { data } = await sharp(buffer)
    .grayscale()
    .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 2D DCT (top-left 8x8 low-frequency coefficients)
  const coeffs = [];
  for (let u = 0; u < LOW_FREQ; u++) {
    const cu = u === 0 ? 1 / Math.SQRT2 : 1;
    for (let v = 0; v < LOW_FREQ; v++) {
      const cv = v === 0 ? 1 / Math.SQRT2 : 1;
      let sum = 0;
      for (let x = 0; x < DCT_SIZE; x++) {
        const cosX = COS_TABLE[u][x];
        const rowOffset = x * DCT_SIZE;
        for (let y = 0; y < DCT_SIZE; y++) {
          sum += data[rowOffset + y] * cosX * COS_TABLE[v][y];
        }
      }
      coeffs.push(0.25 * cu * cv * sum);
    }
  }

  // Use the 63 AC coefficients (excluding DC at index 0) to compute median for illumination invariance
  const ac = coeffs.slice(1).slice().sort((a, b) => a - b);
  const median = ac[Math.floor(ac.length / 2)];

  // Build 64-bit hash (bit 0..63; skip DC threshold or compare all 64 against AC median)
  let bits = 0n;
  for (let i = 0; i < 64; i++) {
    if (i > 0 && coeffs[i] > median) {
      bits |= 1n << BigInt(63 - i);
    }
  }

  return bits.toString(16).padStart(16, '0');
}

/**
 * Computes Hamming distance between two 64-bit hex perceptual hashes.
 */
function hammingDistance(hexA, hexB) {
  let xor = BigInt('0x' + hexA) ^ BigInt('0x' + hexB);
  let dist = 0;
  while (xor > 0n) {
    dist += Number(xor & 1n);
    xor >>= 1n;
  }
  return dist;
}

/**
 * Finds the closest existing photo within <= threshold Hamming distance.
 * Returns { id, distance } or null.
 */
function findSimilarPhoto(targetPhash, existingPhotos, threshold) {
  let best = null;
  for (const item of existingPhotos) {
    const dist = hammingDistance(targetPhash, item.phash);
    if (dist <= threshold && (best === null || dist < best.distance)) {
      best = { id: item.id, distance: dist };
    }
  }
  return best;
}

/**
 * Computes Haversine distance in meters between two WGS-84 coordinates.
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = {
  computeSha256,
  validateAndComputePhash,
  hammingDistance,
  findSimilarPhoto,
  haversineMeters,
};
