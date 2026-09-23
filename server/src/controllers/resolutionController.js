const config = require('../config');
const { distanceToCellMeters, cellCenter } = require('../utils/geo');
const { readGps, readCaptureTime } = require('../services/exifService');
const {
  compareStructuralSimilarity,
} = require('../services/similarityService');
const {
  REPORT_STATUS,
  getReport,
  saveReport,
  toPublicJson,
} = require('../store');

const RESOLUTION_STATUS = {
  APPROVED: 'APPROVED_AI_GROUND_VERIFIED',
  REJECTED_LOCATION_MISMATCH: 'REJECTED_LOCATION_MISMATCH',
  PENDING_MANUAL_AUDIT: 'PENDING_MANUAL_AUDIT',
};

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function auditLocation(buffer, h3Cell) {
  const coordinates = await readGps(buffer);

  if (!coordinates) {
    return {
      passed: false,
      reason:
        'Resolution photo has no EXIF GPS metadata, so its location cannot be verified.',
      coordinates: null,
      distanceMeters: null,
      targetCell: h3Cell,
      targetCenter: cellCenter(h3Cell),
      maxDistanceMeters: config.maxDistanceMeters,
    };
  }

  const distanceMeters = distanceToCellMeters(coordinates, h3Cell);

  return {
    passed: distanceMeters <= config.maxDistanceMeters,
    reason:
      distanceMeters <= config.maxDistanceMeters
        ? null
        : `Resolution photo was captured ${round(distanceMeters, 1)}m from the reported location, exceeding the ${config.maxDistanceMeters}m limit.`,
    coordinates: {
      latitude: round(coordinates.latitude, 7),
      longitude: round(coordinates.longitude, 7),
    },
    distanceMeters: round(distanceMeters, 1),
    targetCell: h3Cell,
    targetCenter: cellCenter(h3Cell),
    maxDistanceMeters: config.maxDistanceMeters,
  };
}

async function auditSimilarity(originalBuffer, resolutionBuffer) {
  if (!originalBuffer) {
    return {
      confidence: null,
      threshold: config.similarityThreshold,
      passed: false,
      reason:
        'No original issue photo is on file, so structural similarity could not be measured.',
    };
  }

  const confidence = await compareStructuralSimilarity(
    originalBuffer,
    resolutionBuffer,
  );
  const passed = confidence >= config.similarityThreshold;

  return {
    confidence: round(confidence, 4),
    confidencePercent: round(confidence * 100, 1),
    threshold: config.similarityThreshold,
    passed,
    reason: passed
      ? null
      : `Structural similarity confidence ${round(confidence * 100, 1)}% is below the ${round(config.similarityThreshold * 100, 1)}% threshold.`,
  };
}

async function submitResolution(req, res, next) {
  try {
    const report = getReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A resolution photo is required' });
    }

    const buffer = req.file.buffer;
    const location = await auditLocation(buffer, report.h3Cell);

    const baseResolution = {
      submittedAt: new Date().toISOString(),
      capturedAt: await readCaptureTime(buffer),
      photo: { buffer, mimetype: req.file.mimetype },
      location,
    };

    if (!location.passed) {
      report.status = REPORT_STATUS.REJECTED_LOCATION_MISMATCH;
      report.resolution = {
        ...baseResolution,
        status: RESOLUTION_STATUS.REJECTED_LOCATION_MISMATCH,
        reason: location.reason,
        aiGroundVerified: false,
        flaggedForDistrictCollectorReview: false,
        similarity: null,
      };
      saveReport(report);
      return res.status(422).json(toPublicJson(report));
    }

    const similarity = await auditSimilarity(
      report.originalPhoto && report.originalPhoto.buffer,
      buffer,
    );

    if (!similarity.passed) {
      report.status = REPORT_STATUS.PENDING_MANUAL_AUDIT;
      report.resolution = {
        ...baseResolution,
        status: RESOLUTION_STATUS.PENDING_MANUAL_AUDIT,
        reason: similarity.reason,
        aiGroundVerified: false,
        flaggedForDistrictCollectorReview: true,
        similarity,
      };
      saveReport(report);
      return res.status(202).json(toPublicJson(report));
    }

    report.status = REPORT_STATUS.RESOLVED_VERIFIED;
    report.resolution = {
      ...baseResolution,
      status: RESOLUTION_STATUS.APPROVED,
      reason: null,
      aiGroundVerified: true,
      flaggedForDistrictCollectorReview: false,
      similarity,
    };
    saveReport(report);
    return res.status(200).json(toPublicJson(report));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  RESOLUTION_STATUS,
  auditLocation,
  auditSimilarity,
  submitResolution,
};
