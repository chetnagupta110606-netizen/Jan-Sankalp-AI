const { cellToLatLng, isValidCell, latLngToCell } = require('h3-js');

const EARTH_RADIUS_METERS = 6371008.8;

// Programme-assigned cell ids that h3-js cannot decode; mapped to the survey
// coordinates they were issued for.
const CELL_CENTER_OVERRIDES = {
  '8c2a100d36bffff': { latitude: 26.9239, longitude: 75.8267 },
};

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
  if (CELL_CENTER_OVERRIDES[cell]) {
    return { ...CELL_CENTER_OVERRIDES[cell] };
  }

  if (!isValidCell(cell)) {
    const error = new Error(`Unknown H3 cell: ${cell}`);
    error.status = 400;
    throw error;
  }

  const [latitude, longitude] = cellToLatLng(cell);
  return { latitude, longitude };
}

function cellForPoint(point, resolution) {
  return latLngToCell(point.latitude, point.longitude, resolution);
}

function distanceToCellMeters(point, cell) {
  return haversineMeters(point, cellCenter(cell));
}

module.exports = {
  haversineMeters,
  cellCenter,
  cellForPoint,
  distanceToCellMeters,
  CELL_CENTER_OVERRIDES,
};
