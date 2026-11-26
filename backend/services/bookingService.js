const prisma = require('../prisma/client');

class BookingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Creates a CONFIRMED booking after rejecting invalid date ranges or
 * overlapping CONFIRMED bookings for the same property.
 * Overlap condition: existing.checkIn < new.checkOut AND existing.checkOut > new.checkIn
 */
async function createBookingService({ guest, propertyId, checkIn, checkOut }) {
  const prop = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!prop) {
    throw new BookingError('Property not found.', 404);
  }

  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BookingError('Valid checkIn and checkOut dates are required.', 400);
  }
  if (end <= start) {
    throw new BookingError('checkOut must be after checkIn.', 400);
  }

  const nights = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const totalPrice = Number((prop.price * nights).toFixed(2));

  return prisma.$transaction(async (tx) => {
    const overlap = await tx.booking.findFirst({
      where: {
        propertyId: prop.id,
        status: 'CONFIRMED',
        checkIn: { lt: end },
        checkOut: { gt: start },
      },
      select: { id: true },
    });

    if (overlap) {
      throw new BookingError('Property is already booked for overlapping dates.', 409);
    }

    return tx.booking.create({
      data: {
        guestId: guest.id,
        propertyId: prop.id,
        checkIn: start,
        checkOut: end,
        totalPrice,
        status: 'CONFIRMED',
      },
    });
  });
}

async function cancelBookingService({ user, bookingId }) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    throw new BookingError('Booking not found.', 404);
  }
  if (booking.guestId !== user.id && user.role !== 'ADMIN') {
    throw new BookingError('You are not authorized to cancel this booking.', 403);
  }
  if (booking.status === 'CANCELLED') {
    return booking;
  }
  return prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'CANCELLED' },
  });
}

module.exports = {
  BookingError,
  createBookingService,
  cancelBookingService,
};
