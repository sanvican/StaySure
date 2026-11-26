const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const { getConfig } = require('../config');

function signToken(user) {
  const cfg = getConfig();
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
    },
    cfg.jwtSecret,
    { expiresIn: '7d' }
  );
}

async function resolveUserFromHeader(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const cfg = getConfig();
  const payload = jwt.verify(token, cfg.jwtSecret);
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      walletAddress: true,
      identityVerified: true,
    },
  });
  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await resolveUserFromHeader(req);
    if (!user) {
      return res.status(401).json({ detail: 'Authentication required.' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ detail: 'Invalid or expired token.' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const user = await resolveUserFromHeader(req);
    if (user) req.user = user;
  } catch (_) {
    // Ignore invalid optional token
  }
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ detail: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ detail: 'Forbidden: insufficient permissions.' });
    }
    return next();
  };
}

module.exports = {
  signToken,
  requireAuth,
  optionalAuth,
  requireRole,
};
