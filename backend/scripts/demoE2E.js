/**
 * End-to-end live demo & verification script for StaySure v3 (Node.js + Hardhat).
 * Requires a running local Hardhat node + deployed PropertyRegistry in backend/.env.
 * Usage: cd backend && npm run demo:e2e
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const prisma = require('../prisma/client');
const { ROLES } = require('../config');
const {
  DuplicatePropertyError,
  registerPropertyService,
} = require('../services/propertyService');
const {
  createCaptureSession,
  processPhotoUpload,
  adminApproveSubmission,
  verifyRecordOnChain,
} = require('../services/verificationService');
const { runCheckExpiry } = require('./checkExpiry');

const ASSETS_DIR = path.resolve(__dirname, 'demo_assets');

async function loadDemoAsset(filename, seed) {
  const filePath = path.join(ASSETS_DIR, filename);
  const raw = fs.readFileSync(filePath);
  const existingPhotos = await prisma.photo.count();
  if (existingPhotos === 0) {
    return sharp(raw).jpeg({ quality: 92 }).toBuffer();
  }
  // If DB already has photos from an earlier demo run, apply a slight crop/tint variation
  // so repeated runs generate distinct SHA-256 and pHash values while keeping real imagery.
  const meta = await sharp(raw).metadata();
  const inset = 12 + (seed % 18);
  return sharp(raw)
    .extract({
      left: inset,
      top: inset,
      width: Math.max(200, meta.width - inset * 2),
      height: Math.max(200, meta.height - inset * 2),
    })
    .resize(meta.width, meta.height)
    .jpeg({ quality: 90 - (seed % 5) })
    .toBuffer();
}

async function resizeJpeg(buffer) {
  return sharp(buffer).resize(320, 240).jpeg({ quality: 85 }).toBuffer();
}

async function step(title, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`[${ms.padStart(7)} ms] ${title}`);
  return result;
}

async function main() {
  const suffix = String(Math.floor(Date.now() / 1000));
  const seedBase = Number(suffix);
  const lat1 = 37.7749 + (seedBase % 100) * 0.001;
  const lon1 = -122.4194 + (seedBase % 100) * 0.001;
  const lat2 = 37.8044 + (seedBase % 100) * 0.001;
  const lon2 = -122.2712 + (seedBase % 100) * 0.001;

  const passwordHash = await bcrypt.hash('password123', 10);
  const host = await prisma.user.upsert({
    where: { username: 'demo_host' },
    update: {},
    create: {
      username: 'demo_host',
      email: 'claire.host@staysure.com',
      passwordHash,
      role: ROLES.HOST,
      identityVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { username: 'demo_guest' },
    update: {},
    create: {
      username: 'demo_guest',
      email: 'alex.traveler@staysure.com',
      passwordHash,
      role: ROLES.GUEST,
    },
  });

  await prisma.user.upsert({
    where: { username: 'demo_admin' },
    update: {},
    create: {
      username: 'demo_admin',
      email: 'trust@staysure.com',
      passwordHash,
      role: ROLES.ADMIN,
    },
  });

  // 1. Register Property #1 on-chain
  const prop1 = await step('1. Register Property #1 (HMAC fingerprint + on-chain tx)', () =>
    registerPropertyService({
      host,
      name: 'Sunlit Mission District Loft',
      city: 'San Francisco, CA',
      description:
        'Bright architectural loft with floor-to-ceiling windows, dedicated fiber workspace, and live-verified room photos.',
      bedrooms: 2,
      bathrooms: 1,
      maxGuests: 4,
      amenities: ['Fast Wi-Fi', 'Full Kitchen', 'Workspace', 'Self Check-in', 'Washer'],
      address: `${suffix} Elm St`,
      unitNumber: 'Flat 4-B',
      building: 'North Wing',
      latitude: lat1,
      longitude: lon1,
      price: 165,
    })
  );
  console.log(`    fingerprint=${prop1.fingerprint} registerTx=${prop1.registerTx}`);

  // 2. Duplicate address normalization -> rejected
  const dupMsg = await step('2. Duplicate address formatting rejected (12 elm st, flat 4 b)', async () => {
    try {
      await registerPropertyService({
        host,
        name: 'Duplicate Elm Loft',
        address: `${suffix} elm st!`,
        unitNumber: 'flat 4 b',
        building: 'north-wing',
        latitude: lat1,
        longitude: lon1,
        price: 165,
      });
      throw new Error('Expected duplicate property rejection!');
    } catch (err) {
      if (!(err instanceof DuplicatePropertyError)) throw err;
      return err.message;
    }
  });
  console.log(`    rejected: ${dupMsg}`);

  // 3. Live capture session + upload -> Merkle -> On-chain VERIFIED
  const imgs = {
    living_room: await loadDemoAsset('loft_living.jpg', seedBase + 1),
    bedroom: await loadDemoAsset('loft_bedroom.jpg', seedBase + 2),
    bathroom: await loadDemoAsset('loft_bathroom.jpg', seedBase + 3),
  };
  const session = await step('3a. Create 10-min single-use capture session', () =>
    createCaptureSession({ propertyId: prop1.id, host })
  );
  const sub1 = await step('3b. Upload 3 photos -> validate -> Merkle -> submitVerification', () =>
    processPhotoUpload({
      propertyId: prop1.id,
      host,
      sessionId: session.id,
      nonce: session.nonce,
      latitude: lat1,
      longitude: lon1,
      filesByView: {
        living_room: { buffer: imgs.living_room, mimetype: 'image/jpeg' },
        bedroom: { buffer: imgs.bedroom, mimetype: 'image/jpeg' },
        bathroom: { buffer: imgs.bathroom, mimetype: 'image/jpeg' },
      },
    })
  );
  console.log(
    `    state=${sub1.processingState} status=${sub1.property.status} tx=${sub1.verificationRecord?.txHash} block=${sub1.verificationRecord?.blockNumber}`
  );

  // 4. Guest Verify On-Chain -> MATCH
  const matchRes = await step('4. Guest Verify On-Chain (untampered -> MATCH)', () =>
    verifyRecordOnChain(prop1.id, 0)
  );
  console.log(
    `    status=${matchRes.status} proofs=${matchRes.perPhoto.map((p) => p.onchainProofValid).join(',')}`
  );

  // 5. Tamper 1 byte of bedroom photo -> TAMPERED
  const bedroomPhoto = sub1.photos.find((p) => p.viewLabel === 'bedroom');
  const originalBytes = fs.readFileSync(bedroomPhoto.filePath);
  const tamperedBytes = Buffer.from(originalBytes);
  tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
  fs.writeFileSync(bedroomPhoto.filePath, tamperedBytes);

  const tamperRes = await step('5. Modify 1 byte of bedroom.jpg -> Verify On-Chain (TAMPERED)', () =>
    verifyRecordOnChain(prop1.id, 0)
  );
  console.log(
    `    status=${tamperRes.status} shaMatch=${tamperRes.perPhoto.map((p) => `${p.viewLabel}:${p.shaMatch}`).join(', ')}`
  );

  // Restore original bytes so listing stays clean for UI demo
  fs.writeFileSync(bedroomPhoto.filePath, originalBytes);

  // 6. Property #2 verified cleanly with studio photos + Property #3 tests resized duplicate -> UNDER_REVIEW -> Admin Approve -> EXPIRED
  const prop2 = await registerPropertyService({
    host,
    name: 'Cozy Oakwood Garden Studio',
    city: 'Oakland, CA',
    description: 'Quiet garden retreat near transit with modern bath and sunny reading nook.',
    bedrooms: 1,
    bathrooms: 1,
    maxGuests: 2,
    amenities: ['Wi-Fi', 'Kitchenette', 'Patio', 'Coffee Maker'],
    address: `${suffix} Pine Rd`,
    unitNumber: '9A',
    building: 'West',
    latitude: lat2,
    longitude: lon2,
    price: 118,
  });
  const sess2 = await createCaptureSession({ propertyId: prop2.id, host });
  await processPhotoUpload({
    propertyId: prop2.id,
    host,
    sessionId: sess2.id,
    nonce: sess2.nonce,
    latitude: lat2,
    longitude: lon2,
    filesByView: {
      living_room: { buffer: await loadDemoAsset('studio_living.jpg', seedBase + 101), mimetype: 'image/jpeg' },
      bedroom: { buffer: await loadDemoAsset('studio_bedroom.jpg', seedBase + 102), mimetype: 'image/jpeg' },
      bathroom: { buffer: await loadDemoAsset('studio_bathroom.jpg', seedBase + 103), mimetype: 'image/jpeg' },
    },
  });

  const lat3 = 37.7599 + (seedBase % 100) * 0.001;
  const lon3 = -122.4148 + (seedBase % 100) * 0.001;
  const prop3 = await registerPropertyService({
    host,
    name: 'Bayfront Vintage Suite',
    city: 'Berkeley, CA',
    description: 'Historic suite demonstrating 30-day monthly photo renewal expiry.',
    bedrooms: 1,
    bathrooms: 1,
    maxGuests: 2,
    amenities: ['Wi-Fi', 'Workspace'],
    address: `${suffix} Cedar Ave`,
    unitNumber: '2C',
    building: 'East',
    latitude: lat3,
    longitude: lon3,
    price: 132,
  });
  const sess3 = await createCaptureSession({ propertyId: prop3.id, host });
  const resizedLiving = await resizeJpeg(imgs.living_room);
  const sub3 = await step('6a. Upload resized duplicate -> UNDER_REVIEW (no chain tx)', async () => {
    const freshBed = await sharp(await loadDemoAsset('studio_bedroom.jpg', seedBase + 202))
      .resize(400, 300)
      .jpeg({ quality: 85 })
      .toBuffer();
    const freshBath = await sharp(await loadDemoAsset('studio_bathroom.jpg', seedBase + 203))
      .resize(400, 300)
      .jpeg({ quality: 85 })
      .toBuffer();
    return processPhotoUpload({
      propertyId: prop3.id,
      host,
      sessionId: sess3.id,
      nonce: sess3.nonce,
      latitude: lat3,
      longitude: lon3,
      filesByView: {
        living_room: { buffer: resizedLiving, mimetype: 'image/jpeg' },
        bedroom: { buffer: freshBed, mimetype: 'image/jpeg' },
        bathroom: { buffer: freshBath, mimetype: 'image/jpeg' },
      },
    });
  });
  console.log(`    state=${sub3.processingState} status=${sub3.property.status} similarFlag=${sub3.similarFlag}`);

  const sub3Approved = await step('6b. Admin approves flagged submission -> CONFIRMED on-chain', () =>
    adminApproveSubmission(sub3.id)
  );
  console.log(
    `    state=${sub3Approved.processingState} status=${sub3Approved.property.status} tx=${sub3Approved.txHash}`
  );

  // 7. Expiry demo (31-day-old listing -> EXPIRED)
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await prisma.property.update({
    where: { id: prop3.id },
    data: { lastVerifiedAt: thirtyOneDaysAgo },
  });
  const expiryRes = await step('7. Run checkExpiry (31 days elapsed -> EXPIRED)', () => runCheckExpiry());
  const prop3After = await prisma.property.findUnique({ where: { id: prop3.id } });
  console.log(`    updated=${expiryRes.updatedCount} prop3.status=${prop3After.status}`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Demo E2E failed:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
