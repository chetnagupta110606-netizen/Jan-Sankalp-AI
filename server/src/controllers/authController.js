const { authenticateOfficer } = require('../services/authService');

async function login(req, res) {
  res.set('Cache-Control', 'no-store');
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const officerId = typeof body.officerId === 'string' ? body.officerId.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const department = typeof body.department === 'string' ? body.department.trim() : '';

  if (!officerId || !password || !department) {
    return res.status(400).json({
      success: false,
      error: 'Officer ID, password, and department are required.'
    });
  }

  try {
    const session = await authenticateOfficer({ officerId, password, department });
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Officer ID, password, or department is incorrect.'
      });
    }
    return res.json({ success: true, ...session });
  } catch (err) {
    console.error('[auth:login] Authentication configuration error:', err.message);
    return res.status(503).json({
      success: false,
      error: 'Officer authentication is not configured.'
    });
  }
}

module.exports = { login };
