const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const {
  getConfig,
  REQUIRED_VIEWS,
  PROPERTY_STATUS,
  PROCESSING_STATE,
} = require('../config');
const {
  computeSha256,
  validateAndComputePhash,
  findSimilarPhoto,
  haversineMeters,
} = require('./hashing');
const {
  buildLeavesForPhotos,
  getMerkleRoot,
  getMerkleProof,
  computeMetadataHash,
} = require('./merkle');
const chain = require('./chain');

class VerificationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Starts a single-use, 10-minute live capture session for a property host.
 */
async function createCaptureSession({ propertyId, host }) {
  const prop = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!prop) {
    throw new VerificationError('Property not found.', 404);
  }
  if (prop.hostId !== host.id) {
    throw new VerificationError('Only the property host can start a capture session.', 403);
  }

  const cfg = getConfig();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + cfg.sessionTtlMinutes * 60 * 1000);
  const nonce = crypto.randomBytes(16).toString('hex');

  const session = await prisma.captureSession.create({
    data: {
      propertyId: prop.id,
      hostId: host.id,
      nonce,
      requiredViews: JSON.stringify(REQUIRED_VIEWS),
      expiresAt,
      used: false,
    },
  });

  return {
    id: session.id,
    propertyId: session.propertyId,
    propertyLatitude: prop.latitude,
    propertyLongitude: prop.longitude,
    maxRadiusMeters: cfg.gpsRadiusMeters,
    nonce: session.nonce,
    requiredViews: REQUIRED_VIEWS,
    expiresAt: session.expiresAt.toISOString(),
  };
}

function safeTimingEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Strict Section 9 validation & submission pipeline:
 * (a) Session exists, belongs to host & property, unused, unexpired
 * (b) Nonce matches
 * (c) Exact 3 required views, valid JPEG/PNG/WEBP, under MAX_UPLOAD_MB
 * (d) GPS within GPS_RADIUS_METERS (default 100 m)
 * (e) Exact SHA-256 duplicate on another property -> Reject (400)
 * (f) pHash distance <= PHASH_THRESHOLD or property.needsReview -> PENDING_REVIEW / UNDER_REVIEW
 */
async function processPhotoUpload({
  propertyId,
  host,
  sessionId,
  nonce,
  latitude,
  longitude,
  filesByView,
}) {
  const cfg = getConfig();
  const serverNow = new Date();

  const prop = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!prop) {
    throw new VerificationError('Property not found.', 404);
  }

  // (a) Session existence, ownership, single-use, expiry
  if (!sessionId) {
    throw new VerificationError('session_id is required.', 400);
  }
  const session = await prisma.captureSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new VerificationError('Capture session not found.', 404);
  }
  if (session.propertyId !== prop.id || session.hostId !== host.id) {
    throw new VerificationError('Session does not belong to this host and property.', 403);
  }
  if (session.used) {
    throw new VerificationError('Capture session has already been used.', 400);
  }
  if (serverNow > session.expiresAt) {
    throw new VerificationError('Capture session has expired.', 400);
  }

  // (b) Nonce match
  if (!safeTimingEqual(session.nonce, nonce)) {
    throw new VerificationError('Invalid session nonce.', 400);
  }

  // (c) Required views exactly once, valid image types, size limit
  const requiredViews = JSON.parse(session.requiredViews);
  const requiredSorted = [...requiredViews].sort();
  const providedSorted = Object.keys(filesByView || {}).sort();

  if (
    requiredSorted.length !== providedSorted.length ||
    !requiredSorted.every((v, i) => v === providedSorted[i])
  ) {
    throw new VerificationError(
      `Expected exact views [${requiredSorted.join(', ')}], got [${providedSorted.join(', ')}].`,
      400
    );
  }

  const maxBytes = cfg.maxUploadMb * 1024 * 1024;
  const preparedPhotos = [];

  for (const viewLabel of requiredSorted) {
    const fileObj = filesByView[viewLabel];
    const buffer = fileObj && fileObj.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new VerificationError(`Empty file for view '${viewLabel}'.`, 400);
    }
    if (buffer.length > maxBytes) {
      throw new VerificationError(
        `File for view '${viewLabel}' exceeds ${cfg.maxUploadMb} MB limit.`,
        400
      );
    }

    let phash;
    try {
      phash = await validateAndComputePhash(buffer);
    } catch (err) {
      throw new VerificationError(`Invalid image for '${viewLabel}': ${err.message}`, 400);
    }

    const sha256 = computeSha256(buffer);
    const ext =
      fileObj.mimetype === 'image/png'
        ? '.png'
        : fileObj.mimetype === 'image/webp'
        ? '.webp'
        : '.jpg';

    preparedPhotos.push({
      viewLabel,
      ext,
      buffer,
      sha256,
      phash,
    });
  }

  // (d) GPS within configured radius (default 100 m)
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new VerificationError('Valid latitude and longitude are required.', 400);
  }
  const distanceMeters = haversineMeters(prop.latitude, prop.longitude, lat, lon);
  if (distanceMeters > cfg.gpsRadiusMeters) {
    throw new VerificationError(
      `GPS location is ${distanceMeters.toFixed(1)}m from property (max ${cfg.gpsRadiusMeters}m).`,
      400
    );
  }

  // (e) SHA-256 exact duplicate check across OTHER properties + within same submission
  const seenInSubmission = new Set();
  for (const item of preparedPhotos) {
    if (seenInSubmission.has(item.sha256)) {
      throw new VerificationError(
        `Duplicate photo detected within the same submission for view '${item.viewLabel}'. Please capture each room separately.`,
        400
      );
    }
    seenInSubmission.add(item.sha256);

    const otherExact = await prisma.photo.findFirst({
      where: {
        sha256: item.sha256,
        propertyId: { not: prop.id },
      },
      select: { id: true },
    });
    if (otherExact) {
      throw new VerificationError(
        `Exact duplicate photo detected from another property for view '${item.viewLabel}'.`,
        400
      );
    }
  }

  // (f) pHash similarity check against all previously stored photos
  const existingPhotos = await prisma.photo.findMany({
    select: { id: true, phash: true },
  });
  let similarFlag = false;
  const similarReasons = [];

  for (const item of preparedPhotos) {
    const match = findSimilarPhoto(item.phash, existingPhotos, cfg.phashThreshold);
    if (match) {
      similarFlag = true;
      similarReasons.push(`${item.viewLabel} similar to photo ${match.id} (d=${match.distance})`);
    }
  }

  const flagged = similarFlag || prop.needsReview;
  if (prop.needsReview && similarReasons.length === 0) {
    similarReasons.push('Property flagged for proximity review (within 30m of existing listing)');
  }

  // Persist session, submission, private files, and photos atomically
  const submissionId = crypto.randomUUID();
  const submissionDir = path.join(cfg.privateMediaDir, submissionId);
  fs.mkdirSync(submissionDir, { recursive: true });

  const photoRecordsData = [];
  for (const item of preparedPhotos) {
    const filePath = path.join(submissionDir, `${item.viewLabel}${item.ext}`);
    fs.writeFileSync(filePath, item.buffer);
    photoRecordsData.push({
      submissionId,
      propertyId: prop.id,
      viewLabel: item.viewLabel,
      filePath,
      sha256: item.sha256,
      phash: item.phash,
      latitude: lat,
      longitude: lon,
      capturedAt: serverNow,
    });
  }

  const initialState = flagged
    ? PROCESSING_STATE.PENDING_REVIEW
    : PROCESSING_STATE.APPROVED;

  let submission = await prisma.$transaction(async (tx) => {
    await tx.captureSession.update({
      where: { id: session.id },
      data: { used: true },
    });

    const created = await tx.submission.create({
      data: {
        id: submissionId,
        propertyId: prop.id,
        sessionId: session.id,
        processingState: initialState,
        failureReason: flagged ? similarReasons.join('; ') : '',
        similarFlag,
      },
    });

    await tx.photo.createMany({ data: photoRecordsData });

    if (flagged) {
      await tx.property.update({
        where: { id: prop.id },
        data: { status: PROPERTY_STATUS.UNDER_REVIEW },
      });
    }

    return created;
  });

  if (submission.processingState === PROCESSING_STATE.APPROVED && chain.isConfigured()) {
    submission = await submitApprovedSubmissionToChain(submission.id);
  }

  return prisma.submission.findUnique({
    where: { id: submission.id },
    include: {
      property: true,
      photos: true,
      verificationRecord: true,
    },
  });
}

/**
 * Idempotently submits an APPROVED (or FAILED retryable) submission to PropertyRegistry.sol.
 * - Review-before-chain rule: refuses PENDING_REVIEW or REJECTED submissions.
 * - Idempotency: checks VerificationRecord and existing txHash receipt before sending.
 * - Failure handling: marks FAILED; never marks property VERIFIED.
 */
async function submitApprovedSubmissionToChain(submissionId) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      property: true,
      session: true,
      photos: { orderBy: { viewLabel: 'asc' } },
      verificationRecord: true,
    },
  });

  if (!submission) {
    throw new VerificationError('Submission not found.', 404);
  }

  if (submission.verificationRecord) {
    return submission;
  }

  const allowedStates = new Set([
    PROCESSING_STATE.APPROVED,
    PROCESSING_STATE.FAILED,
    PROCESSING_STATE.CHAIN_SUBMITTED,
  ]);
  if (!allowedStates.has(submission.processingState)) {
    throw new VerificationError(
      `Submission in state '${submission.processingState}' cannot be submitted to chain.`,
      400
    );
  }

  if (!submission.photos || submission.photos.length === 0) {
    throw new VerificationError('Submission has no photos.', 400);
  }

  const { leaves } = buildLeavesForPhotos(submission.photos);
  const merkleRoot = getMerkleRoot(leaves);
  const serverTimestamp = submission.photos[0].capturedAt.toISOString();
  const metadataHash = computeMetadataHash({
    propertyId: submission.propertyId,
    sessionId: submission.sessionId,
    nonce: submission.session.nonce,
    serverTimestamp,
    photoCount: submission.photos.length,
    merkleRoot,
  });

  try {
    let txHash;
    let blockNumber;
    let recordIndex;

    if (submission.txHash) {
      const receipt = await chain.getReceiptIfExists(submission.txHash);
      if (receipt && receipt.status === 1) {
        const parsed = chain.parseVerifiedEvent(receipt);
        txHash = submission.txHash;
        blockNumber = parsed.blockNumber;
        recordIndex = parsed.recordIndex;
      }
    }

    if (!txHash) {
      await prisma.submission.update({
        where: { id: submission.id },
        data: { processingState: PROCESSING_STATE.CHAIN_SUBMITTED },
      });

      const res = await chain.submitVerification(
        submission.property.fingerprint,
        merkleRoot,
        metadataHash
      );
      txHash = res.txHash;
      blockNumber = res.blockNumber;
      recordIndex = res.recordIndex;
    }

    await prisma.$transaction(async (tx) => {
      const existingRec = await tx.verificationRecord.findUnique({
        where: { submissionId: submission.id },
      });
      if (!existingRec) {
        await tx.verificationRecord.create({
          data: {
            propertyId: submission.propertyId,
            submissionId: submission.id,
            recordIndex,
            merkleRoot,
            metadataHash,
            txHash,
            blockNumber,
          },
        });
      }

      await tx.submission.update({
        where: { id: submission.id },
        data: {
          txHash,
          processingState: PROCESSING_STATE.CONFIRMED,
          failureReason: '',
        },
      });

      await tx.property.update({
        where: { id: submission.propertyId },
        data: {
          status: PROPERTY_STATUS.VERIFIED,
          lastVerifiedAt: new Date(),
          needsReview: false,
        },
      });
    });
  } catch (err) {
    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        processingState: PROCESSING_STATE.FAILED,
        failureReason: err.message || 'Blockchain transaction failed.',
      },
    });
  }

  return prisma.submission.findUnique({
    where: { id: submission.id },
    include: {
      property: true,
      photos: true,
      verificationRecord: true,
    },
  });
}

async function adminApproveSubmission(submissionId) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
  });
  if (!submission) {
    throw new VerificationError('Submission not found.', 404);
  }
  if (submission.processingState !== PROCESSING_STATE.PENDING_REVIEW) {
    throw new VerificationError(
      `Only PENDING_REVIEW submissions can be approved (current: ${submission.processingState}).`,
      400
    );
  }

  await prisma.submission.update({
    where: { id: submission.id },
    data: { processingState: PROCESSING_STATE.APPROVED },
  });

  if (chain.isConfigured()) {
    return submitApprovedSubmissionToChain(submission.id);
  }

  return prisma.submission.findUnique({
    where: { id: submission.id },
    include: { property: true, photos: true, verificationRecord: true },
  });
}

async function adminRejectSubmission(submissionId, reason = 'Rejected by admin') {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
  });
  if (!submission) {
    throw new VerificationError('Submission not found.', 404);
  }

  await prisma.$transaction([
    prisma.submission.update({
      where: { id: submission.id },
      data: {
        processingState: PROCESSING_STATE.REJECTED,
        failureReason: reason || 'Rejected by admin',
      },
    }),
    prisma.property.update({
      where: { id: submission.propertyId },
      data: { status: PROPERTY_STATUS.REJECTED },
    }),
  ]);

  return prisma.submission.findUnique({
    where: { id: submission.id },
    include: { property: true, photos: true, verificationRecord: true },
  });
}

async function adminRetrySubmission(submissionId) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
  });
  if (!submission) {
    throw new VerificationError('Submission not found.', 404);
  }
  if (
    submission.processingState === PROCESSING_STATE.PENDING_REVIEW ||
    submission.processingState === PROCESSING_STATE.REJECTED
  ) {
    throw new VerificationError(
      `Cannot retry submission in state '${submission.processingState}'.`,
      400
    );
  }
  return submitApprovedSubmissionToChain(submission.id);
}

/**
 * Guest on-chain verification (Section 11 & Proof Inspector):
 * 1. Loads original photos from private disk.
 * 2. Missing photo -> returns EVIDENCE_INCOMPLETE.
 * 3. Recomputes SHA-256 from disk, rebuilds Merkle leaves & root.
 * 4. Reads stored commitment from PropertyRegistry.getVerification(fingerprint, index).
 * 5. Calls PropertyRegistry.verifyPhoto(fingerprint, index, proof, leaf) for each photo.
 */
async function verifyRecordOnChain(propertyId, recordIndex) {
  const prop = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!prop) {
    throw new VerificationError('Property not found.', 404);
  }

  let record;
  if (recordIndex === undefined || recordIndex === null) {
    record = await prisma.verificationRecord.findFirst({
      where: { propertyId: prop.id },
      orderBy: { recordIndex: 'desc' },
      include: { submission: { include: { photos: { orderBy: { viewLabel: 'asc' } } } } },
    });
    if (!record) {
      throw new VerificationError('No verification records exist for this property.', 404);
    }
  } else {
    record = await prisma.verificationRecord.findUnique({
      where: {
        propertyId_recordIndex: {
          propertyId: prop.id,
          recordIndex: Number(recordIndex),
        },
      },
      include: { submission: { include: { photos: { orderBy: { viewLabel: 'asc' } } } } },
    });
    if (!record) {
      throw new VerificationError(`Verification record #${recordIndex} not found.`, 404);
    }
  }

  const photos = record.submission ? record.submission.photos : [];
  if (!photos.length) {
    return {
      status: 'EVIDENCE_INCOMPLETE',
      message: 'No photos associated with this verification record.',
      recordIndex: record.recordIndex,
      txHash: record.txHash,
      blockNumber: record.blockNumber,
      perPhoto: [],
    };
  }

  const missingViews = [];
  const recomputedPhotos = [];
  const photoByLabel = {};

  for (const photo of photos) {
    photoByLabel[photo.viewLabel] = photo;
    if (!photo.filePath || !fs.existsSync(photo.filePath)) {
      missingViews.push(photo.viewLabel);
      continue;
    }
    const rawBytes = fs.readFileSync(photo.filePath);
    const recomputedSha = computeSha256(rawBytes);
    recomputedPhotos.push({
      viewLabel: photo.viewLabel,
      sha256: recomputedSha,
      filePath: photo.filePath,
    });
  }

  if (missingViews.length > 0) {
    return {
      status: 'EVIDENCE_INCOMPLETE',
      message: `Missing off-chain photo file(s): ${missingViews.join(', ')}.`,
      recordIndex: record.recordIndex,
      txHash: record.txHash,
      blockNumber: record.blockNumber,
      missingViews,
      onchainRoot: record.merkleRoot,
      perPhoto: [],
    };
  }

  const { labels, leaves } = buildLeavesForPhotos(recomputedPhotos);
  const recomputedRoot = getMerkleRoot(leaves);
  const onchain = await chain.getVerification(prop.fingerprint, record.recordIndex);
  const onchainRoot = onchain.merkleRoot;

  // Also check each photo against its recorded SHA-256 to pinpoint the exact altered file
  const perPhoto = [];
  let allProofsValid = true;

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const leaf = leaves[i];
    const proof = getMerkleProof(leaves, i);
    const onchainProofValid = await chain.verifyPhoto(
      prop.fingerprint,
      record.recordIndex,
      proof,
      leaf
    );
    if (!onchainProofValid) {
      allProofsValid = false;
    }
    const storedSha256 = photoByLabel[label].sha256;
    const recomputedSha256 = recomputedPhotos[i].sha256;
    perPhoto.push({
      viewLabel: label,
      storedSha256,
      recomputedSha256,
      shaMatch: storedSha256 === recomputedSha256,
      leaf,
      proof,
      proofLength: proof.length,
      onchainProofValid,
    });
  }

  const rootMatch = recomputedRoot.toLowerCase() === onchainRoot.toLowerCase();
  const isMatch = rootMatch && allProofsValid;

  return {
    status: isMatch ? 'MATCH' : 'TAMPERED',
    message: isMatch
      ? 'All photos match the immutable on-chain Merkle commitment.'
      : 'TAMPER WARNING: Off-chain photo bytes do not match the on-chain Merkle root.',
    propertyId: prop.id,
    fingerprint: prop.fingerprint,
    recordIndex: record.recordIndex,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
    onchainRoot,
    recomputedRoot,
    onchainMetadataHash: onchain.metadataHash,
    onchainTimestamp: onchain.timestamp,
    perPhoto,
  };
}

module.exports = {
  VerificationError,
  createCaptureSession,
  processPhotoUpload,
  submitApprovedSubmissionToChain,
  adminApproveSubmission,
  adminRejectSubmission,
  adminRetrySubmission,
  verifyRecordOnChain,
};
