const crypto = require('crypto');
const prisma = require('../prisma/client');
const { getConfig, PROPERTY_STATUS, PROCESSING_STATE } = require('../config');
const { haversineMeters } = require('./hashing');
const chain = require('./chain');

class PropertyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

class DuplicatePropertyError extends PropertyError {
  constructor(message = 'A property with this normalized address already exists.') {
    super(message, 400);
  }
}

function normalizePart(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Computes 0x + HMAC_SHA256(FINGERPRINT_SECRET, normalize(address)|normalize(unit)|normalize(building)).
 */
function computePropertyFingerprint(address, unitNumber = '', building = '') {
  const cfg = getConfig();
  const canonical = [
    normalizePart(address),
    normalizePart(unitNumber),
    normalizePart(building),
  ].join('|');

  const digest = crypto
    .createHmac('sha256', cfg.fingerprintSecret)
    .update(canonical, 'utf8')
    .digest('hex');

  return `0x${digest}`;
}

/**
 * Returns true if any existing property is within PROXIMITY_METERS (default 30 m).
 */
async function hasNearbyProperty(latitude, longitude, excludeId = null) {
  const cfg = getConfig();
  const props = await prisma.property.findMany({
    where: excludeId ? { id: { not: excludeId } } : undefined,
    select: { id: true, latitude: true, longitude: true },
  });

  for (const prop of props) {
    const dist = haversineMeters(latitude, longitude, prop.latitude, prop.longitude);
    if (dist <= cfg.proximityMeters) {
      return true;
    }
  }
  return false;
}

/**
 * Derives public status from lastVerifiedAt (ARCHITECTURE.md Section 8).
 * Never overwrites UNDER_REVIEW, REJECTED, or PENDING.
 */
function computeEffectiveStatus(prop, now = new Date()) {
  if (
    prop.status === PROPERTY_STATUS.UNDER_REVIEW ||
    prop.status === PROPERTY_STATUS.REJECTED ||
    prop.status === PROPERTY_STATUS.PENDING
  ) {
    return prop.status;
  }
  if (!prop.lastVerifiedAt) {
    return prop.status;
  }

  const cfg = getConfig();
  const ageDays = (now.getTime() - new Date(prop.lastVerifiedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays >= cfg.expiryDays) {
    return PROPERTY_STATUS.EXPIRED;
  }
  if (ageDays >= cfg.dueSoonDays) {
    return PROPERTY_STATUS.DUE_SOON;
  }
  return PROPERTY_STATUS.VERIFIED;
}

/**
 * Computes 0-100 Trust Index per ARCHITECTURE.md Section 10.
 */
function computeTrustIndex(prop, now = new Date()) {
  const effectiveStatus = computeEffectiveStatus(prop, now);

  // 1. Latest photo verification (max 30)
  let photoPts = 0;
  if (effectiveStatus === PROPERTY_STATUS.VERIFIED) photoPts = 30;
  else if (effectiveStatus === PROPERTY_STATUS.DUE_SOON) photoPts = 20;

  // 2. Host identity verification (max 25)
  const identityPts = prop.host && prop.host.identityVerified ? 25 : 0;

  // 3. Duplicate checks (max 20)
  const hasPendingSimilar = Array.isArray(prop.submissions)
    ? prop.submissions.some(
        (s) => s.similarFlag && s.processingState === PROCESSING_STATE.PENDING_REVIEW
      )
    : false;
  const duplicatePts = prop.needsReview || hasPendingSimilar ? 0 : 20;

  // 4. Verification history (max 15)
  const recordCount = Array.isArray(prop.verificationRecords)
    ? prop.verificationRecords.length
    : 0;
  let historyPts = 0;
  if (recordCount >= 2) historyPts = 15;
  else if (recordCount === 1) historyPts = 8;

  // 5. Host rating (max 10) — derived from average guest rating (1-5 → 0-10)
  const avgRating = typeof prop._avgRating === 'number' ? prop._avgRating : 0;
  const ratingPts = avgRating > 0 ? Math.round((avgRating / 5) * 10) : 0;

  const score = photoPts + identityPts + duplicatePts + historyPts + ratingPts;
  return {
    score,
    maxScore: 100,
    effectiveStatus,
    breakdown: [
      { factor: 'Latest photo verification', points: photoPts, max: 30 },
      { factor: 'Host identity verification', points: identityPts, max: 25 },
      { factor: 'Duplicate checks', points: duplicatePts, max: 20 },
      { factor: 'Verification history', points: historyPts, max: 15 },
      { factor: 'Host rating', points: ratingPts, max: 10 },
    ],
    disclaimer:
      'The Trust Index reflects verification evidence and checks only. It is not a guarantee of physical property condition.',
  };
}

function parseAmenities(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Privacy-preserving public serializer: omits exact street address, unit, building, and exact GPS.
 */
function serializePublicProperty(prop) {
  // Inject _avgRating and _ratingCount from pre-computed reviews if available
  const reviews = Array.isArray(prop.reviews) ? prop.reviews : [];
  const ratingCount = reviews.length;
  const averageRating = ratingCount > 0
    ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / ratingCount).toFixed(2))
    : 0;
  // Store on prop object for computeTrustIndex to use
  prop._avgRating = averageRating;

  const effectiveStatus = computeEffectiveStatus(prop);
  const trustIndex = computeTrustIndex(prop);
  const cfg = getConfig();
  const records = Array.isArray(prop.verificationRecords)
    ? [...prop.verificationRecords].sort((a, b) => b.recordIndex - a.recordIndex)
    : [];
  const latestRecord = records[0] || null;

  let daysSinceVerification = null;
  let daysUntilExpiry = null;
  let nextUpdateDueAt = null;
  if (prop.lastVerifiedAt) {
    const verifiedMs = new Date(prop.lastVerifiedAt).getTime();
    daysSinceVerification = Math.max(0, Math.floor((Date.now() - verifiedMs) / (1000 * 60 * 60 * 24)));
    daysUntilExpiry = Math.max(0, cfg.expiryDays - daysSinceVerification);
    nextUpdateDueAt = new Date(verifiedMs + cfg.expiryDays * 24 * 60 * 60 * 1000).toISOString();
  }

  return {
    id: prop.id,
    hostId: prop.hostId,
    hostUsername: prop.host ? prop.host.username : undefined,
    hostIdentityVerified: prop.host ? Boolean(prop.host.identityVerified) : false,
    name: prop.name,
    description: prop.description || '',
    city: prop.city || '',
    bedrooms: prop.bedrooms ?? 1,
    bathrooms: prop.bathrooms ?? 1,
    maxGuests: prop.maxGuests ?? 2,
    amenities: parseAmenities(prop.amenities),
    price: prop.price,
    approxLatitude: Number(prop.latitude.toFixed(2)),
    approxLongitude: Number(prop.longitude.toFixed(2)),
    fingerprint: prop.fingerprint,
    status: effectiveStatus,
    storedStatus: prop.status,
    lastVerifiedAt: prop.lastVerifiedAt,
    daysSinceVerification,
    daysUntilExpiry,
    nextUpdateDueAt,
    registerTx: prop.registerTx,
    needsReview: prop.needsReview,
    createdAt: prop.createdAt,
    verificationCount: records.length,
    latestRecord: latestRecord
      ? {
          recordIndex: latestRecord.recordIndex,
          merkleRoot: latestRecord.merkleRoot,
          metadataHash: latestRecord.metadataHash,
          txHash: latestRecord.txHash,
          blockNumber: latestRecord.blockNumber,
          createdAt: latestRecord.createdAt,
        }
      : null,
    trustIndex,
    averageRating,
    ratingCount,
    combinedScore: Number(((averageRating / 5) * 100 + trustIndex.score).toFixed(2)),
  };
}

/**
 * Host-private serializer (used only for the authenticated owning host).
 */
function serializeHostProperty(prop) {
  return {
    ...serializePublicProperty(prop),
    address: prop.address,
    unitNumber: prop.unitNumber,
    building: prop.building,
    latitude: prop.latitude,
    longitude: prop.longitude,
  };
}

/**
 * Registers a new property off-chain and anchors its HMAC fingerprint on PropertyRegistry.sol.
 */
async function registerPropertyService({
  host,
  name,
  description = '',
  city = '',
  bedrooms = 1,
  bathrooms = 1,
  maxGuests = 2,
  amenities = [],
  address,
  unitNumber = '',
  building = '',
  latitude,
  longitude,
  price,
  registerOnChain = true,
}) {
  if (!name || !address) {
    throw new PropertyError('Property name and address are required.', 400);
  }
  const lat = Number(latitude);
  const lon = Number(longitude);
  const parsedPrice = Number(price);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new PropertyError('Valid latitude and longitude are required.', 400);
  }
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    throw new PropertyError('Price must be a positive number.', 400);
  }

  const fingerprint = computePropertyFingerprint(address, unitNumber, building);
  const existing = await prisma.property.findUnique({ where: { fingerprint } });
  if (existing) {
    throw new DuplicatePropertyError('A property with this normalized address already exists.');
  }

  const needsReview = await hasNearbyProperty(lat, lon);
  const status = needsReview ? PROPERTY_STATUS.UNDER_REVIEW : PROPERTY_STATUS.PENDING;

  let prop = await prisma.property.create({
    data: {
      hostId: host.id,
      name: String(name).trim(),
      description: String(description || '').trim(),
      city: String(city || '').trim(),
      bedrooms: Math.max(1, parseInt(bedrooms, 10) || 1),
      bathrooms: Math.max(1, parseInt(bathrooms, 10) || 1),
      maxGuests: Math.max(1, parseInt(maxGuests, 10) || 2),
      amenities: JSON.stringify(parseAmenities(amenities)),
      address: String(address).trim(),
      unitNumber: String(unitNumber || '').trim(),
      building: String(building || '').trim(),
      latitude: lat,
      longitude: lon,
      price: parsedPrice,
      fingerprint,
      status,
      needsReview,
    },
    include: {
      host: true,
      verificationRecords: true,
      submissions: true,
    },
  });

  if (registerOnChain && chain.isConfigured()) {
    try {
      const txHash = await chain.registerProperty(fingerprint, host.walletAddress);
      prop = await prisma.property.update({
        where: { id: prop.id },
        data: { registerTx: txHash },
        include: {
          host: true,
          verificationRecords: true,
          submissions: true,
        },
      });
    } catch (err) {
      // Roll back DB creation if on-chain registration failed so state remains consistent
      await prisma.property.delete({ where: { id: prop.id } });
      throw new PropertyError(`On-chain property registration failed: ${err.message}`, 502);
    }
  }

  return prop;
}

module.exports = {
  PropertyError,
  DuplicatePropertyError,
  normalizePart,
  computePropertyFingerprint,
  hasNearbyProperty,
  computeEffectiveStatus,
  computeTrustIndex,
  serializePublicProperty,
  serializeHostProperty,
  registerPropertyService,
};
