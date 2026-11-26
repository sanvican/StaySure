import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client';

export default function Register({ onAuthSuccess }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    role: 'GUEST',
    walletAddress: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onAuthSuccess(data.token, data.user);
      navigate(data.user.role === 'HOST' ? '/host' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 460, margin: '32px auto' }}>
      <h2 style={{ marginBottom: 4 }}>Join StaySure</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Create a traveler or host account in seconds.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="form-grid">
        <div>
          <label htmlFor="reg-user">Username</label>
          <input
            id="reg-user"
            required
            placeholder="alex_traveler"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="reg-email">Email</label>
          <input
            id="reg-email"
            type="email"
            placeholder="alex@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="reg-pass">Password (min 6 characters)</label>
          <input
            id="reg-pass"
            type="password"
            minLength={6}
            required
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="reg-role">I want to</label>
          <select
            id="reg-role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="GUEST">Travel &amp; book verified stays</option>
            <option value="HOST">Host &amp; verify my property</option>
          </select>
        </div>

        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <p className="muted" style={{ marginBottom: 0, marginTop: 16 }}>
        Already have an account?{' '}
        <Link to="/login" style={{ color: 'var(--brand)', fontWeight: 700 }}>
          Log in
        </Link>
      </p>
    </div>
  );
}
