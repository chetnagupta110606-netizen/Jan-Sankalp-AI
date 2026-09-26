/**
 * Jan-Sankalp AI — Photo Audit Service
 * ------------------------------------------------------------------
 * Photo tampering detection and perceptual hash audit for resolution
 * proof verification. Detects fake uploads and metadata anomalies.
 * ------------------------------------------------------------------
 */

const sharp = require('sharp');
const crypto = require('crypto');

const AI_AUDIT_FLAG = 'AI Audit Flag: Potential Spoofed Proof / Reused Asset';

function toImageBuffer(imageValue) {
  if (!imageValue) return null;
  if (Buffer.isBuffer(imageValue)) return imageValue;
  if (imageValue.buffer && Buffer.isBuffer(imageValue.buffer)) return imageValue.buffer;
  if (typeof imageValue === 'string') {
    const trimmed = imageValue.trim();
    if (!trimmed) return null;
    const base64 = trimmed.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    try {
      return Buffer.from(base64, 'base64');
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Generate perceptual hash for an image
 * Uses a simple average hash algorithm for similarity detection
 */
async function generatePerceptualHash(imageBuffer) {
  try {
    // Resize to small thumbnail for hashing (8x8 pixels)
    const { data, info } = await sharp(imageBuffer)
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Calculate average pixel value
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const average = sum / data.length;

    // Generate hash based on comparison to average
    let hash = '';
    for (let i = 0; i < data.length; i++) {
      hash += data[i] >= average ? '1' : '0';
    }

    return hash;
  } catch (err) {
    console.error('[photo-audit] Hash generation error:', err.message);
    throw new Error('Failed to generate perceptual hash');
  }
}

/**
 * Calculate Hamming distance between two perceptual hashes
 * Lower distance = more similar images
 */
function calculateHammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) {
    return -1; // Invalid comparison
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }

  return distance;
}

/**
 * Check if two images are similar based on perceptual hash
 * Returns similarity score (0-1, where 1 is identical)
 */
async function checkImageSimilarity(imageBuffer1, imageBuffer2) {
  try {
    const hash1 = await generatePerceptualHash(imageBuffer1);
    const hash2 = await generatePerceptualHash(imageBuffer2);

    const distance = calculateHammingDistance(hash1, hash2);
    const maxDistance = hash1.length; // Maximum possible distance
    const similarity = 1 - (distance / maxDistance);

    return {
      similarity,
      distance,
      hash1,
      hash2,
      isIdentical: similarity > 0.95, // Consider >95% similarity as identical
      isVerySimilar: similarity > 0.85 // Consider >85% as very similar
    };
  } catch (err) {
    console.error('[photo-audit] Similarity check error:', err.message);
    throw new Error('Failed to check image similarity');
  }
}

/**
 * Extract EXIF metadata from image
 */
async function extractImageMetadata(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();

    return {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      size: imageBuffer.length,
      hasExif: metadata.exif !== undefined,
      exif: metadata.exif || null,
      hasIptc: metadata.iptc !== undefined,
      iptc: metadata.iptc || null
    };
  } catch (err) {
    console.error('[photo-audit] Metadata extraction error:', err.message);
    return {
      error: 'Failed to extract metadata',
      format: 'unknown',
      width: 0,
      height: 0,
      size: imageBuffer.length
    };
  }
}

/**
 * Validate photo integrity and detect tampering
 */
async function validatePhotoIntegrity(imageBuffer, submissionTime) {
  try {
    const metadata = await extractImageMetadata(imageBuffer);
    const perceptualHash = await generatePerceptualHash(imageBuffer);

    const validationResults = {
      isValid: true,
      issues: [],
      metadata,
      perceptualHash,
      checks: {
        hasValidFormat: ['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format),
        hasReasonableSize: metadata.size > 1000 && metadata.size < 50 * 1024 * 1024, // 1KB to 50MB
        hasReasonableDimensions: metadata.width >= 100 && metadata.height >= 100,
        hasExifData: metadata.hasExif
      }
    };

    // Check for potential issues
    if (!validationResults.checks.hasValidFormat) {
      validationResults.issues.push('Invalid image format');
      validationResults.isValid = false;
    }

    if (!validationResults.checks.hasReasonableSize) {
      validationResults.issues.push('Image size outside acceptable range');
      validationResults.isValid = false;
    }

    if (!validationResults.checks.hasReasonableDimensions) {
      validationResults.issues.push('Image dimensions too small');
      validationResults.isValid = false;
    }

    // Note: EXIF data is optional but recommended for geotagging
    if (!validationResults.checks.hasExifData) {
      validationResults.issues.push('No EXIF data detected (geotagging recommended)');
      // This is a warning, not a failure
    }

    return validationResults;
  } catch (err) {
    console.error('[photo-audit] Integrity validation error:', err.message);
    return {
      isValid: false,
      issues: ['Failed to validate image integrity'],
      error: err.message
    };
  }
}

/**
 * Compare complaint photo with resolution proof photo
 * Detects if resolution photo is identical to complaint photo (fake upload)
 */
async function auditResolutionPhotos(complaintPhotoBuffer, resolutionPhotoBuffer, submissionTime) {
  try {
    // Validate both photos
    const complaintValidation = await validatePhotoIntegrity(complaintPhotoBuffer, submissionTime);
    const resolutionValidation = await validatePhotoIntegrity(resolutionPhotoBuffer, submissionTime);

    // Check similarity between photos
    const similarityCheck = await checkImageSimilarity(complaintPhotoBuffer, resolutionPhotoBuffer);

    const auditResult = {
      isValid: true,
      issues: [],
      complaintPhoto: {
        validation: complaintValidation,
        perceptualHash: complaintValidation.perceptualHash
      },
      resolutionPhoto: {
        validation: resolutionValidation,
        perceptualHash: resolutionValidation.perceptualHash
      },
      similarity: similarityCheck,
      recommendations: []
    };

    // Check for identical photos (potential fake upload)
    if (similarityCheck.isIdentical) {
      auditResult.isValid = false;
      auditResult.issues.push('Resolution photo is identical to complaint photo - potential fake upload');
      auditResult.recommendations.push('Upload a genuine resolution photo showing the completed work');
    }

    // Check for very similar photos
    if (similarityCheck.isVerySimilar && !similarityCheck.isIdentical) {
      auditResult.issues.push('Resolution photo is very similar to complaint photo - verify authenticity');
      auditResult.recommendations.push('Ensure resolution photo shows actual changes/repairs');
    }

    // Check individual photo validations
    if (!complaintValidation.isValid) {
      auditResult.issues.push('Complaint photo validation failed: ' + complaintValidation.issues.join(', '));
    }

    if (!resolutionValidation.isValid) {
      auditResult.issues.push('Resolution photo validation failed: ' + resolutionValidation.issues.join(', '));
    }

    // Final validity check
    auditResult.isValid = auditResult.issues.filter(issue =>
      !issue.includes('No EXIF data') // EXIF warning is not a failure
    ).length === 0;

    return auditResult;
  } catch (err) {
    console.error('[photo-audit] Photo audit error:', err.message);
    return {
      isValid: false,
      issues: ['Photo audit failed: ' + err.message],
      error: err.message
    };
  }
}

/**
 * Generate MD5 hash for file integrity checking
 */
function generateFileHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

async function auditImageReuse(imageBuffer, existingIncidents = []) {
  const currentBuffer = toImageBuffer(imageBuffer);
  const currentHash = currentBuffer ? await generatePerceptualHash(currentBuffer) : null;

  const baseResult = {
    duplicate: false,
    match: null,
    perceptual_hash: currentHash,
    similarity: 0,
    distance: 0
  };

  if (!currentBuffer || !currentHash || !Array.isArray(existingIncidents) || !existingIncidents.length) {
    return baseResult;
  }

  for (const incident of existingIncidents) {
    if (!incident) continue;

    const candidate = incident.original_photo || incident.originalPhoto || incident.image || incident.photo || null;
    const candidateBuffer = toImageBuffer(candidate);
    if (!candidateBuffer) continue;

    const candidateHash = await generatePerceptualHash(candidateBuffer);
    const distance = calculateHammingDistance(currentHash, candidateHash);
    const maxDistance = currentHash.length;
    const similarity = maxDistance ? 1 - (distance / maxDistance) : 0;

    if (similarity >= 0.95) {
      return {
        duplicate: true,
        match: {
          incident_id: incident.id || incident.incident_id || null,
          asset_type: 'complaint_photo',
          similarity: Number(similarity.toFixed(6)),
          distance,
          source: 'existing_incident'
        },
        perceptual_hash: currentHash,
        similarity: Number(similarity.toFixed(6)),
        distance
      };
    }
  }

  return baseResult;
}

module.exports = {
  AI_AUDIT_FLAG,
  generatePerceptualHash,
  calculateHammingDistance,
  checkImageSimilarity,
  extractImageMetadata,
  validatePhotoIntegrity,
  auditResolutionPhotos,
  auditImageReuse,
  generateFileHash
};
