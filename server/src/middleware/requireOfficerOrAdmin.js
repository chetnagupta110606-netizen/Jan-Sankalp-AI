const crypto = require('crypto');

const ALLOWED_ROLES = new Set(['OFFICER', 'ADMIN']);
const MIN_SECRET_BYTES = 32;
const MAX_TOKEN_LENGTH = 8192;

function decodeJwtPart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) {
    throw new Error('Malformed token.');
  }
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function verifyHs256Jwt(token, config, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    throw new Error('Malformed token.');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('Malformed token.');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJwtPart(headerPart);
  const claims = decodeJwtPart(payloadPart);
  if (!header || header.alg !== 'HS256' || (header.typ && header.typ !== 'JWT')) {
    throw new Error('Unsupported token.');
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new Error('Malformed claims.');
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  if (!/^[A-Za-z0-9_-]+$/.test(signaturePart)) {
    throw new Error('Malformed signature.');
  }
  const suppliedSignature = Buffer.from(signaturePart, 'base64url');
  if (suppliedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new Error('Invalid signature.');
  }

  const audienceMatches = typeof claims.aud === 'string'
    ? claims.aud === config.audience
    : Array.isArray(claims.aud) && claims.aud.includes(config.audience);
  if (claims.iss !== config.issuer || !audienceMatches) {
    throw new Error('Invalid token issuer or audience.');
  }
  if (typeof claims.sub !== 'string' || !claims.sub.trim() ||
      !Number.isFinite(claims.exp) || claims.exp <= nowSeconds) {
    throw new Error('Invalid token identity or expiry.');
  }
  if (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > nowSeconds)) {
    throw new Error('Token is not active.');
  }

  return claims;
}

function requireOfficerOrAdmin(req, res, next) {
  const config = {
    secret: process.env.AUTH_JWT_SECRET,
    issuer: process.env.AUTH_JWT_ISSUER,
    audience: process.env.AUTH_JWT_AUDIENCE
  };

  if (!config.secret || Buffer.byteLength(config.secret) < MIN_SECRET_BYTES ||
      !config.issuer || !config.audience) {
    return res.status(503).json({
      success: false,
      error: 'Resolution authorization is not configured.'
    });
  }

  const authorization = req.headers && req.headers.authorization;
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer ([^\s]+)$/i)
    : null;
  if (!match) {
    return res.status(401).json({
      success: false,
      error: 'A valid bearer token is required.'
    });
  }

  let claims;
  try {
    claims = verifyHs256Jwt(match[1], config);
  } catch (_) {
    return res.status(401).json({
      success: false,
      error: 'A valid bearer token is required.'
    });
  }

  const role = typeof claims.role === 'string' ? claims.role.toUpperCase() : '';
  if (!ALLOWED_ROLES.has(role)) {
    return res.status(403).json({
      success: false,
      error: 'Officer or Admin role required.'
    });
  }

  req.auth = claims;
  req.userRole = role;
  return next();
}

module.exports = { requireOfficerOrAdmin, verifyHs256Jwt };
