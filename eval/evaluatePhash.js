/**
 * Perceptual Hash (pHash) duplicate-detection evaluation script (ARCHITECTURE.md Section 14).
 * Generates a deterministic synthetic dataset:
 *   - 20 originals (registered baseline)
 *   - 10 resized copies (positives: should be flagged)
 *   - 10 cropped/edited copies (positives: should be flagged)
 *   - 5 unrelated images (negatives: should NOT be flagged)
 * Outputs TP, FP, TN, FN, Precision, and Recall at thresholds 3, 5, 8, 10.
 *
 * Run from repo root: node eval/evaluatePhash.js
 */
const { createRequire } = require('module');
const path = require('path');

const requireFromBackend = createRequire(
  path.resolve(__dirname, '../backend/package.json')
);
const sharp = requireFromBackend('sharp');
const {
  validateAndComputePhash,
  hammingDistance,
} = require('../backend/services/hashing');

function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

async function makeSyntheticImage(seed, width = 320, height = 240) {
  const rand = seededRand(seed);
  const bg = [
    Math.floor(30 + rand() * 190),
    Math.floor(30 + rand() * 190),
    Math.floor(30 + rand() * 190),
  ];

  const rects = [];
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rand() * (width - 30));
    const y = Math.floor(rand() * (height - 30));
    const w = Math.floor(15 + rand() * (width - x - 15));
    const h = Math.floor(15 + rand() * (height - y - 15));
    const r = Math.floor(rand() * 255);
    const g = Math.floor(rand() * 255);
    const b = Math.floor(rand() * 255);
    rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${r},${g},${b})" />`);
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgb(${bg[0]},${bg[1]},${bg[2]})" />
    ${rects.join('\n')}
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function makeResized(buffer) {
  return sharp(buffer).resize(200, 150).jpeg({ quality: 85 }).toBuffer();
}

async function makeCroppedEdited(buffer) {
  const meta = await sharp(buffer).metadata();
  const left = Math.floor(meta.width * 0.06);
  const top = Math.floor(meta.height * 0.06);
  const width = Math.floor(meta.width * 0.88);
  const height = Math.floor(meta.height * 0.88);

  return sharp(buffer)
    .extract({ left, top, width, height })
    .modulate({ brightness: 1.12 })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function main() {
  const originals = [];
  for (let i = 0; i < 20; i++) {
    originals.push(await makeSyntheticImage(1000 + i));
  }

  const baselineHashes = [];
  for (const buf of originals) {
    baselineHashes.push(await validateAndComputePhash(buf));
  }

  const testCases = [];
  for (let i = 0; i < 10; i++) {
    testCases.push({
      buffer: await makeResized(originals[i]),
      isDup: true,
      category: 'resized',
    });
  }
  for (let i = 10; i < 20; i++) {
    testCases.push({
      buffer: await makeCroppedEdited(originals[i]),
      isDup: true,
      category: 'cropped_edited',
    });
  }
  for (let i = 0; i < 5; i++) {
    testCases.push({
      buffer: await makeSyntheticImage(9000 + i),
      isDup: false,
      category: 'unrelated',
    });
  }

  const testHashes = [];
  for (const tc of testCases) {
    testHashes.push({
      phash: await validateAndComputePhash(tc.buffer),
      isDup: tc.isDup,
      category: tc.category,
    });
  }

  console.log('Dataset: 20 originals, 10 resized, 10 cropped/edited, 5 unrelated\n');
  console.log('Threshold |  TP |  FP |  TN |  FN | Precision |  Recall');
  console.log('------------------------------------------------------------');

  for (const threshold of [3, 5, 8, 10]) {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;

    for (const item of testHashes) {
      let minDist = Infinity;
      for (const base of baselineHashes) {
        const d = hammingDistance(item.phash, base);
        if (d < minDist) minDist = d;
      }

      const predictedDup = minDist <= threshold;
      if (predictedDup && item.isDup) tp += 1;
      else if (predictedDup && !item.isDup) fp += 1;
      else if (!predictedDup && !item.isDup) tn += 1;
      else fn += 1;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

    console.log(
      `${String(threshold).padStart(9)} | ${String(tp).padStart(3)} | ${String(fp).padStart(
        3
      )} | ${String(tn).padStart(3)} | ${String(fn).padStart(3)} | ${precision
        .toFixed(3)
        .padStart(9)} | ${recall.toFixed(3).padStart(7)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
