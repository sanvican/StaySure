import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function MyTrips({ user, viewMode = 'traveler' }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBookings = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/bookings');
      setBookings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadBookings();
    } else {
      setLoading(false);
    }
  }, [user]);

  const handleCancel = async (bookingId) => {
    setError('');
    try {
      await apiRequest(`/bookings/${bookingId}/cancel`, { method: 'PATCH' });
      await loadBookings();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!user) {
    return (
      <div className="alert alert-warning">
        Please <Link to="/login" style={{ textDecoration: 'underline' }}>log in</Link> to view your
        trips.
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 6 }}>My Trips</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Your confirmed reservations and verified stay history.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Loading your reservations...</p>}

      {!loading && bookings.length === 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 6 }}>No trips booked yet</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Explore StaySure&apos;s live-verified homes and book with confidence.
          </p>
          <Link to="/" className="btn">
            Explore Verified Stays
          </Link>
        </div>
      )}

      <div className="grid-2">
        {bookings.map((b) => (
          <div className="card" key={b.id}>
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <StatusBadge status={b.status} viewMode={viewMode} />
              <strong>${b.totalPrice} total</strong>
            </div>

            <h3 style={{ marginBottom: 4 }}>
              <Link to={`/properties/${b.propertyId}`}>{b.property?.name || 'Stay'}</Link>
            </h3>
            <div className="muted" style={{ marginBottom: 10 }}>
              {b.property?.city ? `${b.property.city} · ` : ''}
              Check-in {new Date(b.checkIn).toLocaleDateString()} → Check-out{' '}
              {new Date(b.checkOut).toLocaleDateString()}
            </div>

            <div className="flex-between">
              <Link to={`/properties/${b.propertyId}`} className="btn btn-secondary btn-sm">
                View Listing
              </Link>
              {b.status === 'CONFIRMED' && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => handleCancel(b.id)}
                >
                  Cancel Reservation
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
