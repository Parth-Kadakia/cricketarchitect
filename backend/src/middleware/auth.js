import pool from '../config/db.js';
import { verifyToken } from '../utils/jwt.js';

function parseAuthHeader(headerValue) {
  if (!headerValue || !headerValue.startsWith('Bearer ')) {
    return null;
  }

  return headerValue.replace('Bearer ', '').trim();
}

export async function requireAuth(req, res, next) {
  try {
    const token = parseAuthHeader(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ message: 'Authentication token missing.' });
    }

    const payload = verifyToken(token);
    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, career_mode, last_active_at
       FROM users
       WHERE id = $1`,
      [payload.sub]
    );

    if (!rows.length) {
      return res.status(401).json({ message: 'Invalid user session.' });
    }

    req.user = rows[0];

    await pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [req.user.id]);

    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

export async function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  return next();
}
