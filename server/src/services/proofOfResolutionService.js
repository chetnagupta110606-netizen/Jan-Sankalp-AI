/**
 * Jan-Sankalp AI — Proof-of-Resolution anti-fraud helpers
 * ------------------------------------------------------------------
 * EXIF GPS extraction, haversine distance to the incident H3 cell,
 * and a lightweight structural / debris comparison between the
 * original incident photo and the field-officer resolution photo.
 * ------------------------------------------------------------------
 */

const exifr = require('exifr');

const TARGET_H3_CELL = '8c2a100d36bffff';
const TARGET_H3_CENTER = { lat: 26.9248, lng: 75.8273 };
const MAX_DISTANCE_METERS = 500;
const MIN_STRUCTURAL_CONFIDENCE = 0.65;
const SAMPLE_SIZE = 64;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bufferFromPayload(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value.buffer && Buffer.isBuffer(value.buffer)) return value.buffer;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const b64 = trimmed.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    try {
      return Buffer.from(b64, 'base64');
    } catch (_) {
      return null;
    }
  }
  return null;
}

async function extractExif(buffer) {
  if (!buffer || !buffer.length) {
    return { latitude: null, longitude: null, timestamp: null };
  }

  let gps = null;
  let parsed = null;
  try {
    gps = await exifr.gps(buffer);
  } catch (err) {
    console.warn('[proof] EXIF GPS parse warning:', err && err.message);
  }
  try {
    parsed = await exifr.parse(buffer, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'GPSDateStamp', 'GPSLatitude', 'GPSLongitude']
    });
  } catch (err) {
    console.warn('[proof] EXIF parse warning:', err && err.message);
  }

  const latitude = gps && Number.isFinite(Number(gps.latitude)) ? Number(gps.latitude) : null;
  const longitude = gps && Number.isFinite(Number(gps.longitude)) ? Number(gps.longitude) : null;
  const timestamp =
    (parsed && (parsed.DateTimeOriginal || parsed.CreateDate || parsed.ModifyDate)) || null;

  return {
    latitude,
    longitude,
    timestamp: timestamp ? new Date(timestamp).toISOString() : null
  };
}

function resolveHexCenter(incident = {}, body = {}) {
  const h3Index = String(body.h3Index || body.h3_index || incident.h3_index || TARGET_H3_CELL);
  const lat = Number(incident.latitude);
  const lng = Number(incident.longitude);
  if (h3Index === TARGET_H3_CELL) {
    return {
      h3Index,
      latitude: Number.isFinite(lat) ? lat : TARGET_H3_CENTER.lat,
      longitude: Number.isFinite(lng) ? lng : TARGET_H3_CENTER.lng
    };
  }
  return {
    h3Index,
    latitude: Number.isFinite(lat) ? lat : TARGET_H3_CENTER.lat,
    longitude: Number.isFinite(lng) ? lng : TARGET_H3_CENTER.lng
  };
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sampleLuma(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;
  const luma = [];
  for (let y = 0; y < SAMPLE_SIZE; y++) {
    const sy = Math.min(h - 1, Math.floor((y / SAMPLE_SIZE) * h));
    for (let x = 0; x < SAMPLE_SIZE; x++) {
      const sx = Math.min(w - 1, Math.floor((x / SAMPLE_SIZE) * w));
      const i = (sy * w + sx) * 4;
      luma.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
  }
  return luma;
}

function sobelEnergy(luma) {
  const n = SAMPLE_SIZE;
  const edges = new Array(n * n).fill(0);
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const gx =
        -luma[i - n - 1] + luma[i - n + 1] -
        2 * luma[i - 1] + 2 * luma[i + 1] -
        luma[i + n - 1] + luma[i + n + 1];
      const gy =
        -luma[i - n - 1] - 2 * luma[i - n] - luma[i - n + 1] +
        luma[i + n - 1] + 2 * luma[i + n] + luma[i + n + 1];
      edges[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return edges;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  if (!den) return 0;
  return num / den;
}

function localVarianceScore(luma) {
  const n = SAMPLE_SIZE;
  let acc = 0;
  let count = 0;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const window = [
        luma[i - n - 1], luma[i - n], luma[i - n + 1],
        luma[i - 1], luma[i], luma[i + 1],
        luma[i + n - 1], luma[i + n], luma[i + n + 1]
      ];
      const m = mean(window);
      const v = mean(window.map((p) => (p - m) ** 2));
      acc += v;
      count += 1;
    }
  }
  return count ? acc / count : 0;
}

function rubbleLikeRatio(image) {
  const data = image.bitmap.data;
  const total = image.bitmap.width * image.bitmap.height;
  let rubble = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = max === 0 ? 0 : (max - min) / max;
    // Dust / concrete / rubble: mid-luma, low saturation, slightly warm.
    if (luma > 55 && luma < 190 && sat < 0.28 && r >= g - 8) {
      rubble += 1;
    }
  }
  return total ? rubble / total : 0;
}

async function analyzeStructure(originalBuffer, resolutionBuffer) {
  let Jimp;
  try {
    Jimp = require('jimp');
  } catch (err) {
    return {
      matchConfidence: 0,
      rubbleDetected: true,
      geometryMatch: 0,
      debrisDelta: 1,
      error: 'Image decoder unavailable: ' + (err && err.message)
    };
  }

  if (!resolutionBuffer || !resolutionBuffer.length) {
    return {
      matchConfidence: 0,
      rubbleDetected: true,
      geometryMatch: 0,
      debrisDelta: 1,
      error: 'Resolution image missing.'
    };
  }

  const resolutionImage = await Jimp.read(resolutionBuffer);
  const afterLuma = sampleLuma(resolutionImage);
  const afterEdges = sobelEnergy(afterLuma);
  const afterTexture = localVarianceScore(afterLuma);
  const afterRubble = rubbleLikeRatio(resolutionImage);

  if (!originalBuffer || !originalBuffer.length) {
    // Without the original scene we cannot prove background geometry match.
    return {
      matchConfidence: 0,
      rubbleDetected: afterRubble > 0.12 || afterTexture > 280,
      geometryMatch: 0,
      debrisDelta: afterRubble,
      error: 'Original incident photo missing; geometry match cannot be verified.'
    };
  }

  const originalImage = await Jimp.read(originalBuffer);
  const beforeLuma = sampleLuma(originalImage);
  const beforeEdges = sobelEnergy(beforeLuma);
  const beforeTexture = localVarianceScore(beforeLuma);
  const beforeRubble = rubbleLikeRatio(originalImage);

  const lumaMatch = Math.max(0, Math.min(1, (pearson(beforeLuma, afterLuma) + 1) / 2));
  const edgeCorr = Math.max(0, Math.min(1, (pearson(beforeEdges, afterEdges) + 1) / 2));
  const beforeEdgeMean = mean(beforeEdges);
  const afterEdgeMean = mean(afterEdges);
  // Uniform/cleared scenes have almost no edges, so correlation is undefined.
  // Treat two low-energy backgrounds as matching geometry.
  const geometryMatch = (beforeEdgeMean < 12 && afterEdgeMean < 12)
    ? lumaMatch
    : edgeCorr;
  const matchConfidence = Number((geometryMatch * 0.7 + lumaMatch * 0.3).toFixed(4));

  // Debris is "still present" when the resolution photo retains rubble colour
  // and high-frequency texture instead of a cleared, lower-entropy scene.
  const debrisDelta = afterRubble - beforeRubble * 0.35;
  const texturePersists = afterTexture > Math.max(120, beforeTexture * 1.25);
  const rubbleDetected = debrisDelta > 0.04 || afterRubble > 0.12 || texturePersists;

  return {
    matchConfidence,
    rubbleDetected,
    geometryMatch: Number(geometryMatch.toFixed(4)),
    lumaMatch: Number(lumaMatch.toFixed(4)),
    debrisDelta: Number(debrisDelta.toFixed(4)),
    afterRubble: Number(afterRubble.toFixed(4)),
    beforeRubble: Number(beforeRubble.toFixed(4))
  };
}

module.exports = {
  TARGET_H3_CELL,
  TARGET_H3_CENTER,
  MAX_DISTANCE_METERS,
  MIN_STRUCTURAL_CONFIDENCE,
  bufferFromPayload,
  extractExif,
  haversineMeters,
  resolveHexCenter,
  analyzeStructure
};
