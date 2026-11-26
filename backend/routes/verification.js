const express = require('express');
const prisma = require('../prisma/client');
const { getConfig, ROLES } = require('../config');
const { haversineMeters } = require('../services/hashing');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createUploadMiddleware } = require('../middleware/upload');
const {
  VerificationError,
  createCaptureSession,
  processPhotoUpload,
  verifyRecordOnChain,
} = require('../services/verificationService');

const router = express.Router();
const upload = createUploadMiddleware();

// POST /api/properties/:id/capture-session
router.post(
  '/:id/capture-session',
  requireAuth,
  requireRole(ROLES.HOST, ROLES.ADMIN),
  async (req, res) => {
    try {
      const session = await createCaptureSession({
        propertyId: req.params.id,
        host: req.user,
      });
      return res.status(201).json(session);
    } catch (err) {
      if (err instanceof VerificationError) {
        return res.status(err.statusCode).json({ detail: err.message });
      }
      return res.status(500).json({ detail: err.message });
    }
  }
);

// POST /api/properties/:id/upload-photo
router.post(
  '/:id/upload-photo',
  requireAuth,
  requireRole(ROLES.HOST, ROLES.ADMIN),
  (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) {
        return res.status(400).json({ detail: err.message });
      }
      return next();
    });
  },
  async (req, res) => {
    try {
      const body = req.body || {};
      const sessionId = body.sessionId ?? body.session_id ?? '';
      const nonce = body.nonce ?? '';
      const latitude = body.latitude;
      const longitude = body.longitude;

      const filesByView = {};
      for (const file of req.files || []) {
        if (filesByView[file.fieldname]) {
          return res.status(400).json({
            detail: `Duplicate upload field for view '${file.fieldname}'.`,
          });
        }
        filesByView[file.fieldname] = file;
      }

      const submission = await processPhotoUpload({
        propertyId: req.params.id,
        host: req.user,
        sessionId,
        nonce,
        latitude,
        longitude,
        filesByView,
      });

      const distanceMeters =
        submission.property && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
          ? Number(
              haversineMeters(
                submission.property.latitude,
                submission.property.longitude,
                Number(latitude),
                Number(longitude)
              ).toFixed(1)
            )
          : null;

      return res.status(201).json({
        submissionId: submission.id,
        processingState: submission.processingState,
        similarFlag: submission.similarFlag,
        propertyStatus: submission.property.status,
        failureReason: submission.failureReason,
        txHash: submission.txHash,
        verificationRecord: submission.verificationRecord || null,
        geotag: {
          latitude: Number(latitude),
          longitude: Number(longitude),
          distanceMeters,
          maxRadiusMeters: getConfig().gpsRadiusMeters,
        },
        photos: (submission.photos || []).map((ph) => ({
          id: ph.id,
          viewLabel: ph.viewLabel,
          sha256: ph.sha256,
          latitude: ph.latitude,
          longitude: ph.longitude,
          capturedAt: ph.capturedAt,
        })),
      });
    } catch (err) {
      if (err instanceof VerificationError) {
        return res.status(err.statusCode).json({ detail: err.message });
      }
      return res.status(500).json({ detail: err.message });
    }
  }
);

// GET /api/properties/:id/history
router.get('/:id/history', async (req, res) => {
  try {
    const prop = await prisma.property.findUnique({
      where: { id: req.params.id },
      include: {
        verificationRecords: { orderBy: { recordIndex: 'desc' } },
      },
    });
    if (!prop) {
      return res.status(404).json({ detail: 'Property not found.' });
    }

    return res.json({
      propertyId: prop.id,
      fingerprint: prop.fingerprint,
      records: prop.verificationRecords.map((r) => ({
        id: r.id,
        recordIndex: r.recordIndex,
        merkleRoot: r.merkleRoot,
        metadataHash: r.metadataHash,
        txHash: r.txHash,
        blockNumber: r.blockNumber,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

// GET /api/properties/:id/verify-onchain?index=N
router.get('/:id/verify-onchain', async (req, res) => {
  try {
    let recordIndex;
    if (req.query.index !== undefined && req.query.index !== '') {
      const parsed = Number(req.query.index);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ detail: 'index must be a non-negative integer.' });
      }
      recordIndex = parsed;
    }

    const result = await verifyRecordOnChain(req.params.id, recordIndex);
    return res.json(result);
  } catch (err) {
    if (err instanceof VerificationError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(502).json({ detail: `Blockchain verification error: ${err.message}` });
  }
});

module.exports = router;
