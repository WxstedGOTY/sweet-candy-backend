const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 20) {
  console.warn('WARNING: JWT_SECRET is missing or too short. Set a long random value in .env before launch.');
}

const SESSION_COOKIE_NAME = 'sc_session';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function issueSessionCookie(res, user) {
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME);
}

/**
 * Express middleware: requires a valid session cookie with one of the
 * given roles. Attaches the decoded user to req.user.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (!allowedRoles.includes(payload.role)) {
        return res.status(403).json({ error: 'Not authorized for this action.' });
      }
      req.user = payload;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Session invalid or expired.' });
    }
  };
}

async function findUserByUsername(username) {
  return db.getOne('users', (u) => u.username === username);
}

module.exports = {
  hashPassword,
  verifyPassword,
  issueSessionCookie,
  clearSessionCookie,
  requireRole,
  findUserByUsername,
  SESSION_COOKIE_NAME
};
