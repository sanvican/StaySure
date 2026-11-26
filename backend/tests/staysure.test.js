const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const request = require('supertest');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');

// Isolate test SQLite DB and private_media directory before loading app/prisma
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staysure-test-'));
const testDbPath = path.join(tmpDir, 'test.db');
const testMediaDir = path.join(tmpDir, 'private_media');
fs.mkdirSync(testMediaDir, { recursive: true });

process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.PRIVATE_MEDIA_DIR = testMediaDir;
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.FINGERPRINT_SECRET = 'test-fingerprint-secret';
process.env.CONTRACT_ADDRESS = ''; // Tests mock chain.js for isolated unit/API tests

execSync('npx prisma db push --skip-generate', {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: 'pipe',
});

const prisma = require('../prisma/client');
const app = require('../app');
const chain = require('../services/chain');
const {
  computePropertyFingerprint,
  computeEffectiveStatus,
  computeTrustIndex,
} = require('../services/propertyService');
const {
  buildLeavesForPhotos,
  getMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  computeMetadataHash,
} = require('../services/merkle');
const { computeSha256 } = require('../services/hashing');
const {
  submitApprovedSubmissionToChain,
  verifyRecordOnChain,
} = require('../services/verificationService');
const { runCheckExpiry } = require('../scripts/checkExpiry');

async function makeImage(seed, width = 240, height = 240) {
  const r = (seed * 53) % 200 + 30;
  const g = (seed * 97) % 200 + 30;
  const b = (seed * 131) % 200 + 30;
  const rects = [];
  for (let i = 0; i < 12; i++) {
    const x = (seed * (i + 5) * 29) % (width - 40);
    const y = (seed * (i + 9) * 37) % (height - 40);
    const cr = (r + i * 41) % 255;
    const cg = (g + i * 73) % 255;
    const cb = (b + i * 103) % 255;
    rects.push(`<rect x="${x}" y="${y}" width="45" height="45" fill="rgb(${cr},${cg},${cb})" />`);
  }
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgb(${r},${g},${b})" />
    ${rects.join('\n')}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

describe('StaySure Backend Suite', () => {
  // In-memory mock of PropertyRegistry.sol storage for isolated API/service tests
  const mockChainState = new Map();
  let mockTxCounter = 1;
  let shouldFailChain = false;

  const origChain = {
    isConfigured: chain.isConfigured,
    registerProperty: chain.registerProperty,
    submitVerification: chain.submitVerification,
    getReceiptIfExists: chain.getReceiptIfExists,
    parseVerifiedEvent: chain.parseVerifiedEvent,
    getVerification: chain.getVerification,
    verifyPhoto: chain.verifyPhoto,
  };

  before(() => {
    chain.isConfigured = () => true;
    chain.registerProperty = async (fp) => {
      if (mockChainState.has(fp)) throw new Error('Property already registered');
      mockChainState.set(fp, { records: [] });
      return `0xreg${String(mockTxCounter++).padStart(60, '0')}`;
    };
    chain.submitVerification = async (fp, merkleRoot, metadataHash) => {
      if (shouldFailChain) {
        throw new Error('Simulated RPC failure');
      }
      const entry = mockChainState.get(fp) || { records: [] };
      const recordIndex = entry.records.length;
      entry.records.push({
        merkleRoot,
        metadataHash,
        timestamp: Math.floor(Date.now() / 1000),
      });
      mockChainState.set(fp, entry);
      return {
        txHash: `0xtx${String(mockTxCounter++).padStart(61, '0')}`,
        blockNumber: 100 + mockTxCounter,
        recordIndex,
      };
    };
    chain.getReceiptIfExists = async (txHash) => {
      if (!txHash) return null;
      return { status: 1, blockNumber: 999, logs: [] };
    };
    chain.parseVerifiedEvent = () => ({ recordIndex: 0, blockNumber: 999 });
    chain.getVerification = async (fp, idx) => {
      const entry = mockChainState.get(fp);
      if (!entry || !entry.records[idx]) throw new Error('Invalid verification index');
      return entry.records[idx];
    };
    chain.verifyPhoto = async (fp, idx, proof, leaf) => {
      const entry = mockChainState.get(fp);
      if (!entry || !entry.records[idx]) throw new Error('Invalid verification index');
      return verifyMerkleProof(leaf, proof, entry.records[idx].merkleRoot);
    };
  });

  after(async () => {
    Object.assign(chain, origChain);
    await prisma.$disconnect();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    shouldFailChain = false;
    mockChainState.clear();
    await prisma.review.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.verificationRecord.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.submission.deleteMany();
    await prisma.captureSession.deleteMany();
    await prisma.property.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedUsers() {
    const pw = await bcrypt.hash('password123', 6);
    const host = await prisma.user.create({
      data: { username: 'host1', email: 'host@test.local', passwordHash: pw, role: 'HOST' },
    });
    const host2 = await prisma.user.create({
      data: { username: 'host2', email: 'host2@test.local', passwordHash: pw, role: 'HOST' },
    });
    const guest = await prisma.user.create({
      data: { username: 'guest1', email: 'guest@test.local', passwordHash: pw, role: 'GUEST' },
    });
    const admin = await prisma.user.create({
      data: { username: 'admin1', email: 'admin@test.local', passwordHash: pw, role: 'ADMIN' },
    });

    const login = async (username) => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username, password: 'password123' });
      return res.body.token;
    };

    return {
      host,
      host2,
      guest,
      admin,
      hostToken: await login('host1'),
      host2Token: await login('host2'),
      guestToken: await login('guest1'),
      adminToken: await login('admin1'),
    };
  }

  it('normalizes property fingerprints deterministically and rejects duplicates', async () => {
    const fp1 = computePropertyFingerprint('12 Elm St', 'Flat 4-B', 'North');
    const fp2 = computePropertyFingerprint('12 elm st!', 'flat 4 b', 'north');
    const fp3 = computePropertyFingerprint('12 Elm St', 'Flat 4-C', 'North');

    assert.equal(fp1, fp2);
    assert.notEqual(fp1, fp3);

    const { hostToken } = await seedUsers();
    const res1 = await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        name: 'Elm Loft',
        address: '12 Elm St',
        unitNumber: 'Flat 4-B',
        building: 'North',
        latitude: 37.7749,
        longitude: -122.4194,
        price: 120,
      });
    assert.equal(res1.status, 201);
    assert.ok(res1.body.registerTx);

    const resDup = await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        name: 'Elm Loft Copy',
        address: '12 elm st',
        unitNumber: 'flat 4 b',
        building: 'north',
        latitude: 37.7749,
        longitude: -122.4194,
        price: 120,
      });
    assert.equal(resDup.status, 400);
  });

  it('computes 3-leaf odd-node Merkle proofs and deterministic metadata hashes', () => {
    const photos = [
      { viewLabel: 'living_room', sha256: computeSha256(Buffer.from('living')) },
      { viewLabel: 'bathroom', sha256: computeSha256(Buffer.from('bath')) },
      { viewLabel: 'bedroom', sha256: computeSha256(Buffer.from('bed')) },
    ];
    const { labels, leaves } = buildLeavesForPhotos(photos);
    assert.deepEqual(labels, ['bathroom', 'bedroom', 'living_room']);

    const root = getMerkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      const proof = getMerkleProof(leaves, i);
      assert.equal(verifyMerkleProof(leaves[i], proof, root), true);
    }

    // Tampered leaf fails
    const fakeLeaf = buildLeavesForPhotos([
      { viewLabel: 'bathroom', sha256: computeSha256(Buffer.from('tampered')) },
    ]).leaves[0];
    assert.equal(verifyMerkleProof(fakeLeaf, getMerkleProof(leaves, 0), root), false);

    // Deterministic metadata hash
    const m1 = computeMetadataHash({
      propertyId: 'prop-1',
      sessionId: 'sess-1',
      nonce: 'abc123',
      serverTimestamp: '2026-11-26T00:00:00.000Z',
      photoCount: 3,
      merkleRoot: root,
    });
    const m2 = computeMetadataHash({
      propertyId: 'prop-1',
      sessionId: 'sess-1',
      nonce: 'abc123',
      serverTimestamp: '2026-11-26T00:00:00.000Z',
      photoCount: 3,
      merkleRoot: root,
    });
    assert.equal(m1, m2);
  });

  it('enforces session rules, GPS radius, and privacy split', async () => {
    const { hostToken, host2Token } = await seedUsers();

    const propRes = await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        name: 'Bay View',
        address: '100 Market St',
        latitude: 37.7749,
        longitude: -122.4194,
        price: 150,
      });
    const propId = propRes.body.id;

    // Public detail hides private address and exact GPS
    const pubRes = await request(app).get(`/api/properties/${propId}`);
    assert.equal(pubRes.status, 200);
    assert.equal(pubRes.body.address, undefined);
    assert.equal(pubRes.body.latitude, undefined);
    assert.equal(pubRes.body.approxLatitude, 37.77);

    // Non-owner cannot start session
    const badOwnerSess = await request(app)
      .post(`/api/properties/${propId}/capture-session`)
      .set('Authorization', `Bearer ${host2Token}`);
    assert.equal(badOwnerSess.status, 403);

    // Start valid session
    const sessRes = await request(app)
      .post(`/api/properties/${propId}/capture-session`)
      .set('Authorization', `Bearer ${hostToken}`);
    assert.equal(sessRes.status, 201);
    const { id: sessionId, nonce } = sessRes.body;

    const img1 = await makeImage(11);
    const img2 = await makeImage(12);
    const img3 = await makeImage(13);

    // Wrong nonce rejected
    const badNonce = await request(app)
      .post(`/api/properties/${propId}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', sessionId)
      .field('nonce', 'wrong-nonce')
      .field('latitude', '37.7749')
      .field('longitude', '-122.4194')
      .attach('living_room', img1, 'living.jpg')
      .attach('bedroom', img2, 'bed.jpg')
      .attach('bathroom', img3, 'bath.jpg');
    assert.equal(badNonce.status, 400);

    // GPS > 100m rejected
    const badGps = await request(app)
      .post(`/api/properties/${propId}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', sessionId)
      .field('nonce', nonce)
      .field('latitude', '37.7850')
      .field('longitude', '-122.4194')
      .attach('living_room', img1, 'living.jpg')
      .attach('bedroom', img2, 'bed.jpg')
      .attach('bathroom', img3, 'bath.jpg');
    assert.equal(badGps.status, 400);

    // Valid upload succeeds and marks session used
    const okUpload = await request(app)
      .post(`/api/properties/${propId}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', sessionId)
      .field('nonce', nonce)
      .field('latitude', '37.7749')
      .field('longitude', '-122.4194')
      .attach('living_room', img1, 'living.jpg')
      .attach('bedroom', img2, 'bed.jpg')
      .attach('bathroom', img3, 'bath.jpg');
    assert.equal(okUpload.status, 201);
    assert.equal(okUpload.body.propertyStatus, 'VERIFIED');

    // Reusing the same session is rejected
    const replay = await request(app)
      .post(`/api/properties/${propId}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', sessionId)
      .field('nonce', nonce)
      .field('latitude', '37.7749')
      .field('longitude', '-122.4194')
      .attach('living_room', img1, 'living.jpg')
      .attach('bedroom', img2, 'bed.jpg')
      .attach('bathroom', img3, 'bath.jpg');
    assert.equal(replay.status, 400);

    // Expired session rejected
    const sess2 = await request(app)
      .post(`/api/properties/${propId}/capture-session`)
      .set('Authorization', `Bearer ${hostToken}`);
    await prisma.captureSession.update({
      where: { id: sess2.body.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expiredRes = await request(app)
      .post(`/api/properties/${propId}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', sess2.body.id)
      .field('nonce', sess2.body.nonce)
      .field('latitude', '37.7749')
      .field('longitude', '-122.4194')
      .attach('living_room', img1, 'living.jpg')
      .attach('bedroom', img2, 'bed.jpg')
      .attach('bathroom', img3, 'bath.jpg');
    assert.equal(expiredRes.status, 400);
  });

  it('blocks exact SHA-256 reuse, flags pHash reuse for admin approval, and detects tampering', async () => {
    const { hostToken, adminToken } = await seedUsers();

    // Property 1
    const p1 = (
      await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          name: 'Prop One',
          address: '1 Alpha Ave',
          latitude: 37.7749,
          longitude: -122.4194,
          price: 100,
        })
    ).body;

    const s1 = (
      await request(app)
        .post(`/api/properties/${p1.id}/capture-session`)
        .set('Authorization', `Bearer ${hostToken}`)
    ).body;

    const img1 = await makeImage(101);
    const img2 = await makeImage(102);
    const img3 = await makeImage(103);

    await request(app)
      .post(`/api/properties/${p1.id}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', s1.id)
      .field('nonce', s1.nonce)
      .field('latitude', '37.7749')
      .field('longitude', '-122.4194')
      .attach('living_room', img1, 'living.jpg')
      .attach('bedroom', img2, 'bed.jpg')
      .attach('bathroom', img3, 'bath.jpg');

    // Verify untampered -> MATCH
    const verifyOk = await request(app).get(`/api/properties/${p1.id}/verify-onchain`);
    assert.equal(verifyOk.status, 200);
    assert.equal(verifyOk.body.status, 'MATCH');
    assert.equal(verifyOk.body.perPhoto.length, 3);
    assert.ok(verifyOk.body.perPhoto.every((x) => x.onchainProofValid && x.shaMatch));

    // Tamper 1 byte of bedroom.jpg on disk -> TAMPERED pinpointing bedroom
    const bedPhoto = await prisma.photo.findFirst({
      where: { propertyId: p1.id, viewLabel: 'bedroom' },
    });
    const origBytes = fs.readFileSync(bedPhoto.filePath);
    const tampered = Buffer.from(origBytes);
    tampered[tampered.length - 1] ^= 0xff;
    fs.writeFileSync(bedPhoto.filePath, tampered);

    const verifyBad = await request(app).get(`/api/properties/${p1.id}/verify-onchain`);
    assert.equal(verifyBad.status, 200);
    assert.equal(verifyBad.body.status, 'TAMPERED');
    const bedRow = verifyBad.body.perPhoto.find((x) => x.viewLabel === 'bedroom');
    assert.equal(bedRow.shaMatch, false);
    assert.equal(bedRow.onchainProofValid, false);

    // Delete file -> EVIDENCE_INCOMPLETE
    fs.unlinkSync(bedPhoto.filePath);
    const verifyMissing = await request(app).get(`/api/properties/${p1.id}/verify-onchain`);
    assert.equal(verifyMissing.status, 200);
    assert.equal(verifyMissing.body.status, 'EVIDENCE_INCOMPLETE');

    // Property 2 (far away > 30m)
    const p2 = (
      await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          name: 'Prop Two',
          address: '2 Beta Blvd',
          latitude: 37.8044,
          longitude: -122.2712,
          price: 110,
        })
    ).body;

    const s2 = (
      await request(app)
        .post(`/api/properties/${p2.id}/capture-session`)
        .set('Authorization', `Bearer ${hostToken}`)
    ).body;

    // Exact SHA-256 duplicate on Prop Two -> rejected 400
    const img4 = await makeImage(204);
    const img5 = await makeImage(205);
    const exactDupRes = await request(app)
      .post(`/api/properties/${p2.id}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', s2.id)
      .field('nonce', s2.nonce)
      .field('latitude', '37.8044')
      .field('longitude', '-122.2712')
      .attach('living_room', img1, 'living.jpg')
      .attach('bedroom', img4, 'bed.jpg')
      .attach('bathroom', img5, 'bath.jpg');
    assert.equal(exactDupRes.status, 400);

    // Resized copy -> flagged PENDING_REVIEW / UNDER_REVIEW (no chain tx)
    const resizedImg1 = await sharp(img1).resize(180, 180).jpeg({ quality: 85 }).toBuffer();
    const flaggedRes = await request(app)
      .post(`/api/properties/${p2.id}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', s2.id)
      .field('nonce', s2.nonce)
      .field('latitude', '37.8044')
      .field('longitude', '-122.2712')
      .attach('living_room', resizedImg1, 'living.jpg')
      .attach('bedroom', img4, 'bed.jpg')
      .attach('bathroom', img5, 'bath.jpg');
    assert.equal(flaggedRes.status, 201);
    assert.equal(flaggedRes.body.processingState, 'PENDING_REVIEW');
    assert.equal(flaggedRes.body.propertyStatus, 'UNDER_REVIEW');
    assert.equal(flaggedRes.body.similarFlag, true);
    assert.equal(flaggedRes.body.txHash, null);

    // Admin approves -> submitted to chain -> CONFIRMED / VERIFIED
    const approveRes = await request(app)
      .post(`/api/admin/submissions/${flaggedRes.body.submissionId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.processingState, 'CONFIRMED');
    assert.equal(approveRes.body.property.status, 'VERIFIED');
  });

  it('handles failed chain writes idempotently and never duplicates VerificationRecords', async () => {
    const { hostToken, adminToken } = await seedUsers();

    const p = (
      await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          name: 'Retry Loft',
          address: '77 Retry Way',
          latitude: 37.7749,
          longitude: -122.4194,
          price: 130,
        })
    ).body;

    const s = (
      await request(app)
        .post(`/api/properties/${p.id}/capture-session`)
        .set('Authorization', `Bearer ${hostToken}`)
    ).body;

    shouldFailChain = true;
    const uploadRes = await request(app)
      .post(`/api/properties/${p.id}/upload-photo`)
      .set('Authorization', `Bearer ${hostToken}`)
      .field('session_id', s.id)
      .field('nonce', s.nonce)
      .field('latitude', '37.7749')
      .field('longitude', '-122.4194')
      .attach('living_room', await makeImage(301), 'living.jpg')
      .attach('bedroom', await makeImage(302), 'bed.jpg')
      .attach('bathroom', await makeImage(303), 'bath.jpg');

    assert.equal(uploadRes.status, 201);
    assert.equal(uploadRes.body.processingState, 'FAILED');
    assert.notEqual(uploadRes.body.propertyStatus, 'VERIFIED');

    // Recover chain & retry via admin endpoint
    shouldFailChain = false;
    const retryRes = await request(app)
      .post(`/api/admin/submissions/${uploadRes.body.submissionId}/retry`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.body.processingState, 'CONFIRMED');

    // Calling submitApprovedSubmissionToChain again must be idempotent
    await submitApprovedSubmissionToChain(uploadRes.body.submissionId);
    const recordsCount = await prisma.verificationRecord.count({
      where: { propertyId: p.id },
    });
    assert.equal(recordsCount, 1);

    // verifyRecordOnChain still returns MATCH
    const check = await verifyRecordOnChain(p.id, 0);
    assert.equal(check.status, 'MATCH');
  });

  it('derives DUE_SOON / EXPIRED, protects UNDER_REVIEW & REJECTED, and blocks overlapping bookings', async () => {
    const { host, hostToken, guestToken } = await seedUsers();

    const p1 = (
      await request(app)
        .post('/api/properties')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({
          name: 'Freshness House',
          address: '55 Time St',
          latitude: 37.7749,
          longitude: -122.4194,
          price: 200,
        })
    ).body;

    // 26 days old -> DUE_SOON; 31 days old -> EXPIRED
    const d26 = new Date(Date.now() - 26 * 24 * 60 * 60 * 1000);
    const d31 = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    assert.equal(computeEffectiveStatus({ status: 'VERIFIED', lastVerifiedAt: d26 }), 'DUE_SOON');
    assert.equal(computeEffectiveStatus({ status: 'VERIFIED', lastVerifiedAt: d31 }), 'EXPIRED');

    // Trust Index calculation checks
    const ti = computeTrustIndex({
      status: 'VERIFIED',
      lastVerifiedAt: new Date(),
      needsReview: false,
      host: { identityVerified: true },
      verificationRecords: [{ id: '1' }, { id: '2' }],
      submissions: [],
    });
    assert.equal(ti.score, 90); // 30 + 25 + 20 + 15 + 0

    // Protected UNDER_REVIEW property must NOT be overwritten by checkExpiry
    const reviewProp = await prisma.property.create({
      data: {
        hostId: host.id,
        name: 'Protected Review',
        address: '88 Review Ln',
        latitude: 38.0,
        longitude: -122.0,
        price: 100,
        fingerprint: '0x' + 'ab'.repeat(32),
        status: 'UNDER_REVIEW',
        lastVerifiedAt: d31,
      },
    });
    await prisma.property.update({
      where: { id: p1.id },
      data: { status: 'VERIFIED', lastVerifiedAt: d31 },
    });

    await runCheckExpiry();
    const p1After = await prisma.property.findUnique({ where: { id: p1.id } });
    const reviewAfter = await prisma.property.findUnique({ where: { id: reviewProp.id } });
    assert.equal(p1After.status, 'EXPIRED');
    assert.equal(reviewAfter.status, 'UNDER_REVIEW');

    // Bookings: reject overlapping CONFIRMED dates, allow adjacent dates
    const b1 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ propertyId: p1.id, checkIn: '2026-12-01', checkOut: '2026-12-05' });
    assert.equal(b1.status, 201);
    assert.equal(b1.body.totalPrice, 800);

    const bOverlap = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ propertyId: p1.id, checkIn: '2026-12-04', checkOut: '2026-12-07' });
    assert.equal(bOverlap.status, 409);

    const bAdjacent = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ propertyId: p1.id, checkIn: '2026-12-05', checkOut: '2026-12-08' });
    assert.equal(bAdjacent.status, 201);

    // Cancelling a booking frees those dates
    const cancelRes = await request(app)
      .patch(`/api/bookings/${b1.body.id}/cancel`)
      .set('Authorization', `Bearer ${guestToken}`);
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.status, 'CANCELLED');

    const rebookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ propertyId: p1.id, checkIn: '2026-12-01', checkOut: '2026-12-05' });
    assert.equal(rebookRes.status, 201);
  });

  it('serves health endpoint and filters verified listings', async () => {
    const { hostToken } = await seedUsers();

    const health = await request(app).get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.db, 'connected');

    await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        name: 'Alpine Cabin',
        city: 'Tahoe, CA',
        description: 'Mountain getaway',
        bedrooms: 3,
        bathrooms: 2,
        maxGuests: 6,
        amenities: ['Fireplace', 'Wi-Fi'],
        address: '42 Pine Trail',
        latitude: 39.0968,
        longitude: -120.0324,
        price: 250,
      });

    const filtered = await request(app).get('/api/properties?q=tahoe&maxPrice=300');
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.length, 1);
    assert.equal(filtered.body[0].city, 'Tahoe, CA');
    assert.deepEqual(filtered.body[0].amenities, ['Fireplace', 'Wi-Fi']);
  });

  it('enforces RBAC: GUEST cannot create properties, HOST cannot create bookings', async () => {
    const { hostToken, guestToken, host2Token } = await seedUsers();

    // GUEST cannot POST /api/properties -> 403
    const guestPropRes = await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        name: 'Guest Prop',
        address: '99 Guest St',
        latitude: 37.7749,
        longitude: -122.4194,
        price: 100,
      });
    assert.equal(guestPropRes.status, 403);

    // Create a property as HOST
    const propRes = await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        name: 'RBAC Loft',
        address: '10 RBAC St',
        latitude: 37.7749,
        longitude: -122.4194,
        price: 100,
      });
    assert.equal(propRes.status, 201);

    // HOST cannot POST /api/bookings -> 403
    const hostBookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        propertyId: propRes.body.id,
        checkIn: '2026-12-01',
        checkOut: '2026-12-05',
      });
    assert.equal(hostBookRes.status, 403);

    // HOST cannot GET /api/bookings -> 403
    const hostBookList = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${hostToken}`);
    assert.equal(hostBookList.status, 403);

    // GUEST booking works
    const guestBookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        propertyId: propRes.body.id,
        checkIn: '2026-12-01',
        checkOut: '2026-12-05',
      });
    assert.equal(guestBookRes.status, 201);

    // Host A cannot capture on Host B's property -> 403
    const badCapture = await request(app)
      .post(`/api/properties/${propRes.body.id}/capture-session`)
      .set('Authorization', `Bearer ${host2Token}`);
    assert.equal(badCapture.status, 403);

    // GET /api/host/properties returns only own properties
    const hostProps = await request(app)
      .get('/api/host/properties')
      .set('Authorization', `Bearer ${host2Token}`);
    assert.equal(hostProps.status, 200);
    assert.equal(hostProps.body.length, 0);

    const ownProps = await request(app)
      .get('/api/host/properties')
      .set('Authorization', `Bearer ${hostToken}`);
    assert.equal(ownProps.status, 200);
    assert.equal(ownProps.body.length, 1);
    assert.equal(ownProps.body[0].name, 'RBAC Loft');
  });

  it('sorts by recommended (combinedScore DESC, avgRating tie-break), and most_rated', async () => {
    const { host, host2, guest } = await seedUsers();

    // Mark host2 as identityVerified so we can construct an exact combinedScore tie-pair
    await prisma.user.update({
      where: { id: host2.id },
      data: { identityVerified: true },
    });

    // Prop A: PENDING (0 photo), host1 (0 id), needsReview=false (20 dup), 0 history, avgRating=5.0 (10 pts)
    // trustScore = 30, combinedScore = (5.0/5)*100 + 30 = 130
    const propA = await prisma.property.create({
      data: {
        hostId: host.id,
        name: 'Prop A',
        address: '1 A St',
        latitude: 37.0,
        longitude: -122.0,
        price: 100,
        fingerprint: '0x' + 'aa'.repeat(32),
        status: 'PENDING',
        needsReview: false,
      },
    });

    // Prop B: PENDING (0 photo), host2 (25 id), needsReview=false (20 dup), 1 record (8 history), avgRating=3.5 (7 pts)
    // trustScore = 25 + 20 + 8 + 7 = 60, combinedScore = (3.5/5)*100 + 60 = 70 + 60 = 130 (EXACT TIE with Prop A!)
    const propB = await prisma.property.create({
      data: {
        hostId: host2.id,
        name: 'Prop B',
        address: '2 B St',
        latitude: 38.0,
        longitude: -121.0,
        price: 110,
        fingerprint: '0x' + 'bb'.repeat(32),
        status: 'PENDING',
        needsReview: false,
      },
    });
    const sessB = await prisma.captureSession.create({
      data: {
        propertyId: propB.id,
        hostId: host2.id,
        nonce: 'nonce-b',
        requiredViews: '["living_room","bedroom","bathroom"]',
        expiresAt: new Date(Date.now() + 60000),
        used: true,
      },
    });
    const subB = await prisma.submission.create({
      data: {
        propertyId: propB.id,
        sessionId: sessB.id,
        processingState: 'CONFIRMED',
      },
    });
    await prisma.verificationRecord.create({
      data: {
        propertyId: propB.id,
        submissionId: subB.id,
        recordIndex: 0,
        merkleRoot: '0x' + '11'.repeat(32),
        metadataHash: '0x' + '22'.repeat(32),
        txHash: '0x' + '33'.repeat(32),
        blockNumber: 1,
      },
    });

    // Prop C: VERIFIED (30 photo), host1 (0 id), needsReview=false (20 dup), 0 history, avgRating=2.0 (4 pts)
    // trustScore = 54, combinedScore = (2.0/5)*100 + 54 = 94
    const propC = await prisma.property.create({
      data: {
        hostId: host.id,
        name: 'Prop C',
        address: '3 C St',
        latitude: 39.0,
        longitude: -120.0,
        price: 120,
        fingerprint: '0x' + 'cc'.repeat(32),
        status: 'VERIFIED',
        lastVerifiedAt: new Date(),
        needsReview: false,
      },
    });

    const pw = await bcrypt.hash('password123', 6);
    const guest2 = await prisma.user.create({
      data: { username: 'guest2', email: 'g2@test.local', passwordHash: pw, role: 'GUEST' },
    });
    const guest3 = await prisma.user.create({
      data: { username: 'guest3', email: 'g3@test.local', passwordHash: pw, role: 'GUEST' },
    });

    await prisma.review.createMany({
      data: [
        { propertyId: propA.id, guestId: guest.id, rating: 5, comment: 'Great!' },
        { propertyId: propB.id, guestId: guest.id, rating: 3, comment: 'OK' },
        { propertyId: propB.id, guestId: guest2.id, rating: 4, comment: 'Good' },
        { propertyId: propC.id, guestId: guest.id, rating: 2, comment: 'Meh' },
        { propertyId: propC.id, guestId: guest2.id, rating: 2, comment: 'Meh 2' },
        { propertyId: propC.id, guestId: guest3.id, rating: 2, comment: 'Meh 3' },
      ],
    });

    // recommended: A (130, avg 5.0) > B (130, avg 3.5) > C (94, avg 2.0)
    const recommended = await request(app).get('/api/properties?sort=recommended');
    assert.equal(recommended.status, 200);
    assert.equal(recommended.body.length, 3);
    assert.equal(recommended.body[0].name, 'Prop A');
    assert.equal(recommended.body[0].combinedScore, 130);
    assert.equal(recommended.body[1].name, 'Prop B');
    assert.equal(recommended.body[1].combinedScore, 130);
    assert.equal(recommended.body[2].name, 'Prop C');

    // most_rated: C (3 reviews) > B (2 reviews) > A (1 review)
    const mostRated = await request(app).get('/api/properties?sort=most_rated');
    assert.equal(mostRated.status, 200);
    assert.deepEqual(
      mostRated.body.map((p) => p.name),
      ['Prop C', 'Prop B', 'Prop A']
    );
  });

  it('creates reviews, rejects duplicates, rejects HOST role', async () => {
    const { host, hostToken, guestToken, guest } = await seedUsers();

    // Create property
    const propRes = await request(app)
      .post('/api/properties')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        name: 'Review Loft',
        address: '55 Review Ln',
        latitude: 37.7749,
        longitude: -122.4194,
        price: 100,
      });
    assert.equal(propRes.status, 201);
    const propId = propRes.body.id;

    // GUEST needs a booking first
    const bookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        propertyId: propId,
        checkIn: '2026-12-01',
        checkOut: '2026-12-03',
      });
    assert.equal(bookRes.status, 201);

    // GUEST creates review
    const reviewRes = await request(app)
      .post(`/api/properties/${propId}/reviews`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ rating: 4, comment: 'Lovely place!' });
    assert.equal(reviewRes.status, 201);
    assert.equal(reviewRes.body.rating, 4);

    // Duplicate review -> 409
    const dupRes = await request(app)
      .post(`/api/properties/${propId}/reviews`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ rating: 5, comment: 'Again!' });
    assert.equal(dupRes.status, 409);

    // HOST cannot review -> 403
    const hostReviewRes = await request(app)
      .post(`/api/properties/${propId}/reviews`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ rating: 5, comment: 'Self review' });
    assert.equal(hostReviewRes.status, 403);

    // Check property detail has rating
    const detail = await request(app).get(`/api/properties/${propId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.averageRating, 4);
    assert.equal(detail.body.ratingCount, 1);
    assert.equal(detail.body.reviews.length, 1);
  });
});
