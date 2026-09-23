const exifr = require('exifr');

async function readGps(buffer) {
  const gps = await exifr.gps(buffer).catch(() => null);

  if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) {
    return null;
  }

  return { latitude: gps.latitude, longitude: gps.longitude };
}

async function readCaptureTime(buffer) {
  const tags = await exifr
    .parse(buffer, ['DateTimeOriginal', 'CreateDate'])
    .catch(() => null);

  const captured = tags && (tags.DateTimeOriginal || tags.CreateDate);
  return captured instanceof Date ? captured.toISOString() : null;
}

module.exports = { readGps, readCaptureTime };
