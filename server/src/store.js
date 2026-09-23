const crypto = require('crypto');
const config = require('./config');

const reports = new Map();

const REPORT_STATUS = {
  OPEN: 'OPEN',
  RESOLVED_VERIFIED: 'RESOLVED_VERIFIED',
  PENDING_MANUAL_AUDIT: 'PENDING_MANUAL_AUDIT',
  REJECTED_LOCATION_MISMATCH: 'REJECTED_LOCATION_MISMATCH',
};

function createReport({ title, description, h3Cell, photo }) {
  const id = crypto.randomUUID();
  const report = {
    id,
    title,
    description: description || '',
    h3Cell: h3Cell || config.targetH3Cell,
    status: REPORT_STATUS.OPEN,
    createdAt: new Date().toISOString(),
    originalPhoto: photo || null,
    resolution: null,
  };
  reports.set(id, report);
  return report;
}

function getReport(id) {
  return reports.get(id) || null;
}

function listReports() {
  return [...reports.values()];
}

function saveReport(report) {
  reports.set(report.id, report);
  return report;
}

function toPublicJson(report) {
  return {
    id: report.id,
    title: report.title,
    description: report.description,
    h3Cell: report.h3Cell,
    status: report.status,
    createdAt: report.createdAt,
    hasOriginalPhoto: Boolean(report.originalPhoto),
    resolution: report.resolution
      ? {
          submittedAt: report.resolution.submittedAt,
          status: report.resolution.status,
          reason: report.resolution.reason,
          aiGroundVerified: report.resolution.aiGroundVerified,
          flaggedForDistrictCollectorReview:
            report.resolution.flaggedForDistrictCollectorReview,
          location: report.resolution.location,
          similarity: report.resolution.similarity,
        }
      : null,
  };
}

module.exports = {
  REPORT_STATUS,
  createReport,
  getReport,
  listReports,
  saveReport,
  toPublicJson,
};
