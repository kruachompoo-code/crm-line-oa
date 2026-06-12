const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

// LIFF: validate LINE ID token passed from frontend
async function authenticateLiff(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Verify against LINE's OIDC endpoint or decode local JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.lineUserId = decoded.lineUserId;
    next();
  } catch (err) {
    logger.warn('Auth failed', { err: err.message });
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Admin dashboard: simple JWT with role
async function authenticateAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    req.adminId = decoded.sub;
    req.branchId = decoded.branchId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Issue a token for LIFF after LINE Login
function issueToken(lineUserId, branchId) {
  return jwt.sign({ lineUserId, branchId }, process.env.JWT_SECRET, { expiresIn: '24h' });
}

module.exports = { authenticateLiff, authenticateAdmin, issueToken };
