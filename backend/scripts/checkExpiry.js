const prisma = require('../prisma/client');
const { getConfig, PROPERTY_STATUS } = require('../config');
const { computeEffectiveStatus } = require('../services/propertyService');

/**
 * Persists derived DUE_SOON / EXPIRED status off-chain (no blockchain tx).
 * Never overwrites UNDER_REVIEW, REJECTED, or PENDING.
 */
async function runCheckExpiry(now = new Date()) {
  const candidates = await prisma.property.findMany({
    where: {
      status: { in: [PROPERTY_STATUS.VERIFIED, PROPERTY_STATUS.DUE_SOON] },
      lastVerifiedAt: { not: null },
    },
  });

  let updatedCount = 0;
  const changes = [];

  for (const prop of candidates) {
    const derived = computeEffectiveStatus(prop, now);
    if (derived !== prop.status) {
      await prisma.property.update({
        where: { id: prop.id },
        data: { status: derived },
      });
      updatedCount += 1;
      changes.push({ id: prop.id, name: prop.name, from: prop.status, to: derived });
    }
  }

  return { checkedCount: candidates.length, updatedCount, changes, config: getConfig() };
}

if (require.main === module) {
  runCheckExpiry()
    .then((result) => {
      console.log(
        `checkExpiry completed: checked=${result.checkedCount}, updated=${result.updatedCount}`
      );
      for (const c of result.changes) {
        console.log(`  - ${c.name} (${c.id}): ${c.from} -> ${c.to}`);
      }
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error('checkExpiry failed:', err);
      process.exit(1);
    });
}

module.exports = { runCheckExpiry };
