const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const prisma = require('./prisma/client');
const { securityHeaders } = require('./middleware/security');

const authRoutes = require('./routes/auth');
const propertyRoutes = require('./routes/properties');
const verificationRoutes = require('./routes/verification');
const bookingRoutes = require('./routes/bookings');
const adminRoutes = require('./routes/admin');
const hostRoutes = require('./routes/host');

const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, service: 'staysure-backend', db: 'connected' });
  } catch (err) {
    return res.status(503).json({ ok: false, service: 'staysure-backend', db: 'error' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/properties', verificationRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/host', hostRoutes);

// Serve production frontend bundle if built (never serves private_media/)
const frontendDist = path.resolve(__dirname, '../frontend/dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Central JSON error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' && status === 500
      ? 'Internal server error.'
      : err.message || 'Unexpected error.';
  res.status(status).json({ detail: message });
});

module.exports = app;
