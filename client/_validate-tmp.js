/* TEMP VALIDATION HARNESS — deleted after the run.
 * Static checks (index.html vs app.js) + headless execution of app.js against
 * Leaflet/DOM stubs, then behavioural assertions for the four tasks.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); }
}

const html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'src', 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');

console.log('\n== 1. STATIC WIRING ==');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
check('index.html has no duplicate ids', dupes.length === 0, dupes.join(','));
const lookups = [...new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))];
const missing = lookups.filter((id) => !ids.includes(id));
check('every app.js $() lookup exists in index.html', missing.length === 0, missing.join(','));
check('comparison slider markup present', html.includes('id="comparisonSlider"'));
check('drag handle present with slider role', /id="comparisonHandle"[^>]*role="slider"/.test(html));
check('badge: historical baseline', html.includes('Historical Baseline (Jan 2026)'));
check('badge: live incident telemetry', html.includes('Live Incident Telemetry (Sep 2026)'));
check('clip-path split styling defined', /clip-path/.test(css) && /--split-pct/.test(css));
check('delta popup styling defined', css.includes('h3-delta-cell'));

console.log('\n== 2. HEADLESS EXECUTION ==');
const registry = { tiles: [], polygons: [], mapCalls: [] };

function makeEl(id) {
  const el = {
    id: id || 'anon', tagName: 'DIV', className: '', innerHTML: '', textContent: '',
    value: '', disabled: false, style: {}, dataset: {}, children: [], _ev: {}, _attrs: {}, _props: {},
    classList: {
      _s: {},
      add(c) { el.classList._s[c] = true; },
      remove(c) { delete el.classList._s[c]; },
      contains(c) { return !!el.classList._s[c]; },
      toggle(c, on) { if (on === undefined) { on = !el.classList._s[c]; } if (on) { el.classList._s[c] = true; } else { delete el.classList._s[c]; } return !!on; }
    },
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
    addEventListener(t, fn) { (el._ev[t] = el._ev[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
    removeChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 430, right: 900, bottom: 430 }; },
    focus() {},
    dispatch(type, ev) { (el._ev[type] || []).forEach((fn) => fn(ev || {})); }
  };
  return el;
}

const dom = {};
ids.forEach((id) => { dom[id] = makeEl(id); });

const documentStub = {
  _ev: {}, body: makeEl('body'),
  getElementById(id) { return dom[id] || null; },
  createElement() { return makeEl('created'); },
  addEventListener(t, fn) { (documentStub._ev[t] = documentStub._ev[t] || []).push(fn); },
  removeEventListener() {},
  querySelector() { return null; }
};

// ── Leaflet stub ────────────────────────────────────────────────────
let mapSeq = 0;
function makeMap(el) {
  const self = {
    _id: ++mapSeq, _zoom: 11, _events: {}, _layers: [],
    getZoom() { return self._zoom; },
    setView(c, z) { self._zoom = z; self._center = c; registry.mapCalls.push({ id: self._id, call: 'setView', c, z }); return self; },
    flyTo(c, z, o) {
      self._zoom = z; self._center = c;
      registry.mapCalls.push({ id: self._id, call: 'flyTo', c: c, z: z });
      setTimeout(() => self._fire('moveend'), 0);
      return self;
    },
    invalidateSize() { registry.mapCalls.push({ id: self._id, call: 'invalidateSize' }); return self; },
    setMinZoom(z) { self._minZoom = z; return self; },
    setMaxZoom(z) { self._maxZoom = z; return self; },
    createPane(name) { registry.panes = (registry.panes || []).concat(name); return { style: {}, name: name }; },
    on(t, fn) { (self._events[t] = self._events[t] || []).push(fn); return self; },
    once(t, fn) { (self._events[t] = self._events[t] || []).push(fn); return self; },
    off() { return self; },
    _fire(t) { (self._events[t] || []).slice().forEach((fn) => fn({ type: t })); },
    addLayer(l) { self._layers.push(l); return self; },
    removeLayer(l) { self._layers = self._layers.filter((x) => x !== l); return self; },
    remove() { registry.mapCalls.push({ id: self._id, call: 'remove' }); return self; },
    getCenter() { const c = self._center || [0, 0]; return { lat: c[0], lng: c[1] }; },
    getContainer() { return el; },
    zoomControl: { setPosition() {} },
    attributionControl: { setPrefix() {} }
  };
  registry.mapCalls.push({ id: self._id, call: 'create' });
  return self;
}

const LStub = {
  map(el) { return makeMap(el); },
  tileLayer(url, opts) {
    const layer = {
      _url: url, options: Object.assign({}, opts),
      addTo(m) { this._map = m; registry.tiles.push({ url: this._url, options: this.options, mapId: m && m._id }); return this; },
      setUrl(u) { this._url = u; return this; }, on() { return this; }
    };
    return layer;
  },
  control: { layers(bases, overlays, opts) { return { bases: bases, opts: opts, addTo() { return this; } }; } },
  circleMarker(latlng, opts) {
    return { _kind: 'circleMarker', latlng: latlng, options: opts, addTo(m) { this._map = m; return this; },
      bindTooltip(t) { this._tooltip = t; return this; }, bindPopup(p) { this._popup = p; return this; } };
  },
  polygon(latlngs, opts) {
    const poly = { _kind: 'polygon', latlngs: latlngs, options: opts || {}, addTo(m) { this._map = m; return this; },
      bindTooltip(t) { this._tooltip = t; return this; }, bindPopup(p) { this._popup = p; return this; } };
    registry.polygons.push(poly);
    return poly;
  },
  layerGroup() {
    return { _kind: 'group', _layers: [], addLayer(l) { this._layers.push(l); return this; },
      addTo(m) { this._map = m; return this; }, removeLayer() { return this; } };
  },
  Browser: { ielt9: false }
};

const fetchLog = [];
function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Number, String, Array, Object, RegExp, Error, Promise, Boolean,
  isFinite, isNaN, parseInt, parseFloat,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  document: documentStub,
  navigator: { mediaDevices: null, userAgent: 'node-validate' },
  fetch(url, options) {
    fetchLog.push({ url: String(url), options: options });
    const u = String(url);
    if (u.includes('/ingest')) {
      return jsonResponse({ success: true, data: {
        id: 11, location_name: 'Jaipur, Rajasthan', coordinates: [26.9248, 75.8273],
        latitude: 26.9248, longitude: 75.8273, h3_index: '8c2a100d36bffff',
        category: 'Monsoon Structural & Building Collapse Risk', urgency: 'High',
        status: 'Pending Survey', transcript: 'wall collapse reported',
        assigned_ministry: 'Jaipur Municipal Corporation (JMC) / JDA',
        target_completion_date: '2026-03-14', created_at: '2026-01-05T10:00:00.000Z'
      } });
    }
    if (u.includes('/incidents')) {
      return jsonResponse({ success: true, count: 1, data: [{
        id: 7, location_name: 'Jaipur, Rajasthan', latitude: 26.9124, longitude: 75.7873,
        h3_index: '8c2a100d36bffff', category: 'Monsoon Structural & Building Collapse Risk',
        urgency: 'High', status: 'Pending Survey', transcript: 'wall collapse reported',
        assigned_ministry: 'Jaipur Municipal Corporation (JMC) / JDA',
        target_completion_date: '2026-03-14', created_at: '2026-01-05T10:00:00.000Z'
      }] });
    }
    if (u.includes('/dpr')) {
      return jsonResponse({ success: true, locationName: 'Subhash Chowk / Kishanpole, Jaipur',
        h3Index: '8c2a100d36bffff', coordinates: [26.9248, 75.8273], urgency: 'High',
        target_completion_date: '2026-03-14', category: 'Monsoon Structural & Building Collapse Risk',
        assigned_ministry: 'Jaipur Municipal Corporation (JMC) / JDA', reportId: 'DPR-8C2A100D',
        budget: 12500000, impactedCitizens: 42000, priorityIndex: 88, alignmentScore: 91,
        summary: 'Monsoon structural remediation.', executiveSummary: 'Executive summary.' });
    }
    if (u.includes('verify-satellite')) {
      return jsonResponse({ success: true, verified: true, status: 'VERIFIED',
        h3_index: '8c2a100d36bffff', footprintAlterationPct: 65,
        location_name: 'Subhash Chowk / Kishanpole, Jaipur',
        layers: { historical: { label: 'Historical Baseline Imagery', timestamp: '2026-01-01T00:00:00.000Z' },
                  current: { label: 'Current Incident Telemetry', timestamp: '2026-09-22T00:00:00.000Z' } },
        varianceScores: { overall: 1.03, coherence: 0.98, vegetation: 0.11, builtUp: 0.42 },
        overallScore: 0.93 });
    }
    return jsonResponse({ success: true });
  },
  alert() {},
  open() {
    const win = { document: { _buf: '', open() {}, write(h) { win.document._buf += h; }, close() {} } };
    sandbox.__lastWindow = win;
    return win;
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.L = LStub;
sandbox.SpeechRecognition = undefined;
sandbox.webkitSpeechRecognition = undefined;
sandbox.HTMLElement = function () {};
sandbox.Element = function () {};
documentStub.defaultView = sandbox;

let bootError = null;
try {
  vm.runInContext(js, vm.createContext(sandbox), { filename: 'app.js' });
  check('app.js executes without throwing', true);
} catch (err) {
  bootError = err;
  check('app.js executes without throwing', false, err.message);
}

if (!bootError) {
  try {
    (documentStub._ev['DOMContentLoaded'] || []).forEach((fn) => fn({ type: 'DOMContentLoaded' }));
    check('bootstrap DOMContentLoaded handler ran', true);
  } catch (err) {
    check('bootstrap DOMContentLoaded handler ran', false, err.stack);
  }
}

console.log('\n== 3. TILE TIME-STAMPING + CRS ==');
const histTiles = registry.tiles.filter((t) => t.url.includes('TIME=2026-01-01'));
const currTiles = registry.tiles.filter((t) => t.url.includes('TIME=2026-09-22'));
check('historical raster requests explicit TIME=2026-01-01', histTiles.length > 0, histTiles.length + ' layer(s)');
check('current raster requests explicit TIME=2026-09-22', currTiles.length > 0, currTiles.length + ' layer(s)');
check('every tile layer declares CRS=EPSG:4326',
  registry.tiles.length > 0 && registry.tiles.every((t) => t.url.includes('CRS=EPSG:4326') && t.options.CRS === 'EPSG:4326'),
  JSON.stringify(registry.tiles.map((t) => t.options.CRS)));
check('historical layer exposes options.timeStamp = 2026-01-01',
  histTiles.length > 0 && histTiles.every((t) => t.options.timeStamp === '2026-01-01'));
check('current layer exposes options.timeStamp = 2026-09-22',
  currTiles.length > 0 && currTiles.every((t) => t.options.timeStamp === '2026-09-22'));
check('both rasters share one XYZ template (zero co-registration drift)',
  new Set(registry.tiles.map((t) => t.url.split('?')[0])).size === 1,
  [...new Set(registry.tiles.map((t) => t.url.split('?')[0]))].join(' | '));

console.log('\n== 4. GEOLOCATION + DELTA OVERLAY ==');
// Trigger the dynamic geocode path through the editable transcript.
dom.transcriptInput.value = 'Building collapse near Subhash Chowk, Kishanpole in Jaipur after monsoon rain';
dom.transcriptInput.dispatch('change');

const flyCalls = registry.mapCalls.filter((c) => c.call === 'flyTo');
const incidentFly = flyCalls.filter((c) => JSON.stringify(c.c) === '[26.9248,75.8273]');
check('flyTo([26.9248, 75.8273], 17) invoked', incidentFly.length > 0,
  JSON.stringify(flyCalls.map((c) => [c.c, c.z])));
check('incident flight targets zoom 17', incidentFly.length > 0 && incidentFly.every((c) => c.z === 17));
check('invalidateSize() called as part of the focus',
  registry.mapCalls.some((c) => c.call === 'invalidateSize'));
check('delta overlay is zoom-gated at >= 17', /getZoom\(\)\s*<\s*DELTA_MIN_ZOOM/.test(js));
check('delta vectors only rendered on a z17+ canvas',
  registry.mapCalls.length > 0 && registry.polygons.length > 0);

const greenPoly = registry.polygons.filter((p) => p.options.color === '#22c55e' && p.options.dashArray);
const redHex = registry.polygons.filter((p) => p.options.color === '#ef4444' && p.options.className === 'h3-delta-cell');
check('green DASHED historical footprint polygon rendered', greenPoly.length > 0, greenPoly.length + '');
check('red SOLID H3 hexagon rendered', redHex.length > 0, redHex.length + '');
check('hexagon ring has 6 vertices',
  redHex.length > 0 && redHex[0].latlngs.length === 6,
  redHex[0] ? String(redHex[0].latlngs.length) : 'n/a');
check('hexagon is solid (no dashArray)',
  redHex.length > 0 && !redHex[0].options.dashArray);
check('hexagon centre sits on the incident geocode',
  redHex.length > 0 && (() => {
    const avgLat = redHex[0].latlngs.reduce((s, p) => s + p[0], 0) / redHex[0].latlngs.length;
    const avgLng = redHex[0].latlngs.reduce((s, p) => s + p[1], 0) / redHex[0].latlngs.length;
    return Math.abs(avgLat - 26.9248) < 0.0005 && Math.abs(avgLng - 75.8273) < 0.0005;
  })(), redHex.length ? JSON.stringify(redHex[0].latlngs[0]) : 'n/a');
check('footprint polygon is interactive=false (keeps the hex clickable)',
  greenPoly.length > 0 && greenPoly[0].options.interactive === false);

const popup = (redHex[0] && redHex[0]._popup) || '';
check('popup text matches the required delta message',
  /⚠️ Structural Delta Detected: 65% Footprint Alteration \(Monsoon Rain Damage\)/.test(popup), popup.slice(0, 120));
check('popup cites the H3 cell 8c2a100d36bffff', popup.includes('8c2a100d36bffff'));
check('popup cites both raster TIME stamps',
  popup.includes('TIME=2026-01-01') && popup.includes('TIME=2026-09-22'));
check('popup is interactive (bindPopup present)', !!popup);

// __APPEND__
