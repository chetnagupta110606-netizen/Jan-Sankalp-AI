/**
 * Utility to compute the combined confidence score for ground verification.
 * This blends anti-fraud trust, coherence, and normalized spectral variance.
 */

export interface VerificationScoreInput {
  trustScore: number;
  spectralVariance: number;
  coherence: number;
}

export interface VerificationScoreResult {
  overallScore: number;
  status: 'VERIFIED' | 'NEEDS_MANUAL_REVIEW' | 'REJECTED';
  confidencePercentage: string;
}

/**
 * Normalizes spectral variance against an ideal variance delta close to 1.0.
 * Values around 1.0 are considered healthier, while larger deviations are reduced.
 */
function normalizeSpectralVariance(spectralVariance: number): number {
  const idealDelta = 1.0;
  const normalized = 1 - Math.abs(spectralVariance - idealDelta) / idealDelta;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Computes a combined verification confidence score with the following weighting:
 * - 40% Coherence
 * - 40% Anti-Fraud Trust Score
 * - 20% Normalized Spectral Variance
 *
 * The final value is clamped between 0.01 and 0.99.
 */
export function computeVerificationScore(
  input: VerificationScoreInput
): VerificationScoreResult {
  const safeTrustScore = Math.max(0, Math.min(1, input.trustScore));
  const safeCoherence = Math.max(0, Math.min(1, input.coherence));
  const safeSpectralVariance = Math.max(0, input.spectralVariance);

  const normalizedSpectral = normalizeSpectralVariance(safeSpectralVariance);

  const weightedScore =
    0.4 * safeCoherence +
    0.4 * safeTrustScore +
    0.2 * normalizedSpectral;

  const clampedScore = Math.min(0.99, Math.max(0.01, weightedScore));

  let status: VerificationScoreResult['status'];

  if (clampedScore >= 0.85) {
    status = 'VERIFIED';
  } else if (clampedScore >= 0.6) {
    status = 'NEEDS_MANUAL_REVIEW';
  } else {
    status = 'REJECTED';
  }

  return {
    overallScore: Number(clampedScore.toFixed(2)),
    status,
    confidencePercentage: `${Math.round(clampedScore * 100)}%`
  };
}
