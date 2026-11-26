const express = require('express');
const prisma = require('../prisma/client');
const { ROLES } = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { serializeHostProperty } = require('../services/propertyService');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.HOST));

// GET /api/host/properties — Host's own properties only (never another host's)
router.get('/properties', async (req, res) => {
  try {
    const props = await prisma.property.findMany({
      where: { hostId: req.user.id },
      include: {
        host: true,
        verificationRecords: { orderBy: { recordIndex: 'desc' } },
        submissions: {
          orderBy: { createdAt: 'desc' },
          include: {
            photos: {
              select: {
                id: true,
                viewLabel: true,
                sha256: true,
                latitude: true,
                longitude: true,
                capturedAt: true,
              },
              orderBy: { viewLabel: 'asc' },
            },
            verificationRecord: true,
          },
        },
        reviews: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(
      props.map((p) => ({
        ...serializeHostProperty(p),
        submissions: p.submissions,
      }))
    );
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

// GET /api/host/bookings — Bookings for the host's own properties
router.get('/bookings', async (req, res) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: {
        property: { hostId: req.user.id },
      },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            city: true,
            price: true,
            status: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(bookings);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

module.exports = router;
