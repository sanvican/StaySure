const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../prisma/client');
const { ROLES } = require('../config');
const { signToken, requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/security');

const router = express.Router();
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60 });

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    walletAddress: user.walletAddress,
    identityVerified: user.identityVerified,
    createdAt: user.createdAt,
  };
}

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email = '', password, role = ROLES.GUEST, walletAddress = null } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ detail: 'username and password are required.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ detail: 'password must be at least 6 characters.' });
    }
    const cleanEmail = String(email || '').trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ detail: 'Please provide a valid email address.' });
    }

    const normalizedUsername = String(username).trim();
    const chosenRole = [ROLES.HOST, ROLES.GUEST].includes(role) ? role : ROLES.GUEST;

    const existing = await prisma.user.findUnique({ where: { username: normalizedUsername } });
    if (existing) {
      return res.status(400).json({ detail: 'Username already exists.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
      data: {
        username: normalizedUsername,
        email: String(email || '').trim(),
        passwordHash,
        role: chosenRole,
        walletAddress: walletAddress ? String(walletAddress).trim() : null,
      },
    });

    const token = signToken(user);
    return res.status(201).json({
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ detail: 'username and password are required.' });
    }

    const user = await prisma.user.findUnique({
      where: { username: String(username).trim() },
    });
    if (!user) {
      return res.status(401).json({ detail: 'Invalid username or password.' });
    }

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ detail: 'Invalid username or password.' });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
