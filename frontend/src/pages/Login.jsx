import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client';

export default function Login({ viewMode = 'traveler', onAuthSuccess }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onAuthSuccess(data.token, data.user);
      if (data.user.role === 'ADMIN') navigate('/admin');
      else if (data.user.role === 'HOST') navigate('/host');
      else navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoUser) => {
    setUsername(demoUser);
    setPassword('password123');
  };

  return (
    <div className="card" style={{ maxWidth: 440, margin: '32px auto' }}>
      <h2 style={{ marginBottom: 4 }}>Welcome back</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Sign in to book verified stays or manage your listings.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="form-grid">
        <div>
          <label htmlFor="login-user">Username</label>
          <input
            id="login-user"
            required
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="login-pass">Password</label>
          <input
            id="login-pass"
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Signing in...' : 'Log in'}
        </button>
      </form>

      {viewMode === 'developer' && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div className="muted" style={{ marginBottom: 8, fontSize: '0.82rem' }}>
            Developer quick-fill (seeded via <code>npm run demo:e2e</code>):
          </div>
          <div className="flex-gap">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fillDemo('demo_host')}
            >
              demo_host
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fillDemo('demo_guest')}
            >
              demo_guest
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fillDemo('demo_admin')}
            >
              demo_admin
            </button>
          </div>
        </div>
      )}

      <p className="muted" style={{ marginBottom: 0, marginTop: 16 }}>
        New to StaySure?{' '}
        <Link to="/register" style={{ color: 'var(--brand)', fontWeight: 700 }}>
          Create an account
        </Link>
      </p>
    </div>
  );
}
