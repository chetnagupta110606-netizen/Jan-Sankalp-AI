const test = require('node:test');
const assert = require('node:assert/strict');

const { login } = require('../src/controllers/authController');
const { hashPassword } = require('../src/services/authService');
const { verifyHs256Jwt } = require('../src/middleware/requireOfficerOrAdmin');
const apiRoutes = require('../src/routes/apiRoutes');

const authConfig = {
  secret: 'test-auth-secret-with-at-least-32-bytes',
  issuer: 'https://jan-sankalp.test',
  audience: 'jan-sankalp-test-api'
};
const password = 'correct-horse-battery-staple';

function setAuthEnvironment(accounts) {
  const previous = {
    AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
    AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER,
    AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE,
    AUTH_OFFICER_ACCOUNTS: process.env.AUTH_OFFICER_ACCOUNTS
  };
  process.env.AUTH_JWT_SECRET = authConfig.secret;
  process.env.AUTH_JWT_ISSUER = authConfig.issuer;
  process.env.AUTH_JWT_AUDIENCE = authConfig.audience;
  process.env.AUTH_OFFICER_ACCOUNTS = JSON.stringify(accounts);
  return function restore() {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('auth login route is mounted under the API router', () => {
  const layer = apiRoutes.stack.find((entry) =>
    entry.route && entry.route.path === '/auth/login' && entry.route.methods.post
  );
  assert.ok(layer);
  assert.equal(layer.route.stack[0].handle, login);
});

test('login returns a signed Officer token with server-owned department claims', async () => {
  const passwordHash = hashPassword(password);
  const restore = setAuthEnvironment([{
    officerId: 'OFF-17',
    name: 'Asha Sharma',
    department: 'Public Works Department',
    role: 'OFFICER',
    passwordHash
  }]);
  try {
    const res = responseCapture();
    await login({
      body: {
        officerId: 'off-17',
        password,
        department: 'Public Works Department'
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.name, 'Asha Sharma');
    assert.equal(res.body.user.department, 'Public Works Department');

    const claims = verifyHs256Jwt(res.body.token, authConfig);
    assert.equal(claims.sub, 'OFF-17');
    assert.equal(claims.role, 'OFFICER');
    assert.equal(claims.department, 'Public Works Department');
  } finally {
    restore();
  }
});

test('login rejects wrong password and department without revealing account details', async () => {
  const passwordHash = hashPassword(password);
  const restore = setAuthEnvironment([{
    officerId: 'OFF-17',
    name: 'Asha Sharma',
    department: 'Public Works Department',
    role: 'OFFICER',
    passwordHash
  }]);
  try {
    for (const credentials of [
      { officerId: 'OFF-17', password: 'incorrect-password', department: 'Public Works Department' },
      { officerId: 'OFF-17', password, department: 'Municipal Corporation' }
    ]) {
      const res = responseCapture();
      await login({ body: credentials }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'Officer ID, password, or department is incorrect.');
    }
  } finally {
    restore();
  }
});

test('login reports missing fields and fails closed without server auth configuration', async () => {
  const missingFields = responseCapture();
  await login({ body: { officerId: 'OFF-17' } }, missingFields);
  assert.equal(missingFields.statusCode, 400);

  const restore = setAuthEnvironment([]);
  try {
    const unconfigured = responseCapture();
    await login({
      body: { officerId: 'OFF-17', password, department: 'Public Works Department' }
    }, unconfigured);
    assert.equal(unconfigured.statusCode, 503);
  } finally {
    restore();
  }
});
