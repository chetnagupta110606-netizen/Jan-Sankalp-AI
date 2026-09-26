const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_HASH_BYTES = 64;
const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const ALLOWED_ROLES = new Set(['OFFICER', 'ADMIN']);

function getAuthConfig() {
  const secret = process.env.AUTH_JWT_SECRET;
  const issuer = process.env.AUTH_JWT_ISSUER;
  const audience = process.env.AUTH_JWT_AUDIENCE;
  if (!secret || Buffer.byteLength(secret) < 32 || !issuer || !audience) {
    throw new Error('JWT authorization is not configured.');
  }

  let accounts;
  try {
    accounts = JSON.parse(process.env.AUTH_OFFICER_ACCOUNTS || '[]');
  } catch (_) {
    throw new Error('Officer account configuration is invalid.');
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No officer accounts are configured.');
  }
  const hasValidAccount = accounts.some((account) =>
    account &&
    typeof account.officerId === 'string' && account.officerId.trim() &&
    typeof account.name === 'string' && account.name.trim() &&
    typeof account.department === 'string' && account.department.trim() &&
    ALLOWED_ROLES.has(String(account.role || '').toUpperCase()) &&
    typeof account.passwordHash === 'string' &&
    /^scrypt\$[A-Za-z0-9_-]{20,90}\$[a-f0-9]{128}$/i.test(account.passwordHash)
  );
  if (!hasValidAccount) {
    throw new Error('No valid officer accounts are configured.');
  }
  return { secret, issuer, audience, accounts };
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must contain at least 12 characters.');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, PASSWORD_HASH_BYTES);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;
  const parts = encodedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' ||
      !/^[a-f0-9]{128}$/i.test(parts[2])) {
    return false;
  }

  let salt;
  try {
    salt = Buffer.from(parts[1], 'base64url');
  } catch (_) {
    return false;
  }
  if (salt.length < 16 || salt.length > 64) return false;

  const expected = Buffer.from(parts[2], 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function signToken(claims, config, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    ...claims,
    iss: config.issuer,
    aud: config.audience,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS
  })).toString('base64url');
  const unsignedToken = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', config.secret)
    .update(unsignedToken)
    .digest('base64url');
  return `${unsignedToken}.${signature}`;
}

async function authenticateOfficer({ officerId, password, department } = {}) {
  const config = getAuthConfig();
  const normalizedId = String(officerId || '').trim().toLowerCase();
  const account = config.accounts.find((entry) =>
    entry && typeof entry.officerId === 'string' &&
    entry.officerId.trim().toLowerCase() === normalizedId
  );
  if (!account ||
      !(await verifyPassword(password, account.passwordHash)) ||
      String(account.department || '').trim() !== String(department || '').trim()) {
    return null;
  }

  const role = String(account.role || '').toUpperCase();
  if (!ALLOWED_ROLES.has(role) || !account.name || !account.department) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((nowSeconds + TOKEN_LIFETIME_SECONDS) * 1000).toISOString();
  const user = {
    officerId: account.officerId,
    name: account.name,
    department: account.department,
    role
  };
  const token = signToken({
    sub: account.officerId,
    role,
    name: account.name,
    department: account.department
  }, config, nowSeconds);

  return { token, expiresAt, user };
}

module.exports = { authenticateOfficer, hashPassword, signToken, getAuthConfig };
