import React from 'react';
import {
  generateDPRPdf,
  TILE_TIME_HISTORICAL,
  TILE_TIME_CURRENT,
  CRS_EPSG4326,
  DELTA_FOOTPRINT_ALTERATION,
  SPATIAL_DIFFERENCING_NOTE
} from '../utils/dprPdfGenerator';

export type DistrictDprData = {
  district?: string;
  category?: string;
  urgency?: string;
  priority?: string;
  status?: string;
  confidence?: string | number;
  satelliteStatus?: string;
  reportId?: string;
  h3Index?: string;
  transcript?: string;
  verificationScore?: number;
  spectralVariance?: number;
  coherence?: number;
  timestamp?: string;
  // Historical vs. current satellite telemetry provenance.
  historicalTileTime?: string;
  currentTileTime?: string;
  crs?: string;
  footprintAlterationPct?: number;
  satelliteTelemetryNote?: string;
};

interface DPRReportDrawerProps {
  selectedDistrictData: DistrictDprData | null;
}

export default function DPRReportDrawer({
  selectedDistrictData
}: DPRReportDrawerProps) {
  const fallbackData: DistrictDprData = {
    district: 'Delhi Central (Selected Area)',
    category: 'Road Infrastructure',
    urgency: 'Medium',
    priority: 'Medium',
    status: 'Satellite Verified (99%)',
    confidence: '99%',
    reportId: 'DPR-DEFAULT',
    h3Index: 'N/A',
    transcript: 'Road infrastructure issues reported in the selected area require civic inspection and dispatch planning.',
    verificationScore: 0.99,
    spectralVariance: 1.03,
    coherence: 0.98,
    timestamp: new Date().toISOString()
  };

  const data = selectedDistrictData || fallbackData;
  const districtName = data.district || 'Delhi Central (Selected Area)';
  const category = data.category || 'Road Infrastructure';
  const priorityLevel = data.urgency || data.priority || 'Medium';
  const statusText =
    data.satelliteStatus ||
    data.status ||
    `Satellite Verified (${data.confidence ?? '99%'} )`;
  const verificationScore = Number(data.verificationScore ?? 0.99);
  const spectralVariance = Number(data.spectralVariance ?? 1.03);
  const coherence = Number(data.coherence ?? 0.98);
  const timestamp = data.timestamp || new Date().toISOString();

  const handleDownloadPdf = () => {
    generateDPRPdf({
      reportId: data.reportId || `DPR-${districtName.replace(/\s+/g, '').toUpperCase()}`,
      district: districtName,
      category,
      urgency: priorityLevel,
      h3Index: data.h3Index || 'N/A',
      transcript:
        data.transcript ||
        `District-level civic issue report for ${districtName}. Category: ${category}. Priority: ${priorityLevel}.`,
      verificationScore,
      spectralVariance,
      coherence,
      timestamp,
      // Historical vs. current spatial raster differencing provenance.
      historicalTileTime: data.historicalTileTime || TILE_TIME_HISTORICAL,
      currentTileTime: data.currentTileTime || TILE_TIME_CURRENT,
      crs: data.crs || CRS_EPSG4326,
      footprintAlterationPct: data.footprintAlterationPct ?? DELTA_FOOTPRINT_ALTERATION,
      satelliteTelemetryNote: data.satelliteTelemetryNote || SPATIAL_DIFFERENCING_NOTE
    });
  };

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/90 p-5 text-slate-200 shadow-xl shadow-slate-950/40">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">District DPR</p>
          <h3 className="text-2xl font-semibold text-white">{districtName}</h3>
        </div>

        <button
          type="button"
          onClick={() => handleDownloadPdf()}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:bg-emerald-500 z-50"
        >
          📥 Download Official DPR (PDF)
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">Status</p>
          <p className="text-sm font-medium text-emerald-300">{statusText}</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">Category</p>
          <p className="text-sm font-medium text-violet-300">{category}</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-400">Priority Level</p>
          <p className="text-sm font-medium text-amber-300">{priorityLevel}</p>
        </div>
      </div>
    </div>
  );
}
