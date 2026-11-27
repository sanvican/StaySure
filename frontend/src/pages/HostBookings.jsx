import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';

export default function HostBookings({ user }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || user.role !== 'HOST') {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const data = await apiRequest('/host/bookings');
        setBookings(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (!user || user.role !== 'HOST') {
    return <div className="alert alert-warning">Host login required.</div>;
  }

  return (
    <div>
      <h1 style={{ marginBottom: 6 }}>Property Bookings</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Reservations guests have made at your properties.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading bookings...</p>}

      {!loading && bookings.length === 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 6 }}>No bookings yet</h3>
          <p className="muted" style={{ margin: 0 }}>
            When travelers book your properties, their reservations will appear here.
          </p>
        </div>
      )}

      {!loading && bookings.length > 0 && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Property</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.guest?.username || 'Guest'}</strong>
                      {b.guest?.email && (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          {b.guest.email}
                        </div>
                      )}
                    </td>
                    <td>
                      <Link to={`/properties/${b.propertyId}`}>
                        {b.property?.name || 'Property'}
                      </Link>
                      {b.property?.city && (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          {b.property.city}
                        </div>
                      )}
                    </td>
                    <td>{new Date(b.checkIn).toLocaleDateString()}</td>
                    <td>{new Date(b.checkOut).toLocaleDateString()}</td>
                    <td><strong>₹{b.totalPrice}</strong></td>
                    <td>
                      <span
                        className={`badge ${
                          b.status === 'CONFIRMED'
                            ? 'badge-confirmed'
                            : b.status === 'CANCELLED'
                            ? 'badge-cancelled'
                            : 'badge-pending'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
