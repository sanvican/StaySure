/**
 * Lightweight production security headers and in-memory auth rate limiter.
 */

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self)');
  next();
}

function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 60 } = {}) {
  const hits = new Map();

  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(key);

    if (!record || now > record.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count += 1;
    if (record.count > max) {
      return res.status(429).json({
        detail: 'Too many requests. Please wait a few minutes and try again.',
      });
    }
    return next();
  };
}

module.exports = {
  securityHeaders,
  createRateLimiter,
};
