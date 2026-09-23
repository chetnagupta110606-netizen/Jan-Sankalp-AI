module.exports = {
  port: Number(process.env.PORT || 4000),
  targetH3Cell: process.env.TARGET_H3_CELL || '8c2a100d36bffff',
  maxDistanceMeters: Number(process.env.MAX_DISTANCE_METERS || 50),
  similarityThreshold: Number(process.env.SIMILARITY_THRESHOLD || 0.65),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024),
};
