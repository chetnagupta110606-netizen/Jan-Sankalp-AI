const { cellToLatLng } = require('h3-js');

const EARTH_RADIUS_METERS = 6371008.8;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cellCenter(cell) {
  const [latitude, longitude] = cellToLatLng(cell);
  return { latitude, longitude };
}

function distanceToCellMeters(point, cell) {
  return haversineMeters(point, cellCenter(cell));
}

module.exports = { haversineMeters, cellCenter, distanceToCellMeters };
