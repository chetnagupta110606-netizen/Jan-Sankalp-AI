const Jimp = require('jimp');

const SAMPLE_SIZE = 128;
const WINDOW = 8;
const L = 255;
const C1 = (0.01 * L) ** 2;
const C2 = (0.03 * L) ** 2;

async function toGrayscaleMatrix(buffer) {
  const image = await Jimp.read(buffer);
  image.resize(SAMPLE_SIZE, SAMPLE_SIZE).grayscale();

  const pixels = new Float64Array(SAMPLE_SIZE * SAMPLE_SIZE);
  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      pixels[y * SAMPLE_SIZE + x] = image.bitmap.data[image.getPixelIndex(x, y)];
    }
  }
  return pixels;
}

function windowStats(pixels, originX, originY) {
  let sum = 0;
  for (let y = 0; y < WINDOW; y += 1) {
    for (let x = 0; x < WINDOW; x += 1) {
      sum += pixels[(originY + y) * SAMPLE_SIZE + originX + x];
    }
  }
  const count = WINDOW * WINDOW;
  return { mean: sum / count, count };
}

function ssim(a, b) {
  let total = 0;
  let windows = 0;

  for (let originY = 0; originY + WINDOW <= SAMPLE_SIZE; originY += WINDOW) {
    for (let originX = 0; originX + WINDOW <= SAMPLE_SIZE; originX += WINDOW) {
      const statsA = windowStats(a, originX, originY);
      const statsB = windowStats(b, originX, originY);

      let varA = 0;
      let varB = 0;
      let covariance = 0;

      for (let y = 0; y < WINDOW; y += 1) {
        for (let x = 0; x < WINDOW; x += 1) {
          const index = (originY + y) * SAMPLE_SIZE + originX + x;
          const deltaA = a[index] - statsA.mean;
          const deltaB = b[index] - statsB.mean;
          varA += deltaA * deltaA;
          varB += deltaB * deltaB;
          covariance += deltaA * deltaB;
        }
      }

      const divisor = statsA.count - 1;
      varA /= divisor;
      varB /= divisor;
      covariance /= divisor;

      const numerator =
        (2 * statsA.mean * statsB.mean + C1) * (2 * covariance + C2);
      const denominator =
        (statsA.mean ** 2 + statsB.mean ** 2 + C1) * (varA + varB + C2);

      total += numerator / denominator;
      windows += 1;
    }
  }

  return windows === 0 ? 0 : total / windows;
}

async function compareStructuralSimilarity(originalBuffer, resolutionBuffer) {
  const [original, resolution] = await Promise.all([
    toGrayscaleMatrix(originalBuffer),
    toGrayscaleMatrix(resolutionBuffer),
  ]);

  const score = ssim(original, resolution);
  return Math.min(1, Math.max(0, score));
}

module.exports = { compareStructuralSimilarity };
