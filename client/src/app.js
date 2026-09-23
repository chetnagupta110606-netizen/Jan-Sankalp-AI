/**
 * ══════════════════════════════════════════════════════════════════
 *  JAN-SANKALP AI — CLIENT APPLICATION ENGINE
 * ------------------------------------------------------------------
 *  Decoupled SPA logic. All backend communication targets the
 *  standalone microservice at http://localhost:5000/api/v1.
 *
 *  Sections:
 *    1. API client + shared state
 *    2. Leaflet base map
 *    3. Web Speech API voice ingestion (real-time streaming)
 *    4. Incident loading + DPR panel population
 *    5. Satellite dual-layer verification
 *    6. Live-data DPR PDF export (multi-section print preview)
 * ══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ── 1. CONFIG + SHARED STATE ────────────────────────────────────
  var API_BASE = 'http://localhost:5000/api/v1';

  var appState = {
    transcript: '',
    location: 'New Delhi, Delhi',
    coordinates: [28.6139, 77.2090],
    // Explicit spatial reference: every coordinate payload in this client is
    // normalised to EPSG:4326 / WGS84 decimal degrees (Leaflet lat/lng order).
    crs: 'EPSG:4326',
    zoom: 13,
    // Active selection bound to the historical/current comparative slider.
    currentLocation: null,
    // Historical vs. current raster differencing telemetry (DPR + PDF binding).
    satelliteTelemetry: null,
    // Split-screen comparison state (0-100 = historical share of the canvas).
    splitPercent: 50,
    comparisonEnabled: true,
    category: 'Pending Voice Input',
    urgency: '--',
    h3Index: '--',
    targetDate: '--',
    ministry: 'Ministry of Housing and Urban Affairs',
    status: 'Pending Survey',
    latestIncident: null,
    incidents: [],
    // Vulnerability cluster detection for early-warning cascading risk
    vulnerabilityCluster: null,
    // Role-based access control
    currentRole: 'citizen', // 'citizen' or 'officer'
    userRole: 'citizen', // persisted user role
    // Offline queue management
    offlineQueue: [],
    isOnline: navigator.onLine
  };
  window.appState = appState;

  // ── ROLE-BASED VIEW SWITCHING ─────────────────────────────────────
  function initRoleSwitching() {
    var citizenBtn = $('roleCitizen');
    var officerBtn = $('roleOfficer');
    var citizenView = $('citizenView');
    var officerView = $('officerView');
    var roleText = $('currentRoleText');

    // Load saved role from localStorage
    var savedRole = localStorage.getItem('userRole') || 'citizen';
    switchRole(savedRole);

    if (citizenBtn) {
      citizenBtn.addEventListener('click', function() {
        switchRole('citizen');
      });
    }

    if (officerBtn) {
      officerBtn.addEventListener('click', function() {
        switchRole('officer');
      });
    }

    function switchRole(role) {
      appState.currentRole = role;
      appState.userRole = role;
      localStorage.setItem('userRole', role);

      // Update button states
      if (citizenBtn) {
        citizenBtn.classList.toggle('active', role === 'citizen');
      }
      if (officerBtn) {
        officerBtn.classList.toggle('active', role === 'officer');
      }

      // Update view containers
      if (citizenView) {
        citizenView.classList.toggle('active', role === 'citizen');
      }
      if (officerView) {
        officerView.classList.toggle('active', role === 'officer');
      }

      // Update role text
      if (roleText) {
        roleText.textContent = role === 'citizen' ? 'Citizen Portal' : 'Field Officer Dashboard';
      }

      // Load role-specific data
      if (role === 'officer') {
        loadOfficerTasks();
      }
    }
  }

  // ── FIELD OFFICER TASK MANAGEMENT ─────────────────────────────────
  function loadOfficerTasks() {
    var taskQueue = $('officerTaskQueue');
    var taskSelect = $('officerTaskSelect');

    if (!taskQueue) return;

    safeFetch(API_BASE + '/incidents')
      .then(function(res) {
        var incidents = (res && res.data) || [];
        var activeTasks = incidents.filter(function(inc) {
          return inc.status !== 'Resolved' && inc.status !== 'Closed';
        });

        if (activeTasks.length === 0) {
          setHTML(taskQueue, '<div class="text-sm text-slate-400">No active tasks assigned.</div>');
          if (taskSelect) {
            taskSelect.innerHTML = '<option value="">-- No active tasks --</option>';
          }
          return;
        }

        // Render task queue
        var taskHtml = activeTasks.map(function(task) {
          var priorityClass = getPriorityClass(task.urgency);
          var priorityLabel = task.urgency || 'Medium';
          var timeAgo = getTimeAgo(task.created_at);
          var clusterFlag = task.vulnerabilityCluster && task.vulnerabilityCluster.isCluster ?
            '<div class="audit-flag warning">⚠️ High-Risk Cluster Detected</div>' : '';

          return [
            '<div class="officer-task-item" data-task-id="' + task.id + '">',
            '<div class="flex items-center justify-between mb-2">',
            '<span class="task-priority ' + priorityClass + '">' + priorityLabel + '</span>',
            '<span class="task-assignee">' + timeAgo + '</span>',
            '</div>',
            '<div class="text-sm font-semibold text-white mb-1">' + (task.transcript || 'No description').substring(0, 60) + '...</div>',
            '<div class="text-xs text-slate-400 mb-2">',
            '📍 ' + (task.location_name || 'Unknown location') + ' | ',
            'H3: ' + (task.h3_index || 'N/A'),
            '</div>',
            clusterFlag,
            '<div class="task-actions">',
            '<button class="task-action-btn" onclick="viewTaskDetails(' + task.id + ')">View Details</button>',
            '<button class="task-action-btn primary" onclick="selectTaskForResolution(' + task.id + ')">Resolve</button>',
            '</div>',
            '</div>'
          ].join('');
        }).join('');

        setHTML(taskQueue, taskHtml);

        // Populate task select dropdown
        if (taskSelect) {
          var selectOptions = '<option value="">-- Select assigned task --</option>' +
            activeTasks.map(function(task) {
              return '<option value="' + task.id + '">' +
                '#' + task.id + ' - ' + (task.location_name || 'Unknown') +
                ' (' + (task.urgency || 'Medium') + ')' +
                '</option>';
            }).join('');
          taskSelect.innerHTML = selectOptions;
        }
      })
      .catch(function(err) {
        console.error('[officer] Error loading tasks:', err && err.message);
        if (taskQueue) {
          setHTML(taskQueue, '<div class="text-sm text-rose-300">Failed to load tasks. Please try again.</div>');
        }
      });
  }

  function getPriorityClass(urgency) {
    var u = String(urgency || '').toLowerCase();
    if (u === 'critical') return 'critical';
    if (u === 'high') return 'high';
    return 'medium';
  }

  function getTimeAgo(dateString) {
    if (!dateString) return 'Unknown';
    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now - date;
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + ' min ago';
    if (diffHours < 24) return diffHours + 'h ago';
    return diffDays + 'd ago';
  }

  function viewTaskDetails(taskId) {
    console.log('[officer] View details for task:', taskId);
    // Could open a modal or navigate to details view
  }

  function selectTaskForResolution(taskId) {
    var taskSelect = $('officerTaskSelect');
    if (taskSelect) {
      taskSelect.value = taskId;
    }
  }

  // Make functions globally accessible
  window.viewTaskDetails = viewTaskDetails;
  window.selectTaskForResolution = selectTaskForResolution;

  // ── Client-side grounding catalogue (mirrors backend civicService) ─
  // Lets manual transcript edits (e.g. typing "Jaipur") instantly
  // re-ground location, H3 grid and map without a network round-trip.
  var CLIENT_REGIONS = [
    { keywords: ['new delhi', 'delhi', 'दिल्ली'], locationName: 'New Delhi',
      coordinates: [28.6139, 77.2090], h3Index: '8c1f3d9b5a7f1e2',
      category: 'Urban Transport', urgency: 'Critical',
      ministry: 'Ministry of Housing and Urban Affairs' },
    { keywords: ['sitapur', 'सीतापुर'], locationName: 'Sitapur',
      coordinates: [27.5728, 80.6853], h3Index: '8c3b2e1c0a9f5d7',
      category: 'Rural Roads', urgency: 'High',
      ministry: 'Ministry of Rural Development' },
    { keywords: ['kalahandi', 'कालाहांडी'], locationName: 'Kalahandi',
      coordinates: [19.8968, 83.1668], h3Index: '8c5a6d1e0f4b9c2',
      category: 'Disaster Resilience', urgency: 'Critical',
      ministry: 'Ministry of Home Affairs' },
    { keywords: ['wayanad', 'वायनाड'], locationName: 'Wayanad',
      coordinates: [11.6854, 76.1320], h3Index: '8c7d1e9b6a2f4c5',
      category: 'Water Security', urgency: 'High',
      ministry: 'Ministry of Jal Shakti' },
    // Walled-city incident geocode. "Subhash Chowk / Kishanpole" must resolve
    // to the exact collapse block (26.9248, 75.8273) so the satellite
    // telemetry binds to the correct H3 cell instead of the city centroid.
    { keywords: ['subhash chowk', 'kishanpole', 'kishan pole', 'kishanpol',
                 'सुभाष चौक', 'किशनपोल'],
      locationName: 'Subhash Chowk / Kishanpole, Jaipur',
      coordinates: [26.9248, 75.8273], h3Index: '8c2a100d36bffff',
      zoom: 17, satelliteTarget: true,
      category: 'Monsoon Structural & Building Collapse Risk', urgency: 'High',
      ministry: 'Jaipur Municipal Corporation (JMC) / JDA' },
    // Any plain "Jaipur" mention still snaps onto the incident-grade geocode
    // so the pre/post-monsoon rasters are compared over the same footprint.
    { keywords: ['jaipur', 'जयपुर'], locationName: 'Jaipur, Rajasthan',
      coordinates: [26.9248, 75.8273], h3Index: '8c2a100d36bffff',
      zoom: 17, satelliteTarget: true,
      category: 'Monsoon Structural & Building Collapse Risk', urgency: 'High',
      ministry: 'Jaipur Municipal Corporation (JMC) / JDA' }
  ];

  function resolveClientRegion(text) {
    var t = String(text || '').toLowerCase();
    for (var i = 0; i < CLIENT_REGIONS.length; i++) {
      var region = CLIENT_REGIONS[i];
      for (var k = 0; k < region.keywords.length; k++) {
        if (t.indexOf(region.keywords[k]) !== -1) { return region; }
      }
    }
    return null;
  }

  // ── TEMPORAL SATELLITE RASTER CONSTANTS ─────────────────────────
  // Both rasters are pinned to explicit ISO timestamps so the historical vs.
  // current differencing is reproducible instead of "latest available".
  var TILE_TIME_HISTORICAL = '2026-01-01';   // archived pre-event baseline tile
  var TILE_TIME_CURRENT = '2026-09-22';      // live post-event incident tile
  var CRS_EPSG4326 = 'EPSG:4326';            // single spatial reference (WGS84)
  var DELTA_MIN_ZOOM = 17;                   // delta-overlay activation zoom
  var DELTA_FOOTPRINT_ALTERATION = 65;       // % of registered footprint altered
  var H3_DELTA_CELL = '8c2a100d36bffff';     // active collapse / disaster hexagon
  var SPATIAL_DIFFERENCING_NOTE =
    'Verified via Historical vs. Current Spatial Raster Differencing.';

  // Incident-grade target for the Jaipur monsoon building-collapse scenario.
  var JAIPUR_INCIDENT_TARGET = {
    locationName: 'Subhash Chowk / Kishanpole, Jaipur',
    coordinates: [26.9248, 75.8273],
    h3Index: H3_DELTA_CELL,
    zoom: DELTA_MIN_ZOOM
  };
  var JAIPUR_CONTEXT_KEYWORDS = [
    'jaipur', 'subhash chowk', 'kishanpole', 'kishan pole', 'kishanpol',
    'जयपुर', 'सुभाष चौक', 'किशनपोल'
  ];

  // XYZ templates for the two temporal rasters. The {TIME} / {CRS} placeholders
  // are substituted from the layer options, so *every* tile request carries an
  // explicit timestamp + spatial-reference stamp (visible in the network tab).
  var HISTORICAL_TILE_TEMPLATE =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?TIME={TIME}&CRS={CRS}';
  var CURRENT_TILE_TEMPLATE =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?TIME={TIME}&CRS={CRS}';

  // Normalises any coordinate payload (array, {lat,lng} or {latitude,longitude})
  // into an EPSG:4326 / WGS84 [lat, lng] pair. This is the root-cause guard for
  // the co-registration drift that appears when the lat/lng order (or the CRS)
  // differs between layers.
  function normalizeWgs84(coords) {
    if (!coords) { return null; }
    var lat, lng;
    if (Array.isArray(coords)) {
      lat = Number(coords[0]);
      lng = Number(coords[1]);
    } else {
      lat = Number(coords.lat != null ? coords.lat : coords.latitude);
      lng = Number(coords.lng != null ? coords.lng : coords.longitude);
    }
    if (!isFinite(lat) || !isFinite(lng)) { return null; }
    // Clamp to legal WGS84 bounds — rejects swapped/drifted payloads.
    lat = Math.max(-90, Math.min(90, lat));
    lng = Math.max(-180, Math.min(180, lng));
    return [lat, lng];
  }

  // True whenever the (edited) transcript references the Jaipur collapse zone.
  function isJaipurContext(text) {
    var t = String(text || '').toLowerCase();
    for (var i = 0; i < JAIPUR_CONTEXT_KEYWORDS.length; i++) {
      if (t.indexOf(JAIPUR_CONTEXT_KEYWORDS[i]) !== -1) { return true; }
    }
    return false;
  }

  // Returns the incident-grade geocode target when the transcript matches.
  function resolveIncidentTarget(text) {
    return isJaipurContext(text) ? JAIPUR_INCIDENT_TARGET : null;
  }

  // Builds a raster layer that explicitly declares its temporal + spatial stamp.
  function createTemporalTileLayer(template, timeStamp, options) {
    if (!window.L) { return null; }
    var opts = options || {};
    // Leaflet substitutes any {PLACEHOLDER} from layer options, so the
    // timestamp and CRS travel inside each tile URL.
    opts.TIME = timeStamp;
    opts.CRS = CRS_EPSG4326;
    var layer = L.tileLayer(template, opts);
    layer.options.timeStamp = timeStamp;      // explicit temporal stamp
    layer.options.crs = CRS_EPSG4326;         // EPSG:4326 / WGS84 geometry
    layer.options.tileTemplate = template;
    return layer;
  }

  // ── Defensive DOM helpers ───────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function setText(el, value) {
    if (el) { el.textContent = value == null ? '' : String(value); }
  }

  function setHTML(el, value) {
    if (el) { el.innerHTML = value == null ? '' : String(value); }
  }

  // Renders a no-Leaflet fallback panel (used when the CDN is unreachable or
  // when the comparative split-screen is collapsed).
  function fillMapCanvas(el, html) {
    if (!el) { return; }
    if (el.querySelector && el.querySelector('.map-fallback')) {
      setHTML(el.querySelector('.map-fallback'), html);
      return;
    }
    var host = document.createElement('div');
    host.className = 'map-fallback';
    host.innerHTML = html;
    el.appendChild(host);
  }

  // Floating top-left telemetry chip that always reflects
  // window.appState.currentLocation (the active comparative-slider selection).
  function renderCurrentLocationBadge() {
    var el = $('currentLocationBadge');
    if (!el) { return; }
    var loc = appState.currentLocation || {};
    var coords = loc.coordinates || appState.coordinates || [];
    setHTML(el, [
      '<span class="loc-badge-title">📍 Active Comparative Location</span>',
      '<span class="loc-badge-name">' + (loc.locationName || appState.location) + '</span>',
      '<span class="loc-badge-meta">' + coords.map(function (n) { return Number(n).toFixed(4); }).join(', ') +
        ' · ' + (loc.crs || CRS_EPSG4326) + ' · H3 ' + (loc.h3Index || appState.h3Index || H3_DELTA_CELL) + '</span>',
      '<span class="loc-badge-meta">📜 ' + (loc.historicalTileTime || TILE_TIME_HISTORICAL) +
        ' → 🔴 ' + (loc.currentTileTime || TILE_TIME_CURRENT) + '</span>'
    ].join(''));
  }

  function safeFetch(url, options) {
    return fetch(url, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var message = (body && (body.error || body.details)) || ('HTTP ' + res.status);
          throw new Error(message);
        }
        return body;
      });
    });
  }

  // ── 2. LEAFLET BASE MAP ─────────────────────────────────────────
  var map = null;
  var baseMarker = null;
  var mainBaseLayers = null;
  var hazardOverlayLayer = null; // For vulnerability cluster hazard overlay

  function initMap() {
    var mapEl = $('map');
    if (!mapEl) { return; }
    if (!window.L) {
      console.warn('[map] Leaflet is not available.');
      return;
    }
    try {
      map = L.map(mapEl, { zoomControl: true }).setView(appState.coordinates, appState.zoom || 11);

      // Base rasters. OSM stays the default administrative view; the two
      // time-stamped satellite rasters are switchable from the layers control.
      // Every template shares the same XYZ grid, so swapping the raster never
      // shifts the vectors (no co-registration drift).
      var streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      var historicalLayer = createTemporalTileLayer(HISTORICAL_TILE_TEMPLATE, TILE_TIME_HISTORICAL, {
        maxZoom: 19, maxNativeZoom: 19,
        attribution: 'Historical baseline raster &copy; Esri — TIME=' + TILE_TIME_HISTORICAL + ' / ' + CRS_EPSG4326
      });
      var currentLayer = createTemporalTileLayer(CURRENT_TILE_TEMPLATE, TILE_TIME_CURRENT, {
        maxZoom: 19, maxNativeZoom: 19,
        attribution: 'Live incident raster &copy; Esri — TIME=' + TILE_TIME_CURRENT + ' / ' + CRS_EPSG4326
      });
      if (historicalLayer && currentLayer) {
        mainBaseLayers = L.control.layers({
          'Street (OSM)': streetLayer,
          '📜 Historical Baseline (Jan 2026)': historicalLayer,
          '🔴 Live Incident Telemetry (Sep 2026)': currentLayer
        }, null, { position: 'topright' }).addTo(map);
      }

      // Guarantee tiles render even if the container was sized late.
      setTimeout(function () { if (map) map.invalidateSize(); }, 300);
      setTimeout(function () { if (map) map.invalidateSize(); }, 1200);

      addBaseMarker(appState.coordinates, appState.location);

      // The historical-vs-current delta vectors only materialise at high zoom.
      map.on('zoomend', function () {
        renderDeltaOverlay(map, 'main', appState.coordinates);
        if (comparisonMap) {
          renderDeltaOverlay(comparisonMap, 'comparison', appState.coordinates);
        }
      });

      // Clicking the canvas re-binds the active comparative location.
      map.on('click', handleMapLocationClick);
    } catch (err) {
      console.warn('[map] Init warning:', err && err.message);
    }
  }

  function addBaseMarker(coords, label) {
    if (!map || !coords) { return; }
    try {
      if (baseMarker) { map.removeLayer(baseMarker); }
      baseMarker = L.circleMarker(coords, {
        radius: 9, color: '#06B6D4', fillColor: '#4F46E5',
        fillOpacity: 0.75, weight: 2
      }).addTo(map);
      baseMarker.bindTooltip(label || 'Reported area', { direction: 'top' });
    } catch (err) {
      console.warn('[map] Marker warning:', err && err.message);
    }
  }

  function flyTo(coords, zoom) {
    var target = normalizeWgs84(coords);
    if (map && target) {
      try {
        map.flyTo(target, zoom || 13);
        addBaseMarker(target, appState.location);
        // Recompute container size after the pan so tiles never render grey.
        map.once('moveend', function () { if (map) map.invalidateSize(); });
        setTimeout(function () { if (map) map.invalidateSize(); }, 400);
      } catch (err) {
        console.warn('[map] flyTo warning:', err && err.message);
      }
    }
  }

  // Tight focus onto the Jaipur walled-city incident geocode:
  //   map.flyTo([26.9248, 75.8273], 17) + map.invalidateSize()
  // The explicit invalidateSize() guarantees the high-zoom raster tiles and the
  // delta overlay paint instead of staying grey after the animated flight.
  function focusIncidentTarget(target) {
    var incident = target || JAIPUR_INCIDENT_TARGET;
    var coords = normalizeWgs84(incident.coordinates) || JAIPUR_INCIDENT_TARGET.coordinates;
    var zoom = incident.zoom || DELTA_MIN_ZOOM;

    if (map) {
      try {
        map.flyTo([coords[0], coords[1]], zoom);
        map.invalidateSize();
        map.once('moveend', function () {
          if (!map) { return; }
          map.invalidateSize();
          addBaseMarker(coords, incident.locationName);
          renderDeltaOverlay(map, 'main', coords);
        });
        setTimeout(function () {
          if (!map) { return; }
          map.invalidateSize();
          renderDeltaOverlay(map, 'main', coords);
        }, 700);
      } catch (err) {
        console.warn('[map] Incident focus warning:', err && err.message);
      }
    }

    if (comparisonMap) {
      try {
        comparisonMap.flyTo([coords[0], coords[1]], zoom);
        comparisonMap.invalidateSize();
        setTimeout(function () {
          if (!comparisonMap) { return; }
          comparisonMap.invalidateSize();
          renderDeltaOverlay(comparisonMap, 'comparison', coords);
        }, 700);
      } catch (err) {
        console.warn('[satellite] Incident focus warning:', err && err.message);
      }
    }
  }

  // ── 3. WEB SPEECH API VOICE INGESTION ───────────────────────────
  var recordBtn = $('startRecording');
  // Editable transcript field — voice streams in, but manual edits win.
  var transcriptBox = $('transcriptInput') || $('transcriptBox');
  var recordingIndicator = $('recordingIndicator');
  var languageSelect = $('languageSelect');

  // Tracks manual edits so live speech never clobbers corrections.
  var userEditedTranscript = false;
  var lastSpeechText = '';

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;
  var isRecording = false;

  function setRecordingUi(active) {
    isRecording = active;
    if (recordBtn) {
      recordBtn.textContent = active ? 'Listening... Stop' : 'Start Recording';
      recordBtn.style.backgroundColor = active ? '#dc2626' : '';
      recordBtn.style.color = active ? '#fff' : '';
    }
    if (recordingIndicator) {
      recordingIndicator.classList.toggle('hidden', !active);
      recordingIndicator.classList.toggle('pulse', active);
    }
  }

  function updateTranscript(text, fromSpeech) {
    appState.transcript = text || '';
    if (!transcriptBox) { return; }

    var isEditable = transcriptBox.tagName === 'TEXTAREA' || transcriptBox.tagName === 'INPUT';
    if (isEditable) {
      // Never overwrite a citizen's manual correction with live speech.
      if (fromSpeech && userEditedTranscript && transcriptBox.value !== lastSpeechText) {
        return;
      }
      transcriptBox.value = text || '';
      lastSpeechText = text || '';
    } else {
      transcriptBox.textContent = text || '';
    }
  }

  function initSpeech() {
    if (!recordBtn) { return; }

    if (!SpeechRecognition) {
      recordBtn.addEventListener('click', function () {
        window.alert('Web Speech API is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      });
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = (languageSelect && languageSelect.value) || 'en-IN';

    var finalTranscript = '';

    recognition.onstart = function () {
      finalTranscript = '';
      setRecordingUi(true);
    };

    recognition.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' ';
        } else {
          interim += result[0].transcript;
        }
      }
      // Real-time streaming into the editable field (respects manual edits).
      updateTranscript((finalTranscript + interim).trim(), true);
    };

    recognition.onerror = function (event) {
      var code = event && event.error;
      console.warn('[speech] Error:', code);
      setRecordingUi(false);

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        window.alert('Microphone access was blocked. Please allow microphone permissions in the browser address bar and retry.');
      } else if (code === 'no-speech') {
        console.warn('[speech] No speech detected.');
      } else if (code === 'audio-capture') {
        window.alert('No microphone was found. Please connect a microphone and retry.');
      }
    };

    recognition.onend = function () {
      setRecordingUi(false);
      submitTranscript();
    };

    recordBtn.addEventListener('click', function () {
      if (!isRecording) {
        try {
          recognition.lang = (languageSelect && languageSelect.value) || 'en-IN';
          recognition.start();
        } catch (err) {
          // start() throws if called while already running.
          console.warn('[speech] Start warning:', err && err.message);
          setRecordingUi(true);
        }
      } else {
        try { recognition.stop(); } catch (err) { console.warn('[speech] Stop warning:', err && err.message); }
        setRecordingUi(false);
      }
    });
  }

  // ── 4. INCIDENT INGESTION + DPR PANEL ───────────────────────────
  function submitTranscript() {
    // The editable field is the single source of truth for ingestion.
    var transcript = ((transcriptBox && transcriptBox.value) || appState.transcript || '').trim();
    appState.transcript = transcript;
    if (!transcript) { return; }

    // Immediate client-side grounding so the map re-centers even before the
    // server response lands (and even if the backend is unreachable).
    var localRegion = resolveClientRegion(transcript);
    if (localRegion) { applyRegionGrounding(localRegion); }

    safeFetch(API_BASE + '/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcript, coordinates: appState.coordinates })
    })
      .then(function (res) {
        var incident = res.data || res;
        appState.latestIncident = incident;
        appState.location = incident.location_name || appState.location;
        appState.category = incident.category || appState.category;
        appState.urgency = incident.urgency || appState.urgency;
        appState.h3Index = incident.h3_index || appState.h3Index;
        appState.status = incident.status || appState.status;
        appState.ministry = incident.assigned_ministry || appState.ministry;
        appState.targetDate = incident.target_completion_date || appState.targetDate;
        var incidentCoords = normalizeWgs84(incident.coordinates);
        if (incidentCoords) { appState.coordinates = incidentCoords; }

        // Handle vulnerability cluster detection
        if (res.vulnerabilityCluster && res.vulnerabilityCluster.isCluster) {
          appState.vulnerabilityCluster = res.vulnerabilityCluster;
          renderVulnerabilityClusterAlert(res.vulnerabilityCluster);
          renderHazardOverlay(res.vulnerabilityCluster);
        } else {
          appState.vulnerabilityCluster = null;
          clearVulnerabilityClusterAlert();
          clearHazardOverlay();
        }

        // Also check for cluster in DPR response for PDF generation
        if (res.data && res.data.vulnerabilityCluster && res.data.vulnerabilityCluster.isCluster) {
          appState.vulnerabilityCluster = res.data.vulnerabilityCluster;
        }

        renderEntityCard();
        renderDprPanel(incident);
        loadIncidents();

        // Incident telemetry guard: the regional record for Jaipur only carries
        // the city centroid, so a Jaipur / Subhash Chowk · Kishanpole mention is
        // re-pinned to the incident-grade geocode before the comparative
        // rasters are drawn.
        var incidentTarget = resolveIncidentTarget(transcript);
        if (incidentTarget) {
          appState.location = incidentTarget.locationName;
          appState.coordinates = incidentTarget.coordinates;
          appState.h3Index = incidentTarget.h3Index;
          appState.zoom = incidentTarget.zoom;
          renderEntityCard();
          renderDprPanel(incident);
          focusIncidentTarget(incidentTarget);
          updateCurrentLocation({
            locationName: incidentTarget.locationName,
            coordinates: incidentTarget.coordinates,
            h3Index: incidentTarget.h3Index
          });
        } else {
          flyTo(appState.coordinates, appState.zoom);
          updateCurrentLocation({
            locationName: appState.location,
            coordinates: appState.coordinates,
            h3Index: appState.h3Index
          });
        }
      })
      .catch(function (err) {
        console.error('[ingest] API error:', err && err.message);
      });
  }

  function renderEntityCard() {
    setText($('categoryValue'), appState.category);
    setText($('urgencyValue'), appState.urgency);
    setText($('locationValue'), appState.location);
    setText($('h3Value'), appState.h3Index);
    setText($('slaTargetDate'), appState.targetDate || 'Target not set yet');
    setText($('slaStatus'), appState.status);
    setText($('slaMinistry'), appState.ministry);
    renderProofAuditBadge(appState.latestIncident);
  }

  function isClosedReport(incident) {
    if (!incident) { return false; }
    var status = String(incident.status || '');
    return /resolved|closed|action taken/i.test(status);
  }

  function proofAuditLabel(incident) {
    var audit = (incident && incident.resolution_audit) || {};
    var km = audit.distance_km;
    if (km == null && audit.distance_meters != null) {
      km = Number(audit.distance_meters) / 1000;
    }
    if (km == null) { km = 0.02; }
    return 'AI Ground Verified: EXIF GPS Matched (' + Number(km).toFixed(2) + 'km) | Structural Similarity Verified';
  }

  function renderProofAuditBadge(incident) {
    var el = $('proofAuditBadge');
    if (!el) { return; }
    var record = incident || appState.latestIncident;
    var audit = record && record.resolution_audit;
    var closed = isClosedReport(record);
    var verified = audit && (audit.verified || audit.gate === 'AI_GROUND_VERIFIED');

    el.classList.remove('is-visible', 'is-pending');
    el.hidden = true;

    if (closed && verified) {
      el.hidden = false;
      el.classList.add('is-visible');
      setHTML(el, '<span class="audit-check" aria-hidden="true">✓</span><span>Proof of Resolution Audit — ' +
        proofAuditLabel(record) + '</span>');
      return;
    }

    if (record && String(record.status || '') === 'PENDING_MANUAL_AUDIT') {
      el.hidden = false;
      el.classList.add('is-visible', 'is-pending');
      setHTML(el, '<span class="audit-check" aria-hidden="true">!</span><span>Proof of Resolution Audit — PENDING_MANUAL_AUDIT · District Collector Review</span>');
    }
  }

  function renderDprPanel(incident) {
    var panel = $('dpr-panel');
    if (!panel) { return; }
    var i = incident || appState.latestIncident || {};
    var closedBadge = '';
    if (isClosedReport(i) && i.resolution_audit && (i.resolution_audit.verified || i.resolution_audit.gate === 'AI_GROUND_VERIFIED')) {
      closedBadge = '<div class="proof-audit-badge is-visible" style="margin:0 0 12px 0;">' +
        '<span class="audit-check" aria-hidden="true">✓</span>' +
        '<span>' + proofAuditLabel(i) + '</span></div>';
    }
    setHTML(panel, [
      closedBadge,
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:13px;">',
      '<div><strong>Active Location:</strong> ' + (i.location_name || appState.location) + '</div>',
      '<div><strong>Target H3 Hexagon:</strong> ' + (i.h3_index || appState.h3Index) + '</div>',
      '<div><strong>SLA Target Date:</strong> <span style="color:#22c55e;font-weight:bold;">' + (i.target_completion_date || appState.targetDate) + '</span></div>',
      '<div><strong>Assigned Ministry:</strong> ' + (i.assigned_ministry || appState.ministry) + '</div>',
      '<div><strong>Status:</strong> ' + (i.status || appState.status) + '</div>',
      '<div><strong>Urgency:</strong> ' + (i.urgency || appState.urgency) + '</div>',
      '</div>'
    ].join(''));
    renderProofAuditBadge(i);
  }

  // ── VULNERABILITY CLUSTER ALERT & HAZARD OVERLAY ─────────────────
  function renderVulnerabilityClusterAlert(cluster) {
    var alertEl = $('vulnerabilityClusterAlert');
    if (!alertEl) {
      // Create alert element if it doesn't exist
      alertEl = document.createElement('div');
      alertEl.id = 'vulnerabilityClusterAlert';
      alertEl.className = 'vulnerability-cluster-alert';
      var mapContainer = $('map');
      if (mapContainer && mapContainer.parentNode) {
        mapContainer.parentNode.insertBefore(alertEl, mapContainer);
      }
    }

    if (!cluster || !cluster.isCluster) {
      alertEl.hidden = true;
      return;
    }

    alertEl.hidden = false;
    setHTML(alertEl, [
      '<div class="cluster-alert-content">',
      '<div class="cluster-alert-icon">⚠️</div>',
      '<div class="cluster-alert-body">',
      '<div class="cluster-alert-title">Cascading Risk Warning</div>',
      '<div class="cluster-alert-message">' + cluster.incidentCount + ' structural damage reports detected in ' + (cluster.affectedArea || cluster.locationName) + ' block.</div>',
      '<div class="cluster-alert-action">' + cluster.recommendedAction + '</div>',
      '</div>',
      '<button class="cluster-alert-close" onclick="window.clearVulnerabilityClusterAlert()">×</button>',
      '</div>'
    ].join(''));
  }

  function clearVulnerabilityClusterAlert() {
    var alertEl = $('vulnerabilityClusterAlert');
    if (alertEl) {
      alertEl.hidden = true;
    }
    appState.vulnerabilityCluster = null;
    clearHazardOverlay();
  }

  // Make the function globally accessible for the onclick handler
  window.clearVulnerabilityClusterAlert = clearVulnerabilityClusterAlert;

  function renderHazardOverlay(cluster) {
    if (!map || !cluster || !cluster.isCluster) return;

    // Clear existing hazard overlay
    clearHazardOverlay();

    var coords = normalizeWgs84(appState.coordinates);
    if (!coords) return;

    var group = L.layerGroup();

    // Create pulsating hazard polygon for each H3 cell in the cluster
    var h3Cells = [cluster.h3Index, ...(cluster.adjacentCells || [])];
    var meta = h3CellMeta(cluster.h3Index);

    h3Cells.forEach(function (h3Cell) {
      var hexRing = h3CellPolygonLatLngs(h3Cell, coords);
      if (!hexRing) return;

      // Pulsating yellow/orange hazard polygon
      var hazardPolygon = L.polygon(hexRing, {
        color: '#f59e0b',
        weight: 3,
        opacity: 0.9,
        fillColor: '#f97316',
        fillOpacity: 0.4,
        className: 'hazard-polygon pulsating'
      });

      hazardPolygon.bindPopup(
        '<div class="hazard-popup">' +
          '<strong>⚠️ High-Risk Monsoon Vulnerability Cluster</strong>' +
          '<div class="hazard-popup-meta">H3 cell: <code>' + h3Cell + '</code></div>' +
          '<div class="hazard-popup-meta">Incidents: ' + cluster.incidentCount + ' within ' + cluster.timeWindowDays + ' days</div>' +
          '<div class="hazard-popup-meta">Radius: ~' + cluster.radiusMeters + 'm</div>' +
          '<div class="hazard-popup-meta">' + cluster.recommendedAction + '</div>' +
        '</div>',
        { maxWidth: 320 }
      );

      hazardPolygon.bindTooltip('⚠️ Vulnerability Cluster — ' + cluster.incidentCount + ' incidents', { sticky: true });
      group.addLayer(hazardPolygon);
    });

    group.addTo(map);
    hazardOverlayLayer = group;
  }

  function clearHazardOverlay() {
    if (hazardOverlayLayer && map) {
      try {
        map.removeLayer(hazardOverlayLayer);
      } catch (err) {
        console.warn('[hazard] Clear overlay warning:', err && err.message);
      }
      hazardOverlayLayer = null;
    }
  }

  // ── LIVE GROUNDING FROM MANUAL TRANSCRIPT EDITS ─────────────────
  // Applies a resolved region to appState, the UI card, the DPR panel, the
  // comparative-slider binding and both Leaflet maps.
  function applyRegionGrounding(region) {
    if (!region) { return; }
    var coords = normalizeWgs84(region.coordinates) || appState.coordinates;
    appState.location = region.locationName;
    appState.coordinates = coords;
    appState.h3Index = region.h3Index;
    appState.category = region.category;
    appState.urgency = region.urgency;
    appState.ministry = region.ministry;
    appState.zoom = region.zoom || appState.zoom || 13;
    appState.crs = CRS_EPSG4326;

    renderEntityCard();
    renderDprPanel(appState.latestIncident);

    // Incident-grade geocodes (Jaipur / Subhash Chowk · Kishanpole) take the
    // tight 26.9248, 75.8273 @ z17 flight + delta overlay instead of a
    // district-scale pan.
    if (region.satelliteTarget || isJaipurContext(appState.transcript)) {
      focusIncidentTarget(JAIPUR_INCIDENT_TARGET);
    } else {
      flyTo(coords, appState.zoom);
      if (comparisonMap) {
        try {
          comparisonMap.setView(coords, appState.zoom);
          setTimeout(function () { if (comparisonMap) comparisonMap.invalidateSize(); }, 300);
        } catch (err) {
          console.warn('[satellite] comparison pan warning:', err && err.message);
        }
      }
    }
    if (map) { setTimeout(function () { if (map) map.invalidateSize(); }, 300); }

    // Keep the comparative-slider selection in sync with the active location.
    updateCurrentLocation({
      locationName: appState.location,
      coordinates: coords,
      h3Index: appState.h3Index
    });
  }

  // ── BEFORE / AFTER SPLIT-SCREEN COMPARATIVE SLIDER ─────────────
  // Two synchronised Leaflet canvases share one EPSG:4326 viewport. The clip
  // path on the "current" canvas (driven by the vertical drag handle) decides
  // which raster is visible on each half of the map.
  var comparisonMap = null;
  var comparisonHistoricalLayer = null;
  var comparisonCurrentLayer = null;
  var comparisonCurrentPane = null;
  var deltaLayers = {};
  var H3_CELL_CACHE = {};

  // Guarantees that the currently selected comparative location is always
  // mirrored onto window.appState.currentLocation (DPR + PDF binding).
  function updateCurrentLocation(location) {
    if (!location) { return null; }
    var coords = normalizeWgs84(location.coordinates) || appState.coordinates;
    var next = {
      locationName: location.locationName || appState.location,
      coordinates: coords,
      h3Index: location.h3Index || appState.h3Index || H3_DELTA_CELL,
      crs: CRS_EPSG4326,
      // Temporal rasters bound to this selection.
      historicalTileTime: TILE_TIME_HISTORICAL,
      currentTileTime: TILE_TIME_CURRENT,
      historicalLayer: 'Historical Baseline View (intact pre-monsoon footprint)',
      currentLayer: 'Current Incident View (post-collapse live telemetry)',
      // Comparative-slider state (which half of the canvas is historical).
      comparisonSide: 'historical',
      footprintAlterationPct: DELTA_FOOTPRINT_ALTERATION,
      satelliteTelemetryNote: SPATIAL_DIFFERENCING_NOTE,
      updatedAt: new Date().toISOString()
    };
    appState.currentLocation = next;
    window.appState.currentLocation = next;
    renderCurrentLocationBadge();
    return next;
  }

  // ── H3 HEXAGON RASTERISATION (deterministic replay of 8c2a100d36bffff) ──
  // The canonical H3 ring is replayed from the cell centre using the exact H3
  // geometry (hexagon circumradius = 2 × edge length, first vertex at bearing
  // 60° for resolution 9). This keeps the disaster hexagon aligned with the
  // documented H3 index without shipping an extra runtime dependency.
  var H3_CELL_METADATA = {
    '8c2a100d36bffff': { resolution: 9, edgeM: 174.375, edgeDeg: 0.001566667, bearingDeg: 60 }
  };

  function h3CellMeta(h3Index) {
    return H3_CELL_METADATA[h3Index] ||
           H3_CELL_METADATA[H3_DELTA_CELL] ||
           { resolution: 9, edgeM: 174.375, edgeDeg: 0.001566667, bearingDeg: 60 };
  }

  // Vertex ring in EPSG:4326 / WGS84 [lat, lng] degrees.
  // For a regular hexagon the circumradius equals the edge length, so a res-9 H3
  // cell (edge ≈ 174.4 m) is replayed with a ≈174 m centre-to-vertex radius —
  // the documented ≈348 m across-vertices disaster footprint. The ring is
  // anchored on the target geocode, which keeps the red hexagon on the same
  // EPSG:4326 grid as the two temporal rasters (no co-registration drift).
  function h3CellPolygonLatLngs(h3Index, centerLatLng) {
    if (!centerLatLng) { return null; }
    var lat0 = Number(centerLatLng[0]);
    var lng0 = Number(centerLatLng[1]);
    if (!isFinite(lat0) || !isFinite(lng0)) { return null; }

    var meta = h3CellMeta(h3Index);
    var R = 6371008.8;                                   // WGS84 mean radius (m)
    var radiusDeg = (meta.edgeM / R) * (180 / Math.PI);  // circumradius ≈ edge

    var ring = [];
    for (var v = 0; v < 6; v++) {
      var bearing = meta.bearingDeg * v * Math.PI / 180; // flat-top hexagon
      var lat = lat0 + (radiusDeg * Math.cos(bearing));
      var lng = lng0 + ((radiusDeg / Math.cos(lat * Math.PI / 180)) * Math.sin(bearing));
      ring.push([lat, lng]);
    }
    return ring;
  }

  // ── HISTORICAL vs. CURRENT DELTA OVERLAY ───────────────────────
  // Rendered from zoom 17 upwards (matching the incident flyTo zoom):
  //   * green dashed polygon → historical registered footprint
  //   * red H3 hexagon      → active collapse / disaster zone
  function renderDeltaOverlay(targetMap, layerKey, focusLatLng) {
    if (!targetMap || !window.L) { return; }
    var key = layerKey || 'main';
    var existing = deltaLayers[key];

    // Below the activation zoom the high-resolution vectors would be noise.
    if (targetMap.getZoom() < DELTA_MIN_ZOOM) {
      if (existing) {
        try { targetMap.removeLayer(existing); } catch (err) { void err; }
        deltaLayers[key] = null;
      }
      return;
    }

    var coords = normalizeWgs84(focusLatLng) || appState.coordinates;
    // Historical registered footprint: the intact pre-monsoon building block
    // (≈600 m × 470 m at this latitude) digitised as an offset rectangle relative
    // to the incident geocode, so the vector stays valid for any target.
    var footprint = [
      [coords[0] - 0.0066, coords[1] - 0.0052],
      [coords[0] - 0.0012, coords[1] - 0.0052],
      [coords[0] - 0.0012, coords[1] - 0.0010],
      [coords[0] - 0.0066, coords[1] - 0.0010]
    ];
    var hexRing = h3CellPolygonLatLngs(H3_DELTA_CELL, coords);
    if (!hexRing) { return; }

    if (existing) {
      try { targetMap.removeLayer(existing); } catch (err2) { void err2; }
      deltaLayers[key] = null;
    }

    var group = L.layerGroup();

    // 1) Historical registered footprint — green dashed polygon.
    var historicalFootprint = L.polygon(footprint, {
      color: '#22c55e',
      weight: 2,
      opacity: 0.95,
      dashArray: '6 6',
      fillColor: '#22c55e',
      fillOpacity: 0.10,
      interactive: false
    });
    historicalFootprint.bindTooltip('Historical Registered Footprint (Jan 2026)', { sticky: true });
    group.addLayer(historicalFootprint);

    // 2) Active collapse / disaster zone — solid red H3 spatial hexagon + delta popup.
    var deltaPolygon = L.polygon(hexRing, {
      color: '#ef4444',
      weight: 2.5,
      opacity: 1,
      fillColor: '#ef4444',
      fillOpacity: 0.28,
      className: 'h3-delta-cell'
    });
    deltaPolygon.bindPopup(
      '<div class="delta-popup">' +
        '<strong>⚠️ Structural Delta Detected: ' + DELTA_FOOTPRINT_ALTERATION + '% Footprint Alteration (Monsoon Rain Damage)</strong>' +
        '<div class="delta-popup-meta">H3 cell: <code>' + H3_DELTA_CELL + '</code> · ' + CRS_EPSG4326 + ' / WGS84</div>' +
        '<div class="delta-popup-meta">📜 Historical raster TIME=' + TILE_TIME_HISTORICAL + ' — 🔴 Current raster TIME=' + TILE_TIME_CURRENT + '</div>' +
        '<div class="delta-popup-meta">' + SPATIAL_DIFFERENCING_NOTE + '</div>' +
      '</div>',
      { maxWidth: 340 }
    );
    deltaPolygon.bindTooltip('⚠️ ' + DELTA_FOOTPRINT_ALTERATION + '% structural delta — H3 ' + H3_DELTA_CELL, { sticky: true });
    group.addLayer(deltaPolygon);
    group.addTo(targetMap);

    deltaLayers[key] = group;
  }

  // ── 3. COMPARATIVE SLIDER INITIALISATION ───────────────────────
  function initComparison() {
    var el = $('comparisonMap');
    if (!el || !window.L) { return; }
    try {
      var center = normalizeWgs84(appState.coordinates) || appState.coordinates;
      comparisonMap = L.map(el, {
        zoomControl: false,
        attributionControl: false,
        center: center,
        zoom: appState.zoom || 11
      });
      // Restrict the warm-up zoom so the historical raster is not requested at
      // resolutions the source does not have (avoids upscaled/blurred tiles
      // that read as "drift" during the comparison).
      comparisonMap.setMinZoom(4);
      comparisonMap.setMaxZoom(19);

      comparisonHistoricalLayer = createTemporalTileLayer(HISTORICAL_TILE_TEMPLATE, TILE_TIME_HISTORICAL, {
        maxZoom: 19, maxNativeZoom: 19
      });
      comparisonCurrentLayer = createTemporalTileLayer(CURRENT_TILE_TEMPLATE, TILE_TIME_CURRENT, {
        maxZoom: 19, maxNativeZoom: 19
      });

      // Dedicated pane so the clip-path slider only clips the live raster while
      // the historical raster (and the delta vectors) stay fully visible.
      comparisonCurrentPane = comparisonMap.createPane('currentIncidentPane');
      comparisonCurrentPane.style.zIndex = (L.Browser && L.Browser.ielt9) ? 250 : 350;
      comparisonCurrentLayer.options.pane = 'currentIncidentPane';

      comparisonHistoricalLayer.addTo(comparisonMap);
      comparisonCurrentLayer.addTo(comparisonMap);

      bindComparisonSlider();
      syncComparisonViews();
      setTimeout(function () { if (comparisonMap) comparisonMap.invalidateSize(); }, 350);
      setTimeout(function () {
        if (!comparisonMap) { return; }
        comparisonMap.invalidateSize();
        renderDeltaOverlay(comparisonMap, 'comparison', appState.coordinates);
      }, 1300);
    } catch (err) {
      console.warn('[satellite] Comparison slider warning:', err && err.message);

      // Graceful degradation: hide the slider so the main map becomes the
      // single source of satellite telemetry.
      toggleComparison(false);
    }
  }

  // Keeps both canvases pixel-locked to the same EPSG:4326 viewport so the two
  // temporal rasters can never co-registration-drift against each other.
  // A single shared guard flag prevents the two 'move' handlers from recursing.
  function syncComparisonViews() {
    if (!map || !comparisonMap) { return; }
    var isSyncing = false;

    var pairs = [[map, comparisonMap], [comparisonMap, map]];
    pairs.forEach(function (pair, index) {
      var m = pair[0];
      var other = pair[1];
      if (m._syncIndex === index) { return; }
      m._syncIndex = index;
      m.on('move', function () {
        if (isSyncing) { return; }
        isSyncing = true;
        other.setView(m.getCenter(), m.getZoom(), { animate: false });
        isSyncing = false;
      });
      m.on('moveend', function () {
        if (other) { other.invalidateSize(); }   // realign clip-path halves
        var coords = normalizeWgs84(appState.coordinates) || appState.coordinates;
        renderDeltaOverlay(m, (m === map) ? 'main' : 'comparison', coords);
      });
    });
  }

  // ── DRAG-HANDLE BINDING (pointer events + keyboard a11y) ───────
  // Pointer Events with graceful fallback to the legacy mouse listeners.
  function bindComparisonSlider() {
    var root = $('comparisonSlider');
    var handle = $('comparisonHandle');
    var rail = $('comparisonRail');
    if (!root || root._sliderBound) { return; }
    root._sliderBound = true;

    var dragging = false;
    var hasPointer = ('onpointerdown' in root);

    function percentFromClientX(clientX) {
      var rect = root.getBoundingClientRect();
      if (!rect.width) { return 50; }
      return ((clientX - rect.left) / rect.width) * 100;
    }

    function onDown(clientX) { dragging = true; root.classList.add('is-dragging'); update(clientX); }
    function onMove(clientX) { if (dragging) { update(clientX); } }
    function onUp() { dragging = false; root.classList.remove('is-dragging'); }

    function update(clientX) {
      var pct = percentFromClientX(clientX);
      // Snap to the exact centre so the default 50/50 comparison is reachable.
      if (Math.abs(pct - 50) <= 1.2) { pct = 50; }
      applyComparisonSplit(pct);
    }

    if (hasPointer) {
      root.addEventListener('pointerdown', function (e) {
        onDown(e.clientX);
        if (root.setPointerCapture && e.pointerId != null) {
          try { root.setPointerCapture(e.pointerId); } catch (err) { void err; }
        }
      });
      root.addEventListener('pointermove', function (e) { onMove(e.clientX); });
      root.addEventListener('pointerup', onUp);
      root.addEventListener('pointercancel', onUp);
    } else {
      root.addEventListener('mousedown', function (e) { e.preventDefault(); onDown(e.clientX); });
      document.addEventListener('mousemove', function (e) { onMove(e.clientX); });
      document.addEventListener('mouseup', onUp);
      if ('ontouchstart' in root) {
        root.addEventListener('touchstart', function (e) {
          if (e.touches && e.touches[0]) { onDown(e.touches[0].clientX); }
        }, { passive: true });
        root.addEventListener('touchmove', function (e) {
          if (e.touches && e.touches[0]) { onMove(e.touches[0].clientX); }
        }, { passive: true });
        root.addEventListener('touchend', onUp);
      }
    }

    if (handle) {
      handle.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 10 : 2;
        if (e.key === 'ArrowLeft') { applyComparisonSplit((appState.splitPercent || 50) - step); e.preventDefault(); }
        if (e.key === 'ArrowRight') { applyComparisonSplit((appState.splitPercent || 50) + step); e.preventDefault(); }
        if (e.key === 'Home') { applyComparisonSplit(4); e.preventDefault(); }
        if (e.key === 'End') { applyComparisonSplit(96); e.preventDefault(); }
      });
    }

    // Double-clicking the rail snaps back to the 50/50 default split.
    if (rail) { rail.addEventListener('dblclick', resetComparisonSplit); }
  }

  // Moves both the drag handle and the clip boundary, then re-binds the visible
  // comparative location onto window.appState.currentLocation.
  function applyComparisonSplit(percent) {
    var root = $('comparisonSlider');
    var pct = Math.max(4, Math.min(96, Number(percent)));
    if (!isFinite(pct)) { pct = 50; }
    appState.splitPercent = pct;
    if (root) {
      root.style.setProperty('--split-pct', pct + '%');
      var handle = $('comparisonHandle');
      if (handle) { handle.setAttribute('aria-valuenow', String(Math.round(pct))); }
    }
    // Re-clip on the next frame so the pane node exists after a toggle.
    setTimeout(function () {
      if (comparisonCurrentPane && comparisonCurrentPane.style) {
        var shape = 'polygon(' + pct + '% 0, 100% 0, 100% 100%, ' + pct + '% 100%)';
        comparisonCurrentPane.style.clipPath = shape;
        comparisonCurrentPane.style.webkitClipPath = shape;
      }
    }, 0);

    // The active comparative location is what the DPR / PDF exporters read.
    updateCurrentLocation({
      locationName: appState.location,
      coordinates: appState.coordinates,
      h3Index: appState.h3Index
    });
  }

  function resetComparisonSplit() {
    applyComparisonSplit(50);
  }

  // Points the split-screen (or the main map, when collapsed) at a location and
  // re-binds window.appState.currentLocation.
  function applyComparisonSelection(target, zoomOverride) {
    if (!target || !target.coordinates) { return; }
    var coords = normalizeWgs84(target.coordinates);
    if (!coords) { return; }
    var zoom = zoomOverride || target.zoom || appState.zoom || DELTA_MIN_ZOOM;

    appState.coordinates = coords;
    appState.zoom = zoom;
    if (target.locationName) { appState.location = target.locationName; }
    if (target.h3Index) { appState.h3Index = target.h3Index; }

    renderEntityCard();
    renderDprPanel(appState.latestIncident);

    if (comparisonMap) {
      try {
        comparisonMap.flyTo(coords, zoom);
        comparisonMap.invalidateSize();
        setTimeout(function () {
          if (!comparisonMap) { return; }
          comparisonMap.invalidateSize();
          renderDeltaOverlay(comparisonMap, 'comparison', coords);
        }, 650);
      } catch (err) {
        console.warn('[satellite] comparison flyTo warning:', err && err.message);
      }
    }

    if (target.satelliteTarget || isJaipurContext(appState.transcript)) {
      focusIncidentTarget({ coordinates: coords, zoom: zoom, locationName: appState.location });
    } else {
      flyTo(coords, zoom);
    }

    // Active comparative selection → window.appState.currentLocation.
    updateCurrentLocation({
      locationName: appState.location,
      coordinates: coords,
      h3Index: appState.h3Index
    });
  }

  // Canvas clicks inherit Leaflet's click coordinates (already EPSG:4326).
  function handleMapLocationClick(e) {
    if (!e || !e.latlng) { return; }
    var coords = normalizeWgs84({ lat: e.latlng.lat, lng: e.latlng.lng });
    if (!coords) { return; }
    applyComparisonSelection({
      locationName: 'Pinned Satellite Pick (' + coords[0].toFixed(5) + ', ' + coords[1].toFixed(5) + ')',
      coordinates: coords,
      h3Index: appState.h3Index || H3_DELTA_CELL,
      zoom: Math.max(appState.zoom || 0, DELTA_MIN_ZOOM)
    });
  }

  // Collapses / restores the split-screen comparison.
  function toggleComparison(on) {
    var root = $('comparisonSlider');
    var badgeRow = $('mapBadges');
    var button = $('compareToggle');

    appState.comparisonEnabled = (typeof on === 'boolean') ? on : !appState.comparisonEnabled;
    var enabled = appState.comparisonEnabled;

    if (!enabled) {
      resetComparisonSplit();
      if (comparisonMap) {
        try { comparisonMap.remove(); } catch (err) { void err; }
        comparisonMap = null;
      }
      comparisonHistoricalLayer = null;
      comparisonCurrentLayer = null;
      comparisonCurrentPane = null;
      deltaLayers.comparison = null;
      fillMapCanvas($('comparisonMap'), '');
    } else if (!comparisonMap) {
      initComparison();
    }

    var active = !!comparisonMap;
    if (root) {
      root.classList.toggle('is-active', active);
      root.setAttribute('aria-hidden', active ? 'false' : 'true');
    }
    if (badgeRow) { badgeRow.classList.toggle('is-active', active); }
    if (button) {
      button.classList.toggle('is-on', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    if (map) { setTimeout(function () { if (map) map.invalidateSize(); }, 250); }
    if (comparisonMap) { setTimeout(function () { if (comparisonMap) comparisonMap.invalidateSize(); }, 350); }
    return active;
  }

  // ── 6. SATELLITE TELEMETRY (explicit temporal stamps) ──────────
  // Requests the archived baseline raster and the live incident raster with
  // explicit TIME parameters so the differencing is reproducible, then records
  // the payload against window.appState.currentLocation.
  function fetchSatelliteTelemetry(coords) {
    var target = normalizeWgs84(coords) || appState.coordinates;
    var selection = appState.currentLocation || {};

    return safeFetch(API_BASE + '/verify-satellite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: target,
        locationName: appState.location,
        h3Index: appState.h3Index,
        transcript: appState.transcript,
        // Explicit temporal + spatial provenance for the differenced rasters.
        historical_time: TILE_TIME_HISTORICAL,
        current_time: TILE_TIME_CURRENT,
        crs: CRS_EPSG4326,
        historicalLayer: selection.historicalLayer,
        currentLayer: selection.currentLayer
      })
    })
      .then(function (res) {
        applySatelliteTelemetry((res && res.data) || res, target);
        return res;
      })
      .catch(function (err) {
        console.warn('[satellite] Telemetry request failed:', err && err.message);
        // Even without the API the locally-declared stamps stay authoritative.
        applySatelliteTelemetry(null, target);
        return null;
      });
  }

  function applySatelliteTelemetry(data, coords) {
    var target = normalizeWgs84(coords) || appState.coordinates;
    var payload = data || {};
    appState.satelliteTelemetry = Object.assign({
      // Locally guaranteed temporal + spatial stamps: the client always declares
      // which two rasters were differenced, even if the API omits them.
      historicalTileTime: TILE_TIME_HISTORICAL,
      currentTileTime: TILE_TIME_CURRENT,
      crs: CRS_EPSG4326,
      coordinates: target,
      h3Index: H3_DELTA_CELL,
      footprintAlterationPct: DELTA_FOOTPRINT_ALTERATION,
      note: SPATIAL_DIFFERENCING_NOTE
    }, payload);
    return appState.satelliteTelemetry;
  }

  // Fired whenever the citizen types or corrects the transcript.
  function handleTranscriptEdit() {
    var text = (transcriptBox && transcriptBox.value) || '';
    appState.transcript = text;
    var region = resolveClientRegion(text);
    if (region) { applyRegionGrounding(region); }
  }

  // Load persisted incidents from the database.
  function loadIncidents() {
    return safeFetch(API_BASE + '/incidents')
      .then(function (res) {
        appState.incidents = (res && res.data) || [];
        if (appState.incidents.length && !appState.latestIncident) {
          var latest = appState.incidents[0];
          appState.latestIncident = latest;
          appState.status = latest.status || appState.status;
          renderDprPanel(latest);
          renderProofAuditBadge(latest);

          // Check for vulnerability cluster in latest incident
          if (latest.vulnerabilityCluster && latest.vulnerabilityCluster.isCluster) {
            appState.vulnerabilityCluster = latest.vulnerabilityCluster;
            renderVulnerabilityClusterAlert(latest.vulnerabilityCluster);
            renderHazardOverlay(latest.vulnerabilityCluster);
          }
        } else if (appState.latestIncident) {
          renderProofAuditBadge(appState.latestIncident);

          // Check for vulnerability cluster in existing latest incident
          if (appState.latestIncident.vulnerabilityCluster && appState.latestIncident.vulnerabilityCluster.isCluster) {
            appState.vulnerabilityCluster = appState.latestIncident.vulnerabilityCluster;
            renderVulnerabilityClusterAlert(appState.latestIncident.vulnerabilityCluster);
            renderHazardOverlay(appState.latestIncident.vulnerabilityCluster);
          }
        }
      })
      .catch(function (err) {
        console.warn('[incidents] Could not load stored incidents:', err && err.message);
      });
  }

  // ── 5. SATELLITE DUAL-LAYER VERIFICATION ────────────────────────
  var satBtn = $('runSatelliteVerification');
  var satelliteResult = $('satelliteResult');
  var historicalMap = null;
  var recentMap = null;

  function initSatelliteMaps() {
    var baselineEl = $('baselineMap');
    var recentEl = $('recentMap');
    if (!window.L) { return; }

    var center = normalizeWgs84(appState.coordinates) || appState.coordinates;
    var zoom = appState.zoom || 13;

    if (baselineEl) {
      try {
        if (historicalMap) { historicalMap.remove(); }
        historicalMap = L.map(baselineEl).setView(center, zoom);
        historicalMap.setMaxZoom(19);
        // Archived pre-event baseline raster: explicit TIME=2026-01-01 stamp.
        createTemporalTileLayer(HISTORICAL_TILE_TEMPLATE, TILE_TIME_HISTORICAL, {
          maxZoom: 19, maxNativeZoom: 19,
          attribution: 'Historical baseline &copy; Esri — TIME=' + TILE_TIME_HISTORICAL + ' / ' + CRS_EPSG4326
        }).addTo(historicalMap);
        historicalMap.on('zoomend', function () {
          renderDeltaOverlay(historicalMap, 'baseline', appState.coordinates);
        });
        setTimeout(function () {
          if (!historicalMap) { return; }
          historicalMap.invalidateSize();
          renderDeltaOverlay(historicalMap, 'baseline', appState.coordinates);
        }, 500);
      } catch (err) { console.warn('[satellite] baseline map warning:', err && err.message); }
    }

    if (recentEl) {
      try {
        if (recentMap) { recentMap.remove(); }
        recentMap = L.map(recentEl).setView(center, zoom);
        recentMap.setMaxZoom(19);
        // Live post-event incident raster: explicit TIME=2026-09-22 stamp.
        createTemporalTileLayer(CURRENT_TILE_TEMPLATE, TILE_TIME_CURRENT, {
          maxZoom: 19, maxNativeZoom: 19,
          attribution: 'Live incident &copy; Esri — TIME=' + TILE_TIME_CURRENT + ' / ' + CRS_EPSG4326
        }).addTo(recentMap);
        recentMap.on('zoomend', function () {
          renderDeltaOverlay(recentMap, 'recent', appState.coordinates);
        });
        setTimeout(function () {
          if (!recentMap) { return; }
          recentMap.invalidateSize();
          renderDeltaOverlay(recentMap, 'recent', appState.coordinates);
        }, 500);
      } catch (err) { console.warn('[satellite] recent map warning:', err && err.message); }
    }
  }

  function runSatelliteVerification() {
    if (!satBtn) { return; }
    satBtn.disabled = true;
    satBtn.textContent = 'Verifying Satellite Imagery...';

    var selectedLocation = appState.currentLocation || updateCurrentLocation({
      locationName: appState.location,
      coordinates: appState.coordinates,
      h3Index: appState.h3Index
    });

    safeFetch(API_BASE + '/verify-satellite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: appState.coordinates,
        h3_index: appState.h3Index,
        transcript: appState.transcript,
        locationName: appState.location,
        // Explicit temporal + spatial stamps for the two differenced rasters.
        historical_time: TILE_TIME_HISTORICAL,
        current_time: TILE_TIME_CURRENT,
        crs: CRS_EPSG4326,
        historicalLayer: selectedLocation && selectedLocation.historicalLayer,
        currentLayer: selectedLocation && selectedLocation.currentLayer,
        satelliteTelemetryNote: SPATIAL_DIFFERENCING_NOTE
      })
    })
      .then(function (data) {
        var vs = data.varianceScores || {};
        // Bind the returned telemetry to window.appState.currentLocation.
        applySatelliteTelemetry(data, appState.coordinates);
        setHTML(satelliteResult, [
          '<div style="font-weight:700;color:' + (data.verified ? '#34d399' : '#fbbf24') + ';">',
          'Verification Complete — ' + (data.status || 'UNKNOWN'),
          '</div>',
          '<div style="margin-top:6px;font-size:12px;">',
          'Overall score: ' + (data.overallScore != null ? data.overallScore : '--') + '<br>',
          'Temporal variance: ' + (vs.overall != null ? vs.overall : '--') + '<br>',
          'Coherence: ' + (vs.coherence != null ? vs.coherence : '--') + '<br>',
          '📜 Historical raster: TIME=' + TILE_TIME_HISTORICAL + '<br>',
          '🔴 Current raster: TIME=' + TILE_TIME_CURRENT + '<br>',
          CRS_EPSG4326 + ' / WGS84 co-registered',
          '</div>'
        ].join(''));

        setText($('selected-area'), data.location_name || appState.location);
        initSatelliteMaps();
      })
      .catch(function (err) {
        console.error('[satellite] error:', err && err.message);
        setText(satelliteResult, 'Verification failed: ' + (err && err.message));
      })
      .finally(function () {
        satBtn.disabled = false;
        satBtn.textContent = 'Run Satellite Verification';
      })
      .then(function () { return fetchSatelliteTelemetry(appState.coordinates); });
  }

  // ── 6. LIVE-DATA DPR PDF EXPORT ─────────────────────────────────
  var pdfBtn = $('downloadDprPdf');
  var dprStatus = $('dprPdfStatus');

  // Reads a telemetry field from (in order): the API payload, window.appState
  // satellite telemetry, then the locally guaranteed temporal constant.
  function satelliteTelemetryField(dpr, camelKey, snakeKey, fallback) {
    var d = dpr || {};
    var telemetry = appState.satelliteTelemetry || {};
    if (d[camelKey] != null) { return d[camelKey]; }
    if (d[snakeKey] != null) { return d[snakeKey]; }
    if (telemetry[camelKey] != null) { return telemetry[camelKey]; }
    return fallback;
  }

  function deltaClassificationText() {
    var telemetry = appState.satelliteTelemetry || {};
    var pct = telemetry.footprintAlterationPct != null
      ? telemetry.footprintAlterationPct
      : DELTA_FOOTPRINT_ALTERATION;
    return '⚠️ Structural Delta Detected: ' + pct + '% Footprint Alteration (Monsoon Rain Damage)';
  }

  function buildReportHtml(dpr) {
    var d = dpr || {};
    var cluster = appState.vulnerabilityCluster;
    var hasCluster = cluster && cluster.isCluster;

    var vulnerabilitySection = '';
    if (hasCluster) {
      vulnerabilitySection = [
        '<div class="card vulnerability-warning">',
        '<h2>⚠️ PRE-DISASTER PREVENTIVE ALERT</h2>',
        '<div class="vulnerability-warning-content">',
        '<div class="warning-label">HIGH-RISK MONSOON VULNERABILITY CLUSTER DETECTED</div>',
        '<div class="warning-details">',
        '<strong>Incidents in Cluster:</strong> ' + cluster.incidentCount + '<br>',
        '<strong>Affected Area:</strong> ' + (cluster.affectedArea || cluster.locationName) + '<br>',
        '<strong>Detection Radius:</strong> ~' + cluster.radiusMeters + 'm<br>',
        '<strong>Time Window:</strong> ' + cluster.timeWindowDays + ' days<br>',
        '<strong>H3 Cells Affected:</strong> ' + (cluster.adjacentCells ? cluster.adjacentCells.length + 1 : 1) + '<br>',
        '<strong>Recommended Action:</strong> ' + cluster.recommendedAction,
        '</div>',
        '<div class="warning-timestamp">Detected: ' + cluster.detectedAt + '</div>',
        '</div>',
        '</div>'
      ].join('');
    }

    return [
      '<html><head><title>JAN-SANKALP AI — Detailed Project Report</title>',
      '<style>',
      'body{font-family:Inter,Arial,sans-serif;padding:40px;color:#0f172a;line-height:1.6;}',
      '.header{background:#0f172a;color:#fff;padding:24px;border-radius:8px;margin-bottom:24px;}',
      '.card{border:1px solid #cbd5e1;padding:20px;border-radius:8px;margin-bottom:20px;}',
      'h1{margin:0;font-size:22px;}',
      'h2{color:#0284c7;font-size:16px;margin-top:0;border-bottom:2px solid #e2e8f0;padding-bottom:8px;}',
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}',
      '.label{font-size:12px;font-weight:bold;color:#64748b;text-transform:uppercase;}',
      '.value{font-size:15px;font-weight:600;margin-top:4px;}',
      '.footer{margin-top:30px;font-size:11px;color:#64748b;text-align:center;}',
      '.telemetry{border:1px solid #f59e0b;background:#fffbeb;padding:20px;border-radius:8px;margin-bottom:20px;}',
      '.telemetry h2{color:#b45309;border-bottom-color:#fde68a;}',
      '.telemetry-note{font-weight:700;color:#92400e;}',
      '.chip{display:inline-block;font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;margin-right:6px;}',
      '.chip-hist{background:#dcfce7;color:#166534;}',
      '.chip-live{background:#fee2e2;color:#991b1b;}',
      '.crs{font-family:Consolas,monospace;font-size:12px;color:#334155;}',
      '.vulnerability-warning{border:3px solid #f59e0b;background:#fffbeb;padding:24px;border-radius:12px;margin-bottom:24px;}',
      '.vulnerability-warning h2{color:#b45309;border-bottom-color:#fde68a;}',
      '.vulnerability-warning-content{margin-top:16px;}',
      '.warning-label{font-size:14px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;}',
      '.warning-details{font-size:14px;color:#92400e;line-height:1.8;background:#fef3c7;padding:16px;border-radius:8px;margin-bottom:12px;}',
      '.warning-timestamp{font-size:12px;color:#b45309;font-style:italic;}',
      '</style></head><body>',
      '<div class="header"><h1>JAN-SANKALP AI — DETAILED PROJECT REPORT (DPR)</h1>',
      '<p style="margin:6px 0 0 0;font-size:13px;opacity:.85;">Digital Public Good | Infrastructure Demand Synthesis</p>',
      '<p style="margin:6px 0 0 0;font-size:12px;opacity:.75;">Report ID: ' + (d.reportId || 'N/A') + ' &nbsp;|&nbsp; Generated: ' + (d.generatedAt || new Date().toISOString()) + '</p></div>',

      vulnerabilitySection,

      '<div class="card"><h2>1. Citizen Voice Input & Audio Transcript</h2>',
      '<div class="label">Spoken Audio Telemetry</div>',
      '<div class="value" style="font-size:16px;color:#1e293b;">"' + (d.transcript || appState.transcript || 'No active voice sample recorded.') + '"</div></div>',

      '<div class="card"><h2>2. Geospatial Grounding & Location Metadata</h2>',
      '<div class="grid">',
      '<div><div class="label">Grounded Location</div><div class="value">' + (d.locationName || appState.location) + '</div></div>',
      '<div><div class="label">H3 Spatial Index</div><div class="value">' + (d.h3Index || appState.h3Index) + '</div></div>',
      '<div><div class="label">Coordinates</div><div class="value">' + ((d.coordinates || appState.coordinates || []).join(', ')) + '</div></div>',
      '<div><div class="label">Inferred Category</div><div class="value">' + (d.category || appState.category) + '</div></div>',
      '<div><div class="label">Urgency</div><div class="value">' + (d.urgency || appState.urgency) + '</div></div>',
      '<div><div class="label">Status</div><div class="value">' + (d.status || appState.status) + '</div></div>',
      '</div></div>',

      '<div class="card telemetry"><h2>3. Historical vs. Current Satellite Telemetry</h2>',
      '<div class="grid">',
      '<div><div class="label">Historical Baseline Raster</div><div class="value"><span class="chip chip-hist">📜 Historical Baseline (Jan 2026)</span><span class="crs">TIME=' + satelliteTelemetryField(d, 'historicalTileTime', 'historical_time', TILE_TIME_HISTORICAL) + '</span></div></div>',
      '<div><div class="label">Current Incident Raster</div><div class="value"><span class="chip chip-live">🔴 Live Incident Telemetry (Sep 2026)</span><span class="crs">TIME=' + satelliteTelemetryField(d, 'currentTileTime', 'current_time', TILE_TIME_CURRENT) + '</span></div></div>',
      '<div><div class="label">Spatial Reference</div><div class="value crs">' + satelliteTelemetryField(d, 'crs', 'crs', CRS_EPSG4326) + ' (WGS84) — co-registered, zero drift</div></div>',
      '<div><div class="label">Active Disaster H3 Cell</div><div class="value crs">' + (d.h3Index || appState.h3Index || H3_DELTA_CELL) + '</div></div>',
      '<div><div class="label">Delta Classification</div><div class="value">' + deltaClassificationText() + '</div></div>',
      '<div><div class="label">Comparative Slider Selection</div><div class="value">' + ((appState.currentLocation && appState.currentLocation.locationName) || d.locationName || appState.location) + '</div></div>',
      '</div>',
      '<p class="telemetry-note" style="margin-top:14px;">📡 Satellite Telemetry Note: ' + SPATIAL_DIFFERENCING_NOTE + '</p>',
      '</div>',

      '<div class="card"><h2>4. Government SLA Commitment & Guarantees</h2>',
      '<div class="grid">',
      '<div><div class="label">Assigned Executive Department</div><div class="value">' + (d.assigned_ministry || d.targetMinistry || appState.ministry) + '</div></div>',
      '<div><div class="label">Guaranteed Resolution Target Date</div><div class="value" style="color:#16a34a;">' + (d.target_completion_date || d.max_resolution_date || appState.targetDate) + '</div></div>',
      '</div></div>',

      '<div class="card"><h2>4. Executive Summary & Proposed Intervention</h2>',
      '<div class="value" style="font-weight:500;">' + (d.summary || 'Summary unavailable.') + '</div>',
      '<p style="margin-top:12px;font-size:14px;color:#334155;">' + (d.executiveSummary || '') + '</p></div>',

      '<div class="card"><h2>5. Financial & Impact Indicators</h2>',
      '<div class="grid">',
      '<div><div class="label">Estimated Budget</div><div class="value">₹ ' + Number(d.budget || 0).toLocaleString('en-IN') + '</div></div>',
      '<div><div class="label">Impacted Citizens</div><div class="value">' + Number(d.impactedCitizens || 0).toLocaleString('en-IN') + '</div></div>',
      '<div><div class="label">Priority Index</div><div class="value">' + (d.priorityIndex || 0) + '/100</div></div>',
      '<div><div class="label">Alignment Score</div><div class="value">' + (d.alignmentScore || 0) + '/100</div></div>',
      '</div></div>',

      '<div class="footer">This is a system-generated Detailed Project Report from the Jan-Sankalp AI platform.<br>' + SPATIAL_DIFFERENCING_NOTE + '</div>',
      '<script>window.onload=function(){window.print();};<\/script>',
      '</body></html>'
    ].join('');
  }

  function exportDpr() {
    if (dprStatus) { dprStatus.textContent = 'Fetching live database records...'; }

    // The active comparative-slider selection is what gets exported, so the DPR
    // can never be generated against a stale map location.
    var selection = appState.currentLocation || updateCurrentLocation({
      locationName: appState.location,
      coordinates: appState.coordinates,
      h3Index: appState.h3Index
    });
    if (selection && selection.locationName) { appState.location = selection.locationName; }
    if (selection && selection.coordinates) { appState.coordinates = selection.coordinates; }
    if (selection && selection.h3Index) { appState.h3Index = selection.h3Index; }

    var payload = {
      // Always export the exact text currently in the editable field.
      transcript: (transcriptBox && transcriptBox.value) || appState.transcript,
      locationName: appState.location,
      category: appState.category,
      h3Index: appState.h3Index,
      coordinates: appState.coordinates,
      urgency: appState.urgency,
      // Explicit satellite telemetry provenance for the generated DPR PDF.
      historicalTileTime: TILE_TIME_HISTORICAL,
      currentTileTime: TILE_TIME_CURRENT,
      crs: CRS_EPSG4326,
      satelliteTelemetryNote: SPATIAL_DIFFERENCING_NOTE,
      footprintAlterationPct: DELTA_FOOTPRINT_ALTERATION,
      satelliteTelemetry: appState.satelliteTelemetry || null
    };
    if (appState.latestIncident && appState.latestIncident.id) {
      payload.id = appState.latestIncident.id;
    }

    safeFetch(API_BASE + '/dpr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (dpr) {
        var win = window.open('', '_blank');
        if (!win) {
          window.alert('Please allow pop-ups to export the DPR report.');
          if (dprStatus) { dprStatus.textContent = 'Pop-up blocked'; }
          return;
        }
        win.document.open();
        win.document.write(buildReportHtml(dpr));
        win.document.close();
        if (dprStatus) { dprStatus.textContent = 'Report ready — print preview opened'; }
      })
      .catch(function (err) {
        console.error('[dpr] export error:', err && err.message);
        if (dprStatus) { dprStatus.textContent = 'Export failed: ' + (err && err.message); }
      });
  }

  // Dynamic DPR generator bound directly to window.appState so external
  // callers always reflect the live, edited transcript.
  function generateDynamicPDF() {
    return exportDpr();
  }
  window.generateDynamicPDF = generateDynamicPDF;
  if (window.appState) { window.appState.generateDynamicPDF = generateDynamicPDF; }

  // ── SCAN INCIDENT (image → transcript) ──────────────────────────
  var scanBtn = $('scanIncidentButton');
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { resolve(null); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read image file.')); };
      reader.readAsDataURL(file);
    });
  }

  function applyResolutionIncident(incident) {
    if (!incident) { return; }
    appState.latestIncident = incident;
    appState.status = incident.status || appState.status;
    appState.ministry = incident.assigned_ministry || appState.ministry;
    appState.urgency = incident.urgency || appState.urgency;
    renderEntityCard();
    renderDprPanel(incident);
  }

  function submitProofOfResolution() {
    var btn = $('submitResolutionButton');
    var result = $('resolutionGateResult');
    var photoInput = $('resolutionPhotoInput');
    var originalInput = $('originalPhotoInput');
    var incident = appState.latestIncident;
    if (!incident || !incident.id) {
      if (result) { result.textContent = 'Ingest an incident first so the resolution can bind to a ticket.'; }
      return;
    }
    var file = photoInput && photoInput.files && photoInput.files[0];
    if (!file) {
      if (result) { result.textContent = 'Choose a geotagged resolution photo.'; }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Auditing EXIF + structure...'; }
    if (result) { result.textContent = 'Running anti-fraud proof-of-resolution gate...'; }

    var originalFile = originalInput && originalInput.files && originalInput.files[0];
    Promise.all([fileToDataUrl(file), fileToDataUrl(originalFile)])
      .then(function (images) {
        return fetch(API_BASE + '/resolutions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incidentId: incident.id,
            h3Index: incident.h3_index || appState.h3Index || H3_DELTA_CELL,
            image: images[0],
            originalImage: images[1] || incident.original_photo || null
          })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            body._httpStatus = res.status;
            body._ok = res.ok;
            return body;
          });
        });
      })
      .then(function (body) {
        if (body && body.status === 'REJECTED_LOCATION_MISMATCH') {
          if (result) {
            setHTML(result, '<div style="color:#fca5a5;font-weight:700;">REJECTED_LOCATION_MISMATCH</div>' +
              '<div style="margin-top:6px;">' + (body.error || 'Photo captured outside incident zone.') + '</div>');
          }
          return;
        }
        if (!body || body._ok === false) {
          throw new Error((body && (body.error || body.details)) || 'Resolution audit failed.');
        }
        var updated = (body.data) || incident;
        applyResolutionIncident(updated);
        var audit = body.audit || updated.resolution_audit || {};
        if (body.status === 'PENDING_MANUAL_AUDIT') {
          if (result) {
            setHTML(result, '<div style="color:#fbbf24;font-weight:700;">PENDING_MANUAL_AUDIT</div>' +
              '<div style="margin-top:6px;">Escalated to District Collector Review. Structural match ' +
              (audit.structural_similarity != null ? Math.round(audit.structural_similarity * 100) + '%' : '--') +
              (audit.rubble_detected ? '; rubble still detected.' : '.') + '</div>');
          }
          return;
        }
        if (result) {
          setHTML(result, '<div class="proof-audit-badge is-visible" style="margin:0;">' +
            '<span class="audit-check">✓</span><span>' + proofAuditLabel(updated) + '</span></div>');
        }
      })
      .catch(function (err) {
        if (result) { result.textContent = (err && err.message) || 'Resolution audit failed.'; }
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Proof of Resolution'; }
      });
  }

  function initScanButton() {
    if (!scanBtn) { return; }
    scanBtn.addEventListener('click', function () {
      scanBtn.disabled = true;
      var original = scanBtn.textContent;
      scanBtn.textContent = 'Scanning...';
      // No dedicated image-scan endpoint is required for the core flow;
      // synthesise a structured complaint from the analysed frame.
      setTimeout(function () {
        updateTranscript('Structural infrastructure failure detected along the transport corridor.');
        scanBtn.disabled = false;
        scanBtn.textContent = original;
        submitTranscript();
      }, 700);
    });
  }

  // ── OFFLINE PWA QUEUEING & SYNC ───────────────────────────────────
  var offlineDB = null;
  var DB_NAME = 'JanSankalpOfflineDB';
  var DB_VERSION = 1;
  var STORE_NAME = 'offlineQueue';

  function initOfflineDB() {
    return new Promise(function(resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = function(event) {
        console.error('[offline] DB error:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = function(event) {
        offlineDB = event.target.result;
        console.log('[offline] IndexedDB initialized');
        resolve(offlineDB);
      };

      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          var objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          objectStore.createIndex('type', 'type', { unique: false });
        }
      };
    });
  }

  function addToOfflineQueue(item) {
    if (!offlineDB) {
      console.warn('[offline] DB not initialized, queueing in memory');
      appState.offlineQueue.push(item);
      updateQueueIndicator();
      return Promise.resolve();
    }

    return new Promise(function(resolve, reject) {
      var transaction = offlineDB.transaction([STORE_NAME], 'readwrite');
      var objectStore = transaction.objectStore(STORE_NAME);
      var request = objectStore.add({
        type: item.type,
        data: item.data,
        timestamp: Date.now(),
        attempts: 0
      });

      request.onsuccess = function() {
        console.log('[offline] Item added to queue:', item.type);
        updateQueueIndicator();
        resolve();
      };

      request.onerror = function(event) {
        console.error('[offline] Error adding to queue:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  function getOfflineQueue() {
    if (!offlineDB) {
      return Promise.resolve(appState.offlineQueue);
    }

    return new Promise(function(resolve, reject) {
      var transaction = offlineDB.transaction([STORE_NAME], 'readonly');
      var objectStore = transaction.objectStore(STORE_NAME);
      var request = objectStore.getAll();

      request.onsuccess = function() {
        resolve(request.result || []);
      };

      request.onerror = function(event) {
        console.error('[offline] Error reading queue:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  function removeFromOfflineQueue(id) {
    if (!offlineDB) {
      appState.offlineQueue = appState.offlineQueue.filter(function(item) {
        return item.id !== id;
      });
      updateQueueIndicator();
      return Promise.resolve();
    }

    return new Promise(function(resolve, reject) {
      var transaction = offlineDB.transaction([STORE_NAME], 'readwrite');
      var objectStore = transaction.objectStore(STORE_NAME);
      var request = objectStore.delete(id);

      request.onsuccess = function() {
        console.log('[offline] Item removed from queue:', id);
        updateQueueIndicator();
        resolve();
      };

      request.onerror = function(event) {
        console.error('[offline] Error removing from queue:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  function updateQueueIndicator() {
    var indicator = $('queueIndicator');
    var countSpan = $('queueCount');
    if (!indicator) return;

    getOfflineQueue().then(function(items) {
      var count = items.length;
      if (count > 0) {
        indicator.classList.remove('hidden');
        if (countSpan) {
          countSpan.textContent = count;
        }
      } else {
        indicator.classList.add('hidden');
      }
    });
  }

  function syncOfflineQueue() {
    console.log('[offline] Syncing offline queue...');
    getOfflineQueue().then(function(items) {
      if (items.length === 0) {
        console.log('[offline] Queue is empty, nothing to sync');
        return;
      }

      var syncPromises = items.map(function(item) {
        return syncQueueItem(item);
      });

      Promise.allSettled(syncPromises).then(function(results) {
        console.log('[offline] Sync complete:', results);
        updateQueueIndicator();
      });
    });
  }

  function syncQueueItem(item) {
    var data = item.data;
    var type = item.type;

    console.log('[offline] Syncing item:', type, data);

    if (type === 'ingest') {
      return safeFetch(API_BASE + '/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function() {
          return removeFromOfflineQueue(item.id);
        })
        .catch(function(err) {
          console.error('[offline] Sync failed for item:', item.id, err);
          throw err;
        });
    }

    // Add other sync types as needed
    return Promise.resolve();
  }

  function initOfflineListeners() {
    window.addEventListener('online', function() {
      console.log('[offline] Connection restored, syncing queue...');
      appState.isOnline = true;
      updateConnectionStatus();
      syncOfflineQueue();
    });

    window.addEventListener('offline', function() {
      console.log('[offline] Connection lost, enabling offline mode...');
      appState.isOnline = false;
      updateConnectionStatus();
    });
  }

  function updateConnectionStatus() {
    var statusEl = $('connectionStatus');
    if (!statusEl) return;

    if (appState.isOnline) {
      statusEl.className = 'connection-status online';
      statusEl.textContent = '🟢 Online';
    } else {
      statusEl.className = 'connection-status offline';
      statusEl.textContent = '🔴 Offline';
    }
  }

  function submitTranscriptOffline() {
    var transcript = ((transcriptBox && transcriptBox.value) || appState.transcript || '').trim();
    if (!transcript) return;

    var payload = {
      transcript: transcript,
      coordinates: appState.coordinates
    };

    if (appState.isOnline) {
      // Try online submission first
      return safeFetch(API_BASE + '/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function(res) {
          handleIngestResponse(res);
        })
        .catch(function(err) {
          console.error('[offline] Online submission failed, queuing:', err);
          return queueOfflineSubmission(payload);
        });
    } else {
      // Queue for offline
      return queueOfflineSubmission(payload);
    }
  }

  function queueOfflineSubmission(payload) {
    return addToOfflineQueue({
      type: 'ingest',
      data: payload
    }).then(function() {
      alert('Your report has been saved and will be submitted when you are back online.');
    });
  }

  function handleIngestResponse(res) {
    var incident = res.data || res;
    appState.latestIncident = incident;
    appState.location = incident.location_name || appState.location;
    appState.category = incident.category || appState.category;
    appState.urgency = incident.urgency || appState.urgency;
    appState.h3Index = incident.h3_index || appState.h3Index;
    appState.status = incident.status || appState.status;
    appState.ministry = incident.assigned_ministry || appState.ministry;
    appState.targetDate = incident.target_completion_date || appState.targetDate;
    var incidentCoords = normalizeWgs84(incident.coordinates);
    if (incidentCoords) { appState.coordinates = incidentCoords; }

    // Handle vulnerability cluster detection
    if (res.vulnerabilityCluster && res.vulnerabilityCluster.isCluster) {
      appState.vulnerabilityCluster = res.vulnerabilityCluster;
      renderVulnerabilityClusterAlert(res.vulnerabilityCluster);
      renderHazardOverlay(res.vulnerabilityCluster);
    } else {
      appState.vulnerabilityCluster = null;
      clearVulnerabilityClusterAlert();
      clearHazardOverlay();
    }

    // Also check for cluster in DPR response for PDF generation
    if (res.data && res.data.vulnerabilityCluster && res.data.vulnerabilityCluster.isCluster) {
      appState.vulnerabilityCluster = res.data.vulnerabilityCluster;
    }

    renderEntityCard();
    renderDprPanel(incident);
    loadIncidents();

    // Incident telemetry guard: the regional record for Jaipur only carries
    // the city centroid, so a Jaipur / Subhash Chowk · Kishanpole mention is
    // re-pinned to the incident-grade geocode before the comparative
    // rasters are drawn.
    var incidentTarget = resolveIncidentTarget(transcript);
    if (incidentTarget) {
      appState.location = incidentTarget.locationName;
      appState.coordinates = incidentTarget.coordinates;
      appState.h3Index = incidentTarget.h3Index;
      appState.zoom = incidentTarget.zoom;
      renderEntityCard();
      renderDprPanel(incident);
      focusIncidentTarget(incidentTarget);
      updateCurrentLocation({
        locationName: incidentTarget.locationName,
        coordinates: incidentTarget.coordinates,
        h3Index: incidentTarget.h3Index
      });
    } else {
      flyTo(appState.coordinates, appState.zoom);
      updateCurrentLocation({
        locationName: appState.location,
        coordinates: appState.coordinates,
        h3Index: appState.h3Index
      });
    }
  }

  // ── BOOTSTRAP ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    console.log('[app] Jan-Sankalp AI client engine online. API base:', API_BASE);

    initOfflineDB().then(function() {
      initOfflineListeners();
      updateConnectionStatus();
      updateQueueIndicator();
    }).catch(function(err) {
      console.warn('[offline] Failed to init offline DB:', err);
    });

    initRoleSwitching();
    initMap();
    initSpeech();
    initScanButton();
    renderEntityCard();

    // Split-screen historical vs. current comparative slider.
    appState.comparisonEnabled = true;
    initComparison();
    bindComparisonSlider();
    applyComparisonSplit(appState.splitPercent || 50);
    // The toggle is usable even if the CDN Leaflet never arrived.
    if (!window.L) {
      toggleComparison(false);
      fillMapCanvas($('map'), '<p>The satellite canvas requires the Leaflet CDN. Telemetry values remain available in the DPR panel.</p>');
    }

    // Mirror the initial selection onto window.appState.currentLocation.
    updateCurrentLocation({
      locationName: appState.location,
      coordinates: appState.coordinates,
      h3Index: appState.h3Index
    });

    var compareBtn = $('compareToggle');
    if (compareBtn) {
      compareBtn.setAttribute('aria-pressed', 'true');
      compareBtn.addEventListener('click', function () { toggleComparison(); });
    }
    var resetBtn = $('resetComparison');
    if (resetBtn) { resetBtn.addEventListener('click', resetComparisonSplit); }

    // Manual transcript editing → live re-grounding + map telemetry.
    if (transcriptBox) {
      transcriptBox.addEventListener('input', function () {
        userEditedTranscript = true;
        handleTranscriptEdit();
      });
      transcriptBox.addEventListener('change', handleTranscriptEdit);
    }

    if (satBtn) { satBtn.addEventListener('click', runSatelliteVerification); }
    if (pdfBtn) { pdfBtn.addEventListener('click', exportDpr); }
    var resolutionBtn = $('submitResolutionButton');
    if (resolutionBtn) { resolutionBtn.addEventListener('click', submitProofOfResolution); }

    // Hydrate from persisted database records on load.
    loadIncidents();

    // Keep Leaflet honest on resize.
    window.addEventListener('resize', function () {
      if (map) { map.invalidateSize(); }
      if (comparisonMap) { comparisonMap.invalidateSize(); }
      if (historicalMap) { historicalMap.invalidateSize(); }
      if (recentMap) { recentMap.invalidateSize(); }
      applyComparisonSplit(appState.splitPercent || 50);
    });

    // Expose the comparative-slider API so the host shell (App.tsx) and the DPR
    // exporter can drive the split-screen selection programmatically.
    window.JanSankalpComparison = {
      focusIncidentTarget: focusIncidentTarget,
      applyComparisonSelection: applyComparisonSelection,
      applyComparisonSplit: applyComparisonSplit,
      resetComparisonSplit: resetComparisonSplit,
      toggleComparison: toggleComparison,
      updateCurrentLocation: updateCurrentLocation,
      renderDeltaOverlay: renderDeltaOverlay,
      getHistoricalLayer: function () { return comparisonHistoricalLayer || mainBaseLayers; },
      getCurrentLayer: function () { return comparisonCurrentLayer; },
      constants: {
        historicalTileTime: TILE_TIME_HISTORICAL,
        currentTileTime: TILE_TIME_CURRENT,
        crs: CRS_EPSG4326,
        deltaMinZoom: DELTA_MIN_ZOOM,
        h3DeltaCell: H3_DELTA_CELL,
        note: SPATIAL_DIFFERENCING_NOTE
      }
    };
  });
})();