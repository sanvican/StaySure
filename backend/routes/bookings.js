const express = require('express');
const prisma = require('../prisma/client');
const { ROLES } = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  BookingError,
  createBookingService,
  cancelBookingService,
} = require('../services/bookingService');

const router = express.Router();

// GET /api/bookings — GUEST only: current guest's bookings
router.get('/', requireAuth, requireRole(ROLES.GUEST), async (req, res) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { guestId: req.user.id },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            city: true,
            price: true,
            status: true,
            lastVerifiedAt: true,
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

// POST /api/bookings — GUEST only: create a booking (rejects overlapping CONFIRMED dates)
router.post('/', requireAuth, requireRole(ROLES.GUEST), async (req, res) => {
  try {
    const body = req.body || {};
    const booking = await createBookingService({
      guest: req.user,
      propertyId: body.propertyId ?? body.property_id,
      checkIn: body.checkIn ?? body.check_in,
      checkOut: body.checkOut ?? body.check_out,
    });
    return res.status(201).json(booking);
  } catch (err) {
    if (err instanceof BookingError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(500).json({ detail: err.message });
  }
});

// PATCH /api/bookings/:id/cancel — Cancel guest's own booking (or admin)
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const updated = await cancelBookingService({
      user: req.user,
      bookingId: req.params.id,
    });
    return res.json(updated);
  } catch (err) {
    if (err instanceof BookingError) {
      return res.status(err.statusCode).json({ detail: err.message });
    }
    return res.status(500).json({ detail: err.message });
  }
});

module.exports = router;
