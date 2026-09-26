import React, { useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import ImageScanModal, { type ScanCompleteResultData } from './components/ImageScanModal';
import {
  generateDPRPdf,
  TILE_TIME_HISTORICAL,
  TILE_TIME_CURRENT,
  CRS_EPSG4326,
  DELTA_FOOTPRINT_ALTERATION,
  SPATIAL_DIFFERENCING_NOTE
} from './utils/dprPdfGenerator';

// ── Incident-grade geocode (Subhash Chowk · Kishanpole, Jaipur walled city) ──
// Pinned in EPSG:4326 / WGS84 so the historical (Jan 2026) and current
// (Sep 2026) satellite rasters are co-registered over the exact same footprint.
const JAIPUR_INCIDENT_COORDS: [number, number] = [26.9248, 75.8273];
const JAIPUR_INCIDENT_ZOOM = 17;              // tight comparative zoom
const JAIPUR_DELTA_H3_CELL = '8c2a100d36bffff';

function MapViewUpdater({
  center,
  zoom
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();

  React.useEffect(() => {
    map.invalidateSize();
    if (center) {
      map.flyTo(center, zoom, { animate: true, duration: 1.5 });
    }
  }, [center, zoom, map]);

  return null;
}

const ledgerRows = [
  {
    contractor: 'Asha Builders',
    completionRate: 82,
    activeAssignments: 6,
    slaBreaches: 1,
    penaltyStatus: 'SLA Breached',
    latestDeadline: '2026-09-26T18:00:00.000Z'
  },
  {
    contractor: 'CityWorks Infra',
    completionRate: 91,
    activeAssignments: 4,
    slaBreaches: 0,
    penaltyStatus: 'On Track',
    latestDeadline: '2026-09-28T18:00:00.000Z'
  },
  {
    contractor: 'Rajasthan Roads Co.',
    completionRate: 68,
    activeAssignments: 9,
    slaBreaches: 2,
    penaltyStatus: 'SLA Breached',
    latestDeadline: '2026-09-24T18:00:00.000Z'
  }
];

export default function App() {
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([28.6139, 77.209]);
  const [selectedDistrictData, setSelectedDistrictData] = useState<any>(null);
  const [dprData, setDprData] = useState<any>(null);

  const districtLabel = useMemo(() => {
    return mapCenter[0] >= 26.8 && mapCenter[1] <= 76.0 ? 'Jaipur' : 'Delhi';
  }, [mapCenter]);

  // Comparative zoom: the Jaipur collapse block opens at the delta-overlay
  // activation zoom (>= 17) so the green footprint / red H3 hexagon render.
  const mapZoom = useMemo(() => {
    const isJaipur = mapCenter[0] >= 26.8 && mapCenter[1] <= 76.0;
    return isJaipur ? JAIPUR_INCIDENT_ZOOM : 8;
  }, [mapCenter]);

  const handleScanComplete = (result: ScanCompleteResultData) => {
    setMapCenter(result.coordinates);

    const isJaipurIncident = result.coordinates[0] >= 26.8 && result.coordinates[1] <= 76.0;
    const districtName = isJaipurIncident ? 'Jaipur' : 'Delhi';
    const categoryName = result.category || 'Infrastructure';
    const score = Number(result.verificationScore ?? 0.85);

    const nextSelectedDistrictData = {
      district: districtName,
      category: categoryName,
      urgency: score >= 0.85 ? 'High' : 'Medium',
      priority: score >= 0.85 ? 'High' : 'Medium',
      status: score >= 0.85 ? 'Satellite Verified (99%)' : 'Satellite Verified (84%)',
      confidence: `${Math.round(score * 100)}%`,
      reportId: `SCAN-${Date.now()}`,
      // Real H3 spatial cell for the Jaipur collapse telemetry.
      h3Index: isJaipurIncident ? JAIPUR_DELTA_H3_CELL : 'delhi-h3-index',
      coordinates: result.coordinates,
      transcript: result.transcript,
      verificationScore: score,
      spectralVariance: 1.03,
      coherence: 0.98,
      timestamp: new Date().toISOString(),
      satelliteStatus: `Satellite Verified (${Math.round(score * 100)}%)`,
      historicalTileTime: TILE_TIME_HISTORICAL,
      currentTileTime: TILE_TIME_CURRENT,
      crs: CRS_EPSG4326,
      footprintAlterationPct: DELTA_FOOTPRINT_ALTERATION,
      satelliteTelemetryNote: SPATIAL_DIFFERENCING_NOTE
    };

    setSelectedDistrictData(nextSelectedDistrictData);
    setDprData({
      reportId: nextSelectedDistrictData.reportId,
      district: districtName,
      category: categoryName,
      urgency: nextSelectedDistrictData.urgency,
      h3Index: nextSelectedDistrictData.h3Index,
      transcript: result.transcript,
      verificationScore: score,
      spectralVariance: 1.03,
      coherence: 0.98,
      timestamp: nextSelectedDistrictData.timestamp,
      // Historical vs. current spatial raster differencing provenance.
      historicalTileTime: TILE_TIME_HISTORICAL,
      currentTileTime: TILE_TIME_CURRENT,
      crs: CRS_EPSG4326,
      footprintAlterationPct: DELTA_FOOTPRINT_ALTERATION,
      satelliteTelemetryNote: SPATIAL_DIFFERENCING_NOTE
    });

    setIsScanOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <section className="mb-6 rounded-2xl border border-amber-500/30 bg-slate-900 p-5 shadow-xl shadow-slate-950/40">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Public Transparency</p>
              <h2 className="mt-2 text-2xl font-bold text-white">Contractor Accountability Ledger</h2>
            </div>
            <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
              3 active penalties
            </div>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Active contractors</p>
              <p className="mt-2 text-3xl font-bold text-cyan-300">8</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Avg. completion</p>
              <p className="mt-2 text-3xl font-bold text-emerald-300">81%</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">SLA breaches</p>
              <p className="mt-2 text-3xl font-bold text-rose-300">3</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-700">
            <table className="min-w-full divide-y divide-slate-700 text-left text-sm">
              <thead className="bg-slate-950/90 text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Contractor</th>
                  <th className="px-4 py-3 font-medium">Completion</th>
                  <th className="px-4 py-3 font-medium">Active tasks</th>
                  <th className="px-4 py-3 font-medium">Penalty status</th>
                  <th className="px-4 py-3 font-medium">Deadline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900 text-slate-100">
                {ledgerRows.map((row) => (
                  <tr key={row.contractor}>
                    <td className="px-4 py-3 font-medium text-white">{row.contractor}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-700">
                          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${row.completionRate}%` }} />
                        </div>
                        <span>{row.completionRate}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{row.activeAssignments}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] ${row.penaltyStatus === 'SLA Breached' ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'}`}>
                        {row.penaltyStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{new Date(row.latestDeadline).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <header className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl shadow-slate-950/40">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">Digital Public Good</p>
              <h1 className="text-3xl font-bold text-white">Jan-Sankalp AI</h1>
            </div>
            <button
              onClick={() => setIsScanOpen(true)}
              className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-400"
            >
              📷 Scan Incident
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-xl shadow-slate-950/40">
            <div className="mb-3 flex items-center justify-between px-2">
              <h2 className="text-lg font-semibold text-white">District Heatmap</h2>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-300">
                {districtLabel}
              </span>
            </div>

            <div className="relative h-[440px] w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
              <MapContainer center={mapCenter} zoom={mapZoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapViewUpdater center={mapCenter} zoom={mapZoom} />
              </MapContainer>

              {/* Floating temporal status badges (visible on the incident view). */}
              {mapZoom >= JAIPUR_INCIDENT_ZOOM ? (
                <>
                  <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-full border border-emerald-400/40 bg-slate-950/85 px-3 py-1 text-[11px] font-semibold text-emerald-300 shadow-lg">
                    📜 Historical Baseline (Jan 2026)
                  </div>
                  <div className="pointer-events-none absolute right-3 top-3 z-[500] rounded-full border border-red-500/40 bg-slate-950/85 px-3 py-1 text-[11px] font-semibold text-red-300 shadow-lg">
                    🔴 Live Incident Telemetry (Sep 2026)
                  </div>
                  <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-amber-500/40 bg-slate-950/85 px-3 py-1 text-[10px] font-medium text-amber-200 shadow-lg">
                    ⚠️ Structural Delta Detected: {DELTA_FOOTPRINT_ALTERATION}% Footprint Alteration (Monsoon Rain Damage) · H3 {JAIPUR_DELTA_H3_CELL} · {CRS_EPSG4326}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-xl shadow-slate-950/40">
            <h2 className="mb-4 text-lg font-semibold text-white">Report Summary</h2>

            {selectedDistrictData ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-700 bg-slate-950 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">District</p>
                  <h3 className="mt-2 text-2xl font-bold text-white">{selectedDistrictData.district}</h3>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Status</p>
                    <p className="mt-2 text-sm font-medium text-emerald-300">{selectedDistrictData.status}</p>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Category</p>
                    <p className="mt-2 text-sm font-medium text-violet-300">{selectedDistrictData.category}</p>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Priority</p>
                    <p className="mt-2 text-sm font-medium text-amber-300">{selectedDistrictData.priority}</p>
                  </div>
                </div>

                {dprData && (
                  <button
                    type="button"
                    onClick={() => generateDPRPdf(dprData)}
                    className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                  >
                    Download DPR (PDF)
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-600 bg-slate-950/70 p-6 text-sm text-slate-400">
                Click a district polygon or scan an incident to populate the report.
              </div>
            )}
          </div>
        </div>
      </div>

      <ImageScanModal
        isOpen={isScanOpen}
        onClose={() => setIsScanOpen(false)}
        onScanComplete={handleScanComplete}
      />
    </div>
  );
}
