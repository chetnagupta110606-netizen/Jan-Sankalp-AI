const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const apiRoutes = require('../src/routes/apiRoutes');

const { requireOfficerOrAdmin, verifyHs256Jwt } = require('../src/middleware/requireOfficerOrAdmin');

const config = {
  secret: 'test-only-secret-that-is-at-least-32-bytes',
  issuer: 'https://trusted-issuer.example',
  audience: 'jan-sankalp-api'
};

function createToken(claims, secret = config.secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function validClaims(overrides = {}) {
  return {
    sub: 'officer-123',
    role: 'OFFICER',
    iss: config.issuer,
    aud: config.audience,
    exp: 2000000000,
    ...overrides
  };
}

function invokeMiddleware(authorization, extra = {}) {
  let statusCode = null;
  let responseBody = null;
  let nextCalled = false;
  const req = {
    headers: authorization ? { authorization } : {},
    body: { userRole: 'ADMIN' },
    query: { role: 'ADMIN' },
    ...extra
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };
  const next = () => { nextCalled = true; };

  const previousEnv = {
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
    AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER,
    AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE
  };
  process.env.AUTH_JWT_SECRET = config.secret;
  process.env.AUTH_JWT_ISSUER = config.issuer;
  process.env.AUTH_JWT_AUDIENCE = config.audience;
  try {
    requireOfficerOrAdmin(req, res, next);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { req, statusCode, responseBody, nextCalled };
}

test('accepts a signed, unexpired officer token with configured issuer and audience', () => {
  const claims = verifyHs256Jwt(createToken(validClaims()), config, 1900000000);
  assert.equal(claims.sub, 'officer-123');
});

test('rejects forged role headers/body/query without a bearer token', () => {
  const result = invokeMiddleware(null, {
    headers: { 'x-user-role': 'ADMIN' },
    body: { userRole: 'ADMIN' },
    query: { role: 'ADMIN' }
  });
  assert.equal(result.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test('rejects invalid signature, expiry, issuer, audience, and non-officer roles', () => {
  assert.throws(() => verifyHs256Jwt(createToken(validClaims(), 'wrong-secret'), config, 1900000000));
  assert.throws(() => verifyHs256Jwt(createToken(validClaims({ exp: 1800000000 })), config, 1900000000));
  assert.throws(() => verifyHs256Jwt(createToken(validClaims({ iss: 'untrusted' })), config, 1900000000));
  assert.throws(() => verifyHs256Jwt(createToken(validClaims({ aud: 'another-api' })), config, 1900000000));

  const result = invokeMiddleware(`Bearer ${createToken(validClaims({ role: 'CITIZEN' }))}`);
  assert.equal(result.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('sets the authorized role from trusted token claims', () => {
  const result = invokeMiddleware(`Bearer ${createToken(validClaims({ role: 'admin' }))}`);
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.userRole, 'ADMIN');
  assert.equal(result.req.auth.sub, 'officer-123');
});

test('fails closed when the trusted JWT configuration is missing', () => {
  const previousSecret = process.env.AUTH_JWT_SECRET;
  delete process.env.AUTH_JWT_SECRET;
  let statusCode = null;
  try {
    requireOfficerOrAdmin(
      { headers: {} },
      { status(code) { statusCode = code; return this; }, json() {} },
      () => assert.fail('next must not run')
    );
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = previousSecret;
  }
  assert.equal(statusCode, 503);
});

test('both resolution submission routes use trusted Officer/Admin authorization', () => {
  const protectedPaths = ['/resolutions', '/incidents/:id/resolution'];
  for (const path of protectedPaths) {
    const routeLayer = apiRoutes.stack.find((layer) =>
      layer.route && layer.route.path === path && layer.route.methods.post
    );
    assert.ok(routeLayer, `expected POST ${path}`);
    assert.ok(routeLayer.route.stack.some((handler) =>
      handler.handle === requireOfficerOrAdmin
    ), `expected authorization middleware on POST ${path}`);
  }
});
