/**
 * Jan-Sankalp AI — Civic Region & SLA Service (shared domain logic)
 * ------------------------------------------------------------------
 * Holds the canonical region catalogue, transcript keyword parsing,
 * H3 spatial indexing, region resolution and SLA target computation.
 * Consumed by the ingest, geospatial, satellite and DPR controllers.
 * ------------------------------------------------------------------
 */

// ── Canonical monitored regions ────────────────────────────────────
const URBAN_REGIONS = [
  {
    label: 'New Delhi',
    locationName: 'New Delhi',
    category: 'Urban Transport',
    urgency: 'Critical',
    targetMinistry: 'Ministry of Housing and Urban Affairs',
    h3Index: '8c1f3d9b5a7f1e2',
    centerLat: 28.6139,
    centerLng: 77.209,
    budget: 470000000,
    impactedCitizens: 845000,
    priorityIndex: 94,
    alignmentScore: 96,
    summary: 'Urban transport remediation and integrated mobility infrastructure enhancement for the capital corridor.'
  },
  {
    label: 'Lucknow, Uttar Pradesh',
    locationName: 'Lucknow, Uttar Pradesh',
    category: 'General Infrastructure',
    urgency: 'Medium',
    targetMinistry: 'Ministry of Housing and Urban Affairs',
    h3Index: '893d8dcd553ffff',
    centerLat: 26.8467,
    centerLng: 80.9462,
    budget: 250000000,
    impactedCitizens: 500000,
    priorityIndex: 80,
    alignmentScore: 85,
    summary: 'Citizen-reported civic deficiency in Lucknow requires coordinated inspection.'
  },
  {
    label: 'Sitapur',
    locationName: 'Sitapur',
    category: 'Rural Roads',
    urgency: 'High',
    targetMinistry: 'Ministry of Rural Development',
    h3Index: '8c3b2e1c0a9f5d7',
    centerLat: 27.5728,
    centerLng: 80.6853,
    budget: 280000000,
    impactedCitizens: 640000,
    priorityIndex: 88,
    alignmentScore: 91,
    summary: 'Rural connectivity improvement with drainage resilience and road maintenance restoration for farm-to-market connectivity.'
  },
  {
    label: 'Kalahandi',
    locationName: 'Kalahandi',
    category: 'Disaster Resilience',
    urgency: 'Critical',
    targetMinistry: 'Ministry of Home Affairs',
    h3Index: '8c5a6d1e0f4b9c2',
    centerLat: 19.8968,
    centerLng: 83.1668,
    budget: 520000000,
    impactedCitizens: 920000,
    priorityIndex: 96,
    alignmentScore: 94,
    summary: 'Climate resilience and flood management interventions to reduce disaster vulnerability in the river basin.'
  },
  {
    label: 'Wayanad',
    locationName: 'Wayanad',
    category: 'Water Security',
    urgency: 'High',
    targetMinistry: 'Ministry of Jal Shakti',
    h3Index: '8c7d1e9b6a2f4c5',
    centerLat: 11.6854,
    centerLng: 76.132,
    budget: 390000000,
    impactedCitizens: 710000,
    priorityIndex: 90,
    alignmentScore: 92,
    summary: 'Water security and watershed protection to improve supply reliability and reduce seasonal scarcity risk.'
  },
  {
    label: 'Jaipur, Rajasthan',
    locationName: 'Jaipur, Rajasthan',
    // Incident-grade geocode for the walled-city collapse block. Pinned to the
    // same EPSG:4326 / WGS84 pair used by the client comparative slider so the
    // pre/post-monsoon rasters are differenced over an identical footprint.
    areaName: 'Subhash Chowk / Kishanpole, Jaipur',
    incidentLat: 26.9248,
    incidentLng: 75.8273,
    incidentZoom: 17,
    category: 'Monsoon Structural & Building Collapse Risk',
    urgency: 'High',
    targetMinistry: 'Jaipur Municipal Corporation (JMC) / JDA',
    h3Index: '8c2a100d36bffff',
    centerLat: 26.9248,
    centerLng: 75.8273,
    crs: 'EPSG:4326',
    budget: 410000000,
    impactedCitizens: 780000,
    priorityIndex: 91,
    alignmentScore: 93,
    summary: 'Monsoon-induced structural and building collapse risk remediation with drain desilting, heritage facade stabilisation and emergency response readiness across the Jaipur walled city and JDA periphery.'
  }
];

// SLA window (days) per urgency band.
const SLA_DAYS = {
  Critical: 30,
  High: 45,
  Medium: 60,
  Low: 90
};

// ── Transcript keyword inference ───────────────────────────────────
const CATEGORY_KEYWORDS = [
  { category: 'Water Security',    ministry: 'Ministry of Jal Shakti',                                        keywords: ['water', 'pipe', 'pipeline', 'tap', 'supply', 'drinking', 'well', 'borewell', 'jal', 'पानी', 'पाणी'] },
  { category: 'Rural Roads',       ministry: 'Ministry of Rural Development',                                 keywords: ['road', 'street', 'pothole', 'bridge', 'highway', 'connectivity', 'sadak', 'सड़क', 'रस्ता'] },
  { category: 'Urban Transport',   ministry: 'Ministry of Housing and Urban Affairs',                         keywords: ['traffic', 'signal', 'transport', 'bus', 'metro', 'mobility', 'congestion', 'यातायात'] },
  { category: 'Sanitation',        ministry: 'Ministry of Housing and Urban Affairs',                         keywords: ['sewage', 'sewer', 'drain', 'drainage', 'garbage', 'waste', 'toilet', 'sanitation', 'सीवर', 'कचरा'] },
  { category: 'Disaster Resilience', ministry: 'Ministry of Home Affairs',                                    keywords: ['flood', 'flooding', 'disaster', 'landslide', 'erosion', 'storm', 'बाढ़', 'बाढ'] },
  { category: 'Power & Energy',    ministry: 'Ministry of Power',                                             keywords: ['power', 'electricity', 'electric', 'transformer', 'outage', 'blackout', 'streetlight', 'बिजली'] },
  { category: 'Healthcare',        ministry: 'Ministry of Health and Family Welfare',                         keywords: ['hospital', 'clinic', 'health', 'medicine', 'doctor', 'ambulance', 'अस्पताल'] },
  { category: 'Education',         ministry: 'Ministry of Education',                                         keywords: ['school', 'college', 'education', 'classroom', 'teacher', 'शिक्षा'] }
];

const URGENCY_KEYWORDS = [
  { urgency: 'Critical', keywords: ['urgent', 'emergency', 'critical', 'severe', 'danger', 'dangerous', 'accident', 'death', 'collapsed', 'immediately', 'तत्काल', 'आपातकाल'] },
  { urgency: 'High',     keywords: ['major', 'serious', 'huge', 'broken', 'burst', 'overflow', 'blocked', 'बड़ी'] },
  { urgency: 'Medium',   keywords: ['problem', 'issue', 'delay', 'damaged', 'repair', 'समस्या'] },
  { urgency: 'Low',      keywords: ['minor', 'small', 'suggestion', 'request', 'सुझाव'] }
];

const LOCATION_KEYWORDS = [
  { pattern: ['new delhi', 'delhi', 'दिल्ली'], region: 'New Delhi' },
  { pattern: ['lucknow', 'लखनऊ'], region: 'Lucknow, Uttar Pradesh' },
  { pattern: ['sitapur', 'सीतापुर'], region: 'Sitapur' },
  { pattern: ['kalahandi', 'कालाहांडी'], region: 'Kalahandi' },
  { pattern: ['wayanad', 'वायनाड'], region: 'Wayanad' },
  // Walled-city incident micro-locations all resolve to the Jaipur region record,
  // whose geocode is already pinned to Subhash Chowk / Kishanpole.
  { pattern: ['jaipur', 'जयपुर', 'subhash chowk', 'kishanpole', 'kishan pole',
              'kishanpol', 'सुभाष चौक', 'किशनपोल'], region: 'Jaipur, Rajasthan' }
];

const LOCATION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'around', 'at', 'before', 'because', 'but',
  'during', 'for', 'from', 'has', 'in', 'is', 'near', 'of', 'on', 'or',
  'the', 'through', 'to', 'was', 'were', 'with', 'without', 'after',
  'problem', 'issue', 'road', 'street', 'drain', 'water', 'city'
]);

function extractUserLocation(transcript) {
  const text = String(transcript || '');
  const explicit = text.match(/\b(?:location|city)\s*[:=-]\s*([^,;.!?\n]+)/i);
  const contextual = explicit
    ? explicit[1]
    : (text.match(/\b(?:in|at|near|around)\s+(?:(?:the\s+)?city\s+of\s+)?([^,;.!?\n]+)/i) || [])[1];
  let candidate = contextual;

  if (!candidate) {
    const words = text.trim().split(/\s+/);
    const mentionsIssue = CATEGORY_KEYWORDS.some((entry) =>
      entry.keywords.some((keyword) => text.toLowerCase().includes(keyword))
    ) || URGENCY_KEYWORDS.some((entry) =>
      entry.keywords.some((keyword) => text.toLowerCase().includes(keyword))
    ) || /\b(?:problem|issue|repair|damage|damaged|broken|report|complaint|request)\b/i.test(text);
    if (words.length > 0 && words.length <= 3 && !/\d/.test(text) && !mentionsIssue) {
      candidate = text;
    }
  }
  if (!candidate) return null;

  const locationWords = candidate.trim().split(/\s+/);
  const selectedWords = [];
  for (const word of locationWords) {
    const normalized = word.replace(/^[^\p{L}]+|[^\p{L}.'-]+$/gu, '').toLowerCase();
    if (!normalized || LOCATION_STOP_WORDS.has(normalized)) break;
    selectedWords.push(word.replace(/^[^\p{L}]+|[^\p{L}.'-]+$/gu, ''));
    if (selectedWords.length === 3) break;
  }

  const locationName = selectedWords.join(' ').trim();
  return locationName || null;
}

/**
 * Infer category, urgency, ministry and location from a transcript.
 */
function parseTranscript(transcript = '') {
  const text = String(transcript || '').toLowerCase();

  const categoryMatch = CATEGORY_KEYWORDS.find((entry) =>
    entry.keywords.some((kw) => text.includes(kw))
  );

  const urgencyMatch = URGENCY_KEYWORDS.find((entry) =>
    entry.keywords.some((kw) => text.includes(kw))
  );

  const locationMatch = LOCATION_KEYWORDS.find((entry) =>
    entry.pattern.some((kw) => text.includes(kw))
  );

  // Explicit city mentions must override defaults. If the transcript names
  // a monitored region (e.g. "Jaipur"), return the canonical region record
  // so the controller can ground coordinates, H3 grid and category/urgency.
  const matchedRegion = locationMatch
    ? URBAN_REGIONS.find((r) => r.locationName === locationMatch.region || r.label === locationMatch.region)
    : null;
  const locationName = matchedRegion
    ? matchedRegion.locationName
    : extractUserLocation(transcript);

  return {
    category: matchedRegion ? matchedRegion.category : (categoryMatch ? categoryMatch.category : 'General Infrastructure'),
    ministry: matchedRegion ? matchedRegion.targetMinistry : (categoryMatch ? categoryMatch.ministry : 'Ministry of Housing and Urban Affairs'),
    urgency: matchedRegion ? matchedRegion.urgency : (urgencyMatch ? urgencyMatch.urgency : 'Medium'),
    locationName,
    region: matchedRegion ? { ...matchedRegion } : null
  };
}

/**
 * Compute an SLA target completion date based on urgency band.
 */
function computeSlaTargetDate(urgency = 'Medium', daysAheadOverride = null) {
  const days = Number.isFinite(daysAheadOverride)
    ? daysAheadOverride
    : (SLA_DAYS[urgency] || SLA_DAYS.Medium);
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Deterministic pseudo-H3 index for a coordinate pair when the region
 * is not part of the monitored catalogue.
 */
function deriveH3Index(lat, lng) {
  const base = Math.abs(Math.round((lat + 90) * 1000) * 31 + Math.round((lng + 180) * 1000));
  return `8c${base.toString(16).padStart(13, '0').slice(0, 13)}`;
}

/**
 * Resolve the best-matching region from free-form input.
 */
function resolveRegion(input = {}) {
  const { locationName, h3Index, coordinates } = input;
  const rawLat = Array.isArray(coordinates) ? Number(coordinates[0]) : Number(input.latitude);
  const rawLng = Array.isArray(coordinates) ? Number(coordinates[1]) : Number(input.longitude);
  // EPSG:4326 / WGS84 clamp — every region record that leaves this service is
  // guaranteed to be a legal [lat, lng] pair, which is what removes the
  // co-registration drift between the historical and current raster layers.
  const lat = Number.isFinite(rawLat) ? Math.max(-90, Math.min(90, rawLat)) : NaN;
  const lng = Number.isFinite(rawLng) ? Math.max(-180, Math.min(180, rawLng)) : NaN;

  if (h3Index) {
    const found = URBAN_REGIONS.find((r) => r.h3Index === h3Index);
    if (found) return { ...found };
  }

  if (locationName) {
    const needle = String(locationName).toLowerCase();
    const found = URBAN_REGIONS.find(
      (r) =>
        r.label.toLowerCase() === needle ||
        r.locationName.toLowerCase() === needle ||
        (r.areaName && r.areaName.toLowerCase() === needle)
    );
    if (found) return { ...found };
    // Free-form micro-location (e.g. "Subhash Chowk / Kishanpole, Jaipur").
    const keyword = LOCATION_KEYWORDS.find((entry) =>
      entry.pattern.some((p) => needle.includes(p))
    );
    if (keyword) {
      const byRegion = URBAN_REGIONS.find(
        (r) => r.label === keyword.region || r.locationName === keyword.region
      );
      if (byRegion) return { ...byRegion };
    }
    const unGeocodedName = String(locationName).trim();
    return {
      label: unGeocodedName,
      locationName: unGeocodedName,
      category: 'General Infrastructure',
      urgency: 'Medium',
      targetMinistry: 'Ministry of Housing and Urban Affairs',
      h3Index: null,
      centerLat: null,
      centerLng: null,
      budget: 250000000,
      impactedCitizens: 500000,
      priorityIndex: 80,
      alignmentScore: 85,
      summary: `Citizen-reported civic deficiency in ${unGeocodedName} requires coordinated inspection.`
    };
  }

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const found = URBAN_REGIONS.find(
      (r) => Math.abs(r.centerLat - lat) < 0.25 && Math.abs(r.centerLng - lng) < 0.25
    );
    if (found) return { ...found };
    // Off-catalogue coordinate → synthesise a region record.
    return {
      label: locationName || 'Citizen Reported Location',
      locationName: locationName || 'Citizen Reported Location',
      category: 'General Infrastructure',
      urgency: 'Medium',
      targetMinistry: 'Ministry of Housing and Urban Affairs',
      h3Index: deriveH3Index(lat, lng),
      centerLat: lat,
      centerLng: lng,
      budget: 250000000,
      impactedCitizens: 500000,
      priorityIndex: 80,
      alignmentScore: 85,
      summary: `Citizen-reported civic deficiency requires coordinated inspection near ${lat.toFixed(4)}, ${lng.toFixed(4)}.`
    };
  }

  return { ...URBAN_REGIONS[0] };
}

function buildPolygonForRegion(lat, lng, radius = 0.18) {
  const topLeft = [lng - radius, lat + radius];
  const topRight = [lng + radius, lat + radius];
  const bottomRight = [lng + radius, lat - radius];
  const bottomLeft = [lng - radius, lat - radius];
  return [[topLeft, topRight, bottomRight, bottomLeft, topLeft]];
}

function formatDisplayDate(dateString) {
  if (!dateString) return 'Not scheduled';
  const parsed = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(dateString);
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

module.exports = {
  URBAN_REGIONS,
  SLA_DAYS,
  parseTranscript,
  computeSlaTargetDate,
  deriveH3Index,
  resolveRegion,
  buildPolygonForRegion,
  formatDisplayDate
};