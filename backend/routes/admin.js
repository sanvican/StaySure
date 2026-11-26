const fs = require('fs');
const express = require('express');
const prisma = require('../prisma/client');
const { ROLES } = require('../config');
const { haversineMeters } = require('../services/hashing');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  VerificationError,
  adminApproveSubmission,
  adminRejectSubmission,
  adminRetrySubmission,
} = require('../services/verificationService');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.ADMIN));

// GET /api/admin/submissions — Admin review queue & host identity list
router.get('/submissions', async (req, res) => {
  try {
    const submissions = await prisma.submission.findMany({
      include: {
        property: {
          include: {
            host: {
              select: { id: true, username: true, email: true, identityVerified: true },
            },
          },
        },
        photos: {
          select: {
            id: true,
            viewLabel: true,
            sha256: true,
            phash: true,
            latitude: true,
            longitude: true,
            capturedAt: true,
          },
          orderBy: { viewLabel: 'asc' },
        },
        verificationRecord: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const enrichedSubmissions = submissions.map((s) => {
      const ph = s.photos && s.photos[0];
      const distanceMeters =
        ph && s.property
          ? Number(
              haversineMeters(s.property.latitude, s.property.longitude, ph.latitude, ph.longitude).toFixed(1)
            )
          : null;
      return { ...s, distanceMeters };
    });

    const hosts = await prisma.user.findMany({
      where: { role: { in: [ROLES.HOST, ROLES.ADMIN] } },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        walletAddress: true,
        identityVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ submissions: enrichedSubmissions, hosts });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

// POST /api/admin/submissions/:id/approve
router.post('/submissions/:id/approve', async (req, res) => {
  try {
    const submission = await adminApproveSubmission(req.params.id);
    return res.json(submission);
  } catch (err) {
    if (err instanceof VerificationError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(500).json({ detail: err.message });
  }
});

// POST /api/admin/submissions/:id/reject
router.post('/submissions/:id/reject', async (req, res) => {
  try {
    const reason = (req.body && req.body.reason) || 'Rejected by admin';
    const submission = await adminRejectSubmission(req.params.id, reason);
    return res.json(submission);
  } catch (err) {
    if (err instanceof VerificationError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(500).json({ detail: err.message });
  }
});

// POST /api/admin/submissions/:id/retry
router.post('/submissions/:id/retry', async (req, res) => {
  try {
    const submission = await adminRetrySubmission(req.params.id);
    return res.json(submission);
  } catch (err) {
    if (err instanceof VerificationError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(500).json({ detail: err.message });
  }
});

// PATCH /api/admin/users/:id/identity
router.patch('/users/:id/identity', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ detail: 'User not found.' });
    }

    const nextVal =
      typeof (req.body && req.body.identityVerified) === 'boolean'
        ? req.body.identityVerified
        : !user.identityVerified;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { identityVerified: nextVal },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        walletAddress: true,
        identityVerified: true,
      },
    });

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

// GET /api/admin/submissions/:id/photos/:viewLabel — Admin photo inspection for flagged reviews
router.get('/submissions/:id/photos/:viewLabel', async (req, res) => {
  try {
    const photo = await prisma.photo.findFirst({
      where: {
        submissionId: req.params.id,
        viewLabel: req.params.viewLabel,
      },
    });
    if (!photo || !photo.filePath || !fs.existsSync(photo.filePath)) {
      return res.status(404).json({ detail: 'Photo not found.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(photo.filePath);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

module.exports = router;
