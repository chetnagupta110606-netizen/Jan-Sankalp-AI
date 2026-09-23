const { latLngToCell } = require('h3-js');
const config = require('../config');
const { cellCenter } = require('../utils/geo');

const gazetteer = [
  {
    name: 'Jaipur Walled City',
    aliases: ['jaipur walled city', 'walled city', 'jaipur'],
    ...cellCenter(config.targetH3Cell),
  },
];

const URGENCY_KEYWORDS = [
  'collapse',
  'collapsed',
  'emergency',
  'flood',
  'fire',
  'landslide',
  'sinkhole',
];

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchPlace(text) {
  const haystack = normalise(text);
  if (!haystack) {
    return null;
  }

  let best = null;
  for (const place of gazetteer) {
    for (const alias of place.aliases) {
      if (haystack.includes(alias) && (!best || alias.length > best.alias.length)) {
        best = { place, alias };
      }
    }
  }

  return best
    ? {
        name: best.place.name,
        matchedText: best.alias,
        latitude: best.place.latitude,
        longitude: best.place.longitude,
        source: 'gazetteer',
      }
    : null;
}

function isEmergency(text) {
  const haystack = normalise(text);
  return URGENCY_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function extractLocation({ text, coordinates }) {
  if (
    coordinates &&
    Number.isFinite(coordinates.latitude) &&
    Number.isFinite(coordinates.longitude)
  ) {
    const place = matchPlace(text);
    return {
      name: place ? place.name : 'Shared pin',
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      source: 'whatsapp_location_attachment',
      h3Cell: latLngToCell(
        coordinates.latitude,
        coordinates.longitude,
        config.h3Resolution,
      ),
    };
  }

  const place = matchPlace(text);
  if (!place) {
    return null;
  }

  return {
    ...place,
    h3Cell: latLngToCell(place.latitude, place.longitude, config.h3Resolution),
  };
}

module.exports = { extractLocation, isEmergency, gazetteer };
