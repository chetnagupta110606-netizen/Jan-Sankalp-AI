/**
 * Utility functions for validating civic report authenticity.
 * These checks help detect basic fraud/spam patterns before a report is accepted.
 */

export type ReportLocation = {
  lat: number;
  lng: number;
};

export type AuthenticityInput = {
  userAudioTranscript: string;
  userCoordinates: ReportLocation;
  reportedCategory: string;
  recentUserReportsCount: number;
};

export type CheckFlags = {
  rateLimit: boolean;
  textRelevance: boolean;
  geofenceValid: boolean;
};

export type AuthenticityResult = {
  isFraud: boolean;
  trustScore: number;
  rejectionReason?: string;
  checksPassed: CheckFlags;
};

/**
 * Detects whether a submitted civic report looks fraudulent based on three checks:
 * 1. recent report count spam detection
 * 2. transcript quality and keyword relevance
 * 3. geofence validation for the Delhi region
 */
export function validateReportAuthenticity(input: AuthenticityInput): AuthenticityResult {
  const transcript = (input.userAudioTranscript ?? '').trim();
  const category = (input.reportedCategory ?? '').trim().toLowerCase();
  const { lat, lng } = input.userCoordinates ?? { lat: 0, lng: 0 };

  const civicKeywords = [
    'bridge',
    'road',
    'pothole',
    'collapse',
    'water',
    'drainage',
    'traffic',
    'accident'
  ];

  const rateLimitPassed = input.recentUserReportsCount <= 3;
  const textLengthValid = transcript.length >= 15;
  const hasRelevantKeyword = civicKeywords.some((keyword) =>
    transcript.toLowerCase().includes(keyword) || category.includes(keyword)
  );
  const textRelevancePassed = textLengthValid && hasRelevantKeyword;

  const geofenceValid =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= 28.4 &&
    lat <= 28.9 &&
    lng >= 76.9 &&
    lng <= 77.4;

  const checksPassed: CheckFlags = {
    rateLimit: rateLimitPassed,
    textRelevance: textRelevancePassed,
    geofenceValid
  };

  const failedChecks: string[] = [];

  if (!rateLimitPassed) {
    failedChecks.push('Rate limit exceeded: too many recent reports from this user.');
  }

  if (!textRelevancePassed) {
    failedChecks.push('Transcript is too short or unrelated to civic infrastructure issues.');
  }

  if (!geofenceValid) {
    failedChecks.push('Coordinates are outside the Delhi geofence.');
  }

  const isFraud = failedChecks.length > 0;

  // Trust score starts at 1.0 and is reduced by each failed validation check.
  const trustScore = Number(
    Math.max(
      0,
      1 -
        (failedChecks.length / 3) * 0.9 -
        (!textLengthValid ? 0.08 : 0) -
        (!hasRelevantKeyword ? 0.05 : 0)
    ).toFixed(2)
  );

  return {
    isFraud,
    trustScore,
    rejectionReason: isFraud ? failedChecks.join(' ') : undefined,
    checksPassed
  };
}
