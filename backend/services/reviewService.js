const prisma = require('../prisma/client');

class ReviewError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Creates a review for a property by a guest.
 * - Only GUEST role can review.
 * - Rating must be 1–5.
 * - One review per guest per property (unique constraint).
 */
async function createReviewService({ guest, propertyId, rating, comment = '' }) {
  if (!guest || guest.role !== 'GUEST') {
    throw new ReviewError('Only travelers can leave reviews.', 403);
  }

  const parsedRating = Number(rating);
  if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    throw new ReviewError('Rating must be an integer between 1 and 5.', 400);
  }

  const prop = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!prop) {
    throw new ReviewError('Property not found.', 404);
  }

  // Check if the guest has booked this property (at least one CONFIRMED booking)
  const hasBooking = await prisma.booking.findFirst({
    where: {
      guestId: guest.id,
      propertyId,
      status: 'CONFIRMED',
    },
    select: { id: true },
  });
  if (!hasBooking) {
    throw new ReviewError('You can only review properties you have booked.', 403);
  }

  // Check for existing review (enforced by unique constraint too)
  const existing = await prisma.review.findUnique({
    where: { propertyId_guestId: { propertyId, guestId: guest.id } },
  });
  if (existing) {
    throw new ReviewError('You have already reviewed this property.', 409);
  }

  const review = await prisma.review.create({
    data: {
      propertyId,
      guestId: guest.id,
      rating: parsedRating,
      comment: String(comment || '').trim(),
    },
    include: {
      guest: {
        select: { id: true, username: true },
      },
    },
  });

  return review;
}

/**
 * Returns aggregated rating info for a property.
 */
async function getPropertyRatings(propertyId) {
  const reviews = await prisma.review.findMany({
    where: { propertyId },
    include: {
      guest: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const ratingCount = reviews.length;
  const averageRating = ratingCount > 0
    ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / ratingCount).toFixed(2))
    : 0;

  return { reviews, ratingCount, averageRating };
}

module.exports = {
  ReviewError,
  createReviewService,
  getPropertyRatings,
};
