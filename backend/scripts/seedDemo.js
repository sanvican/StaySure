const bcrypt = require('bcryptjs');
const prisma = require('../prisma/client');
const { computePropertyFingerprint, serializePublicProperty } = require('../services/propertyService');

async function main() {
  console.log('Seeding StaySure demo database...');

  // Clear existing data in dependency order
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.verificationRecord.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.captureSession.deleteMany();
  await prisma.property.deleteMany();
  await prisma.user.deleteMany();

  const pw = await bcrypt.hash('password123', 8);

  const host1 = await prisma.user.create({
    data: {
      username: 'demo_host',
      email: 'host1@staysure.local',
      passwordHash: pw,
      role: 'HOST',
      identityVerified: false,
    },
  });

  const host2 = await prisma.user.create({
    data: {
      username: 'demo_host2',
      email: 'host2@staysure.local',
      passwordHash: pw,
      role: 'HOST',
      identityVerified: true,
    },
  });

  const guest1 = await prisma.user.create({
    data: {
      username: 'demo_guest',
      email: 'guest1@staysure.local',
      passwordHash: pw,
      role: 'GUEST',
    },
  });

  const guest2 = await prisma.user.create({
    data: {
      username: 'demo_guest2',
      email: 'guest2@staysure.local',
      passwordHash: pw,
      role: 'GUEST',
    },
  });

  const guest3 = await prisma.user.create({
    data: {
      username: 'demo_guest3',
      email: 'guest3@staysure.local',
      passwordHash: pw,
      role: 'GUEST',
    },
  });

  const guest4 = await prisma.user.create({
    data: {
      username: 'demo_guest4',
      email: 'guest4@staysure.local',
      passwordHash: pw,
      role: 'GUEST',
    },
  });

  await prisma.user.create({
    data: {
      username: 'demo_admin',
      email: 'admin@staysure.local',
      passwordHash: pw,
      role: 'ADMIN',
      identityVerified: true,
    },
  });

  // 1. Sunlit Mission Loft (VERIFIED, 2 records, host2 ID verified, 5.0 avg rating -> top recommended)
  const p1 = await prisma.property.create({
    data: {
      hostId: host2.id,
      name: 'Sunlit Mission Loft',
      city: 'San Francisco, CA',
      description: 'Bright open-plan loft with floor-to-ceiling windows and fast fiber Wi-Fi.',
      bedrooms: 2,
      bathrooms: 2,
      maxGuests: 4,
      amenities: JSON.stringify(['Fast Wi-Fi', 'Full Kitchen', 'Workspace', 'AC']),
      address: '742 Valencia St',
      unitNumber: '3A',
      building: 'Mission Commons',
      latitude: 37.7609,
      longitude: -122.4216,
      price: 210,
      fingerprint: computePropertyFingerprint('742 Valencia St', '3A', 'Mission Commons'),
      status: 'VERIFIED',
      lastVerifiedAt: new Date(),
    },
  });

  // 2. Tie-Pair A: Marina Garden Suite
  // PENDING (0 photo), host1 (0 id), needsReview=false (20 dup), 0 history, avgRating=5.0 (10 pts)
  // trustScore = 30, combinedScore = (5.0/5)*100 + 30 = 130
  const p2 = await prisma.property.create({
    data: {
      hostId: host1.id,
      name: 'Marina Garden Suite (Tie-A)',
      city: 'San Francisco, CA',
      description: 'Quiet garden-level suite steps from Crissy Field.',
      bedrooms: 1,
      bathrooms: 1,
      maxGuests: 2,
      amenities: JSON.stringify(['Fast Wi-Fi', 'Self Check-in']),
      address: '2100 Chestnut St',
      latitude: 37.8005,
      longitude: -122.4378,
      price: 165,
      fingerprint: computePropertyFingerprint('2100 Chestnut St', '', ''),
      status: 'PENDING',
    },
  });

  // 3. Tie-Pair B: Nob Hill Studio
  // PENDING (0 photo), host2 (25 id), needsReview=false (20 dup), 1 record (8 history), avgRating=3.5 (7 pts)
  // trustScore = 60, combinedScore = (3.5/5)*100 + 60 = 130 (Exact tie with p2, but p2 has higher avgRating 5.0 > 3.5!)
  const p3 = await prisma.property.create({
    data: {
      hostId: host2.id,
      name: 'Nob Hill Studio (Tie-B)',
      city: 'San Francisco, CA',
      description: 'Classic cable-car-line studio with sweeping bay views.',
      bedrooms: 1,
      bathrooms: 1,
      maxGuests: 2,
      amenities: JSON.stringify(['Fast Wi-Fi', 'Washer']),
      address: '1050 California St',
      latitude: 37.7919,
      longitude: -122.4119,
      price: 150,
      fingerprint: computePropertyFingerprint('1050 California St', '', ''),
      status: 'PENDING',
    },
  });
  const sess3 = await prisma.captureSession.create({
    data: {
      propertyId: p3.id,
      hostId: host2.id,
      nonce: 'seed-nonce-p3',
      requiredViews: JSON.stringify(['living_room', 'bedroom', 'bathroom']),
      expiresAt: new Date(Date.now() + 60000),
      used: true,
    },
  });
  const sub3 = await prisma.submission.create({
    data: { propertyId: p3.id, sessionId: sess3.id, processingState: 'CONFIRMED' },
  });
  await prisma.verificationRecord.create({
    data: {
      propertyId: p3.id,
      submissionId: sub3.id,
      recordIndex: 0,
      merkleRoot: '0x' + 'aa'.repeat(32),
      metadataHash: '0x' + 'bb'.repeat(32),
      txHash: '0x' + 'cc'.repeat(32),
      blockNumber: 1,
    },
  });

  // 4. Most-Rated Property: Tahoe Pine Cabin (4 reviews)
  const p4 = await prisma.property.create({
    data: {
      hostId: host1.id,
      name: 'Tahoe Pine Cabin',
      city: 'South Lake Tahoe, CA',
      description: 'Cozy A-frame cabin surrounded by pines, 5 minutes from the lake.',
      bedrooms: 3,
      bathrooms: 2,
      maxGuests: 6,
      amenities: JSON.stringify(['Full Kitchen', 'Washer', 'Fast Wi-Fi']),
      address: '88 Timberline Rd',
      latitude: 38.9399,
      longitude: -119.9772,
      price: 240,
      fingerprint: computePropertyFingerprint('88 Timberline Rd', '', ''),
      status: 'VERIFIED',
      lastVerifiedAt: new Date(),
    },
  });

  // 5. Coastal Cliffside Bungalow (DUE_SOON)
  const p5 = await prisma.property.create({
    data: {
      hostId: host2.id,
      name: 'Coastal Cliffside Bungalow',
      city: 'Half Moon Bay, CA',
      description: 'Ocean-breeze retreat with private deck overlooking the Pacific.',
      bedrooms: 2,
      bathrooms: 1,
      maxGuests: 4,
      amenities: JSON.stringify(['Fast Wi-Fi', 'Full Kitchen', 'Self Check-in']),
      address: '14 Ocean View Way',
      latitude: 37.4636,
      longitude: -122.4286,
      price: 195,
      fingerprint: computePropertyFingerprint('14 Ocean View Way', '', ''),
      status: 'VERIFIED',
      lastVerifiedAt: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000),
    },
  });

  // Seed bookings & reviews
  await prisma.booking.createMany({
    data: [
      { guestId: guest1.id, propertyId: p1.id, checkIn: new Date('2026-10-01'), checkOut: new Date('2026-10-04'), totalPrice: 630, status: 'CONFIRMED' },
      { guestId: guest1.id, propertyId: p4.id, checkIn: new Date('2026-10-10'), checkOut: new Date('2026-10-12'), totalPrice: 480, status: 'CONFIRMED' },
      { guestId: guest2.id, propertyId: p4.id, checkIn: new Date('2026-10-15'), checkOut: new Date('2026-10-17'), totalPrice: 480, status: 'CONFIRMED' },
    ],
  });

  await prisma.review.createMany({
    data: [
      { propertyId: p1.id, guestId: guest1.id, rating: 5, comment: 'Spotless loft, matched the live photos 100%!' },
      { propertyId: p1.id, guestId: guest2.id, rating: 5, comment: 'Amazing light and super easy check-in.' },
      { propertyId: p2.id, guestId: guest1.id, rating: 5, comment: 'Wonderful host and super clean.' },
      { propertyId: p3.id, guestId: guest1.id, rating: 3, comment: 'Good location, a bit noisy.' },
      { propertyId: p3.id, guestId: guest2.id, rating: 4, comment: 'Nice view of the bay.' },
      { propertyId: p4.id, guestId: guest1.id, rating: 4, comment: 'Great cabin for a weekend trip.' },
      { propertyId: p4.id, guestId: guest2.id, rating: 5, comment: 'Loved the pine trees and fireplace.' },
      { propertyId: p4.id, guestId: guest3.id, rating: 4, comment: 'Very comfortable beds.' },
      { propertyId: p4.id, guestId: guest4.id, rating: 4, comment: 'Clean and well-stocked kitchen.' },
      { propertyId: p5.id, guestId: guest2.id, rating: 5, comment: 'Unbeatable ocean view!' },
    ],
  });

  // Verify computed scores
  const seeded = await prisma.property.findMany({
    include: { host: true, verificationRecords: true, submissions: true, reviews: true },
  });
  const serialized = seeded.map(serializePublicProperty).sort((a, b) => {
    const diff = b.combinedScore - a.combinedScore;
    if (diff !== 0) return diff;
    return b.averageRating - a.averageRating;
  });

  console.log('\nSeeded Properties (Recommended Order):');
  for (const p of serialized) {
    console.log(
      `  - ${p.name} | Combined: ${p.combinedScore} | Avg Rating: ${p.averageRating} (${p.ratingCount} reviews) | Trust: ${p.trustIndex.score}/100 | Status: ${p.status}`
    );
  }

  console.log('\nDemo Accounts (password for all: password123):');
  console.log('  HOST:     demo_host, demo_host2');
  console.log('  TRAVELER: demo_guest, demo_guest2');
  console.log('  ADMIN:    demo_admin');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
