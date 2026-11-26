const fs = require('fs');
const express = require('express');
const prisma = require('../prisma/client');
const { ROLES } = require('../config');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const {
  PropertyError,
  registerPropertyService,
  serializePublicProperty,
  serializeHostProperty,
} = require('../services/propertyService');
const { ReviewError, createReviewService, getPropertyRatings } = require('../services/reviewService');

const router = express.Router();

// GET /api/properties — Public search/list with optional filters and rating-based sorting
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const verifiedOnly = req.query.verifiedOnly === 'true';
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const sort = String(req.query.sort || 'recommended');

    const props = await prisma.property.findMany({
      include: {
        host: true,
        verificationRecords: true,
        submissions: true,
        reviews: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let serialized = props.map(serializePublicProperty);

    if (q) {
      serialized = serialized.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.city && p.city.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q))
      );
    }
    if (verifiedOnly) {
      serialized = serialized.filter((p) => p.status === 'VERIFIED' || p.status === 'DUE_SOON');
    }
    if (Number.isFinite(maxPrice) && maxPrice > 0) {
      serialized = serialized.filter((p) => p.price <= maxPrice);
    }

    // Sorting
    if (sort === 'recommended') {
      // combinedScore DESC, avgRating wins ties, then ratingCount
      serialized.sort((a, b) => {
        const diff = (b.combinedScore || 0) - (a.combinedScore || 0);
        if (diff !== 0) return diff;
        const rDiff = (b.averageRating || 0) - (a.averageRating || 0);
        if (rDiff !== 0) return rDiff;
        return (b.ratingCount || 0) - (a.ratingCount || 0);
      });
    } else if (sort === 'most_rated') {
      serialized.sort((a, b) => {
        const diff = (b.ratingCount || 0) - (a.ratingCount || 0);
        if (diff !== 0) return diff;
        const rDiff = (b.averageRating || 0) - (a.averageRating || 0);
        if (rDiff !== 0) return rDiff;
        return (b.trustIndex?.score || 0) - (a.trustIndex?.score || 0);
      });
    } else if (sort === 'trust') {
      serialized.sort((a, b) => (b.trustIndex?.score || 0) - (a.trustIndex?.score || 0));
    } else if (sort === 'price_asc') {
      serialized.sort((a, b) => a.price - b.price);
    } else if (sort === 'price_desc') {
      serialized.sort((a, b) => b.price - a.price);
    }
    // 'newest' keeps the default createdAt desc order

    return res.json(serialized);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

// GET /api/properties/mine — Host's own properties (kept for backwards compat, prefer /api/host/properties)
router.get('/mine', requireAuth, requireRole(ROLES.HOST, ROLES.ADMIN), async (req, res) => {
  try {
    const props = await prisma.property.findMany({
      where: req.user.role === ROLES.ADMIN ? undefined : { hostId: req.user.id },
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

// POST /api/properties — Host registers a new property (HOST only, no ADMIN self-register)
router.post('/', requireAuth, requireRole(ROLES.HOST), async (req, res) => {
  try {
    const body = req.body || {};
    const prop = await registerPropertyService({
      host: req.user,
      name: body.name,
      description: body.description ?? '',
      city: body.city ?? '',
      bedrooms: body.bedrooms ?? 1,
      bathrooms: body.bathrooms ?? 1,
      maxGuests: body.maxGuests ?? 2,
      amenities: body.amenities ?? [],
      address: body.address,
      unitNumber: body.unitNumber ?? body.unit_number ?? '',
      building: body.building ?? '',
      latitude: body.latitude,
      longitude: body.longitude,
      price: body.price,
    });

    return res.status(201).json(serializeHostProperty(prop));
  } catch (err) {
    if (err instanceof PropertyError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(500).json({ detail: err.message });
  }
});

// GET /api/properties/:id — Public property detail with Trust Index, reviews & on-chain/off-chain split
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const prop = await prisma.property.findUnique({
      where: { id: req.params.id },
      include: {
        host: true,
        verificationRecords: {
          orderBy: { recordIndex: 'desc' },
          include: { submission: { include: { photos: { orderBy: { viewLabel: 'asc' } } } } },
        },
        submissions: true,
        reviews: {
          include: { guest: { select: { id: true, username: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!prop) {
      return res.status(404).json({ detail: 'Property not found.' });
    }

    const publicData = serializePublicProperty(prop);
    const latestRec = prop.verificationRecords[0] || null;
    const latestPhotos = latestRec && latestRec.submission
      ? latestRec.submission.photos.map((ph) => ({
          id: ph.id,
          viewLabel: ph.viewLabel,
          sha256: ph.sha256,
          capturedAt: ph.capturedAt,
        }))
      : [];

    const isOwner = Boolean(req.user && (req.user.id === prop.hostId || req.user.role === ROLES.ADMIN));

    return res.json({
      ...publicData,
      isOwner,
      ...(isOwner
        ? {
            ownerPrivate: {
              address: prop.address,
              unitNumber: prop.unitNumber,
              building: prop.building,
              latitude: prop.latitude,
              longitude: prop.longitude,
            },
          }
        : {}),
      latestPhotos,
      reviews: prop.reviews.map((r) => ({
        id: r.id,
        guestUsername: r.guest ? r.guest.username : 'Anonymous',
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
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

// POST /api/properties/:id/reviews — Guest submits a review (GUEST only)
router.post('/:id/reviews', requireAuth, requireRole(ROLES.GUEST), async (req, res) => {
  try {
    const body = req.body || {};
    const review = await createReviewService({
      guest: req.user,
      propertyId: req.params.id,
      rating: body.rating,
      comment: body.comment,
    });
    return res.status(201).json(review);
  } catch (err) {
    if (err instanceof ReviewError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(500).json({ detail: err.message });
  }
});

// GET /api/properties/:id/photos/:viewLabel — Controlled private photo stream (not static)
router.get('/:id/photos/:viewLabel', async (req, res) => {
  try {
    const latestRec = await prisma.verificationRecord.findFirst({
      where: { propertyId: req.params.id },
      orderBy: { recordIndex: 'desc' },
      include: {
        submission: {
          include: {
            photos: {
              where: { viewLabel: req.params.viewLabel },
            },
          },
        },
      },
    });

    const photo = latestRec && latestRec.submission && latestRec.submission.photos[0];
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
