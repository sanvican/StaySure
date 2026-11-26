const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const REQUIRED_VIEWS = ['living_room', 'bedroom', 'bathroom'];

const ROLES = {
  HOST: 'HOST',
  GUEST: 'GUEST',
  ADMIN: 'ADMIN',
};

const PROPERTY_STATUS = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  DUE_SOON: 'DUE_SOON',
  EXPIRED: 'EXPIRED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  REJECTED: 'REJECTED',
};

const PROCESSING_STATE = {
  RECEIVED: 'RECEIVED',
  VALIDATING: 'VALIDATING',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  CHAIN_SUBMITTED: 'CHAIN_SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
};

function getConfig() {
  return {
    port: Number(process.env.PORT || 4000),
    jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
    fingerprintSecret: process.env.FINGERPRINT_SECRET || 'dev-local-fingerprint-secret-change-me',
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
    contractAddress: (process.env.CONTRACT_ADDRESS || '').trim(),
    backendPrivateKey: (process.env.BACKEND_PRIVATE_KEY || '').trim(),
    gpsRadiusMeters: Number(process.env.GPS_RADIUS_METERS || 100),
    phashThreshold: Number(process.env.PHASH_THRESHOLD || 5),
    sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES || 10),
    expiryDays: Number(process.env.EXPIRY_DAYS || 30),
    dueSoonDays: Number(process.env.DUE_SOON_DAYS || 25),
    proximityMeters: Number(process.env.PROXIMITY_METERS || 30),
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
    privateMediaDir: process.env.PRIVATE_MEDIA_DIR
      ? path.resolve(process.env.PRIVATE_MEDIA_DIR)
      : path.resolve(__dirname, 'private_media'),
  };
}

module.exports = {
  REQUIRED_VIEWS,
  ROLES,
  PROPERTY_STATUS,
  PROCESSING_STATE,
  getConfig,
};
