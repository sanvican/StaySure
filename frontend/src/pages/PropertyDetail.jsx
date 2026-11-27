import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import ProofInspector from '../components/ProofInspector';
import StatusBadge from '../components/StatusBadge';
import TrustIndexCard from '../components/TrustIndexCard';

const ROOM_TITLES = {
  living_room: 'Living Room',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
};

export default function PropertyDetail({ user, viewMode = 'traveler', onSwitchToDev }) {
  const { id } = useParams();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imgBust, setImgBust] = useState(Date.now());

  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [bookingMsg, setBookingMsg] = useState('');
  const [bookingErr, setBookingErr] = useState('');
  const [bookingBusy, setBookingBusy] = useState(false);

  // Review form state
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewMsg, setReviewMsg] = useState('');
  const [reviewErr, setReviewErr] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const loadProperty = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/properties/${id}`);
      setProperty(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProperty();
  }, [loadProperty]);

  const handleRunVerify = async (index) => {
    setImgBust(Date.now());
    return apiRequest(`/properties/${id}/verify-onchain?index=${index}`);
  };

  const nightsCount = (() => {
    if (!checkIn || !checkOut) return 0;
    const diff = new Date(checkOut) - new Date(checkIn);
    if (!Number.isFinite(diff) || diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();

  const handleBooking = async (e) => {
    e.preventDefault();
    setBookingMsg('');
    setBookingErr('');
    setBookingBusy(true);
    try {
      const booking = await apiRequest('/bookings', {
        method: 'POST',
        body: JSON.stringify({ propertyId: id, checkIn, checkOut }),
      });
      setBookingMsg(
        `Reservation confirmed! Total: ₹${booking.totalPrice}. Manage it anytime in My Bookings.`
      );
    } catch (err) {
      setBookingErr(err.message);
    } finally {
      setBookingBusy(false);
    }
  };

  const handleReview = async (e) => {
    e.preventDefault();
    setReviewMsg('');
    setReviewErr('');
    setReviewBusy(true);
    try {
      await apiRequest(`/properties/${id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      });
      setReviewMsg('Thank you for your review!');
      setReviewComment('');
      await loadProperty(); // Reload to show new review
    } catch (err) {
      setReviewErr(err.message);
    } finally {
      setReviewBusy(false);
    }
  };

  if (loading) return <p className="muted">Loading stay details...</p>;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!property) return null;

  const photoMap = {};
  for (const ph of property.latestPhotos || []) {
    photoMap[ph.viewLabel] = ph;
  }

  const isGuest = user && user.role === 'GUEST';
  const isHost = user && user.role === 'HOST';
  const isOwner = property.isOwner;

  // Check if current guest already reviewed
  const alreadyReviewed = isGuest && property.reviews &&
    property.reviews.some((r) => r.guestUsername === user.username);

  return (
    <div>
      {/* Header */}
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <div>
          <div className="flex-gap" style={{ marginBottom: 8 }}>
            <StatusBadge status={property.status} viewMode={viewMode} />
            {property.lastVerifiedAt && (
              <span className="muted" style={{ fontSize: '0.84rem' }}>
                Verified {new Date(property.lastVerifiedAt).toLocaleDateString()}
                {property.daysUntilExpiry !== null && property.status === 'VERIFIED'
                  ? ` · Fresh for ${property.daysUntilExpiry} more day(s)`
                  : ''}
              </span>
            )}
          </div>
          <h1 style={{ margin: '0 0 4px', letterSpacing: '-0.02em' }}>{property.name}</h1>
          <div className="muted">
            {property.city ? `${property.city} · ` : ''}
            {property.bedrooms} bedroom{property.bedrooms > 1 ? 's' : ''} · {property.bathrooms}{' '}
            bath · Up to {property.maxGuests} guests
          </div>
          {/* Rating summary */}
          {property.averageRating > 0 && (
            <div style={{ marginTop: 6, fontSize: '1rem' }}>
              <span className="rating-star" style={{ fontSize: '1.1rem' }}>★</span>{' '}
              <strong>{property.averageRating.toFixed(1)}</strong>
              <span className="muted"> · {property.ratingCount} review{property.ratingCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Only show capture link to HOST who owns this property */}
        {isOwner && isHost && (
          <Link to={`/properties/${property.id}/capture`} className="btn btn-navy btn-sm">
            Capture Updated Photos
          </Link>
        )}
      </div>

      {/* Airbnb-style 3-Photo Gallery */}
      {property.latestPhotos && property.latestPhotos.length > 0 ? (
        <div className="detail-gallery">
          {['living_room', 'bedroom', 'bathroom'].map((view, idx) => (
            <div
              key={view}
              className={idx === 0 ? 'detail-gallery-main' : 'detail-gallery-item'}
            >
              {photoMap[view] ? (
                <img
                  src={`/api/properties/${property.id}/photos/${view}?t=${imgBust}`}
                  alt={ROOM_TITLES[view]}
                />
              ) : (
                <div className="listing-placeholder">Missing {ROOM_TITLES[view]}</div>
              )}
              <span className="photo-tag">✓ {ROOM_TITLES[view]}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            This listing is awaiting its first live-camera photo verification.
          </p>
        </div>
      )}

      {/* Two-Column Airbnb Layout */}
      <div className="detail-layout">
        <div>
          {/* Host & Description */}
          <div className="card">
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>Hosted by {property.hostUsername}</h2>
                <span className="muted">
                  {property.hostIdentityVerified
                    ? '✓ Host identity verified by StaySure Trust & Safety'
                    : 'Host identity verification pending'}
                </span>
              </div>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '999px',
                  background: 'var(--navy)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                }}
              >
                {(property.hostUsername || 'H')[0].toUpperCase()}
              </div>
            </div>

            {property.description && (
              <p style={{ marginTop: 8, marginBottom: 16 }}>{property.description}</p>
            )}

            {property.amenities && property.amenities.length > 0 && (
              <>
                <h3 style={{ fontSize: '1rem', marginBottom: 10 }}>What this place offers</h3>
                <div className="amenities-list">
                  {property.amenities.map((item) => (
                    <span className="amenity-chip" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <TrustIndexCard trustIndex={property.trustIndex} viewMode={viewMode} />

          {/* Reviews Section */}
          <div className="card">
            <h3>
              Guest Reviews
              {property.ratingCount > 0 && (
                <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
                  {' '}· ★ {property.averageRating.toFixed(1)} ({property.ratingCount})
                </span>
              )}
            </h3>

            {property.reviews && property.reviews.length > 0 ? (
              <div style={{ display: 'grid', gap: 14 }}>
                {property.reviews.map((r) => (
                  <div key={r.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                    <div className="flex-between">
                      <strong>{r.guestUsername}</strong>
                      <span style={{ color: 'var(--amber)', fontWeight: 700 }}>
                        {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                      </span>
                    </div>
                    {r.comment && <p className="muted" style={{ margin: '4px 0 0' }}>{r.comment}</p>}
                    <div className="muted" style={{ fontSize: '0.76rem', marginTop: 4 }}>
                      {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>No reviews yet. Be the first to share your experience!</p>
            )}

            {/* Review Form — GUEST only, not already reviewed */}
            {isGuest && !alreadyReviewed && (
              <form onSubmit={handleReview} style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <h4 style={{ margin: '0 0 10px' }}>Leave a Review</h4>
                <div className="form-row">
                  <div>
                    <label htmlFor="review-rating">Rating</label>
                    <select
                      id="review-rating"
                      value={reviewRating}
                      onChange={(e) => setReviewRating(Number(e.target.value))}
                    >
                      <option value={5}>★★★★★ (5)</option>
                      <option value={4}>★★★★☆ (4)</option>
                      <option value={3}>★★★☆☆ (3)</option>
                      <option value={2}>★★☆☆☆ (2)</option>
                      <option value={1}>★☆☆☆☆ (1)</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label htmlFor="review-comment">Comment (optional)</label>
                    <input
                      id="review-comment"
                      placeholder="Share your experience..."
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-trust btn-sm" style={{ marginTop: 10 }} disabled={reviewBusy}>
                  {reviewBusy ? 'Submitting...' : 'Submit Review'}
                </button>
                {reviewMsg && <div className="alert alert-success" style={{ marginTop: 10, marginBottom: 0 }}>{reviewMsg}</div>}
                {reviewErr && <div className="alert alert-error" style={{ marginTop: 10, marginBottom: 0 }}>{reviewErr}</div>}
              </form>
            )}
            {isGuest && alreadyReviewed && (
              <div className="alert alert-info" style={{ marginTop: 14, marginBottom: 0 }}>
                You have already reviewed this property. Thank you!
              </div>
            )}
          </div>

          {/* Privacy & Security Section (adapts to Traveler vs Developer mode) */}
          {viewMode === 'traveler' ? (
            <div className="card">
              <h3>How StaySure Protects You &amp; the Host</h3>
              <div className="grid-2" style={{ gap: 14 }}>
                <div>
                  <strong>Privacy-First Location</strong>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    To protect host safety, only the approximate area ({property.approxLatitude},{' '}
                    {property.approxLongitude}) is shown publicly. The exact street address is kept
                    private off-chain.
                  </p>
                </div>
                <div>
                  <strong>Tamper-Evident Photos</strong>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    Click &ldquo;Verify Photos Are Authentic&rdquo; on the right to verify that
                    the current photos haven&apos;t changed since the host&apos;s live camera
                    check.
                  </p>
                </div>
              </div>
              <div className="alert alert-info" style={{ marginTop: 14, marginBottom: 0 }}>
                <strong>Honest Guarantee:</strong> StaySure proves photos were captured during a
                verified session and have not been altered since. Always review the Trust Score and
                house details before booking.
              </div>
            </div>
          ) : (
            <>
              <div className="card">
                <h3>On-Chain vs. Off-Chain Privacy Split</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Stored On-Chain (PropertyRegistry.sol)</th>
                        <th>Kept Private Off-Chain</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="mono">
                          <strong>Fingerprint:</strong> {property.fingerprint}
                        </td>
                        <td>Street address, unit, building &amp; exact GPS</td>
                      </tr>
                      <tr>
                        <td className="mono">
                          <strong>Latest Merkle Root:</strong>{' '}
                          {property.latestRecord ? property.latestRecord.merkleRoot : 'None yet'}
                        </td>
                        <td>Raw photo files (<code>backend/private_media/</code>)</td>
                      </tr>
                      <tr>
                        <td className="mono">
                          <strong>Metadata Hash:</strong>{' '}
                          {property.latestRecord ? property.latestRecord.metadataHash : 'None yet'}
                        </td>
                        <td>User accounts, emails, bookings &amp; pHashes</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="alert alert-info" style={{ marginTop: 14, marginBottom: 0 }}>
                  <strong>Honest Trust Boundary:</strong> The blockchain proves a specific photo
                  set was committed by the authorized verifier at a specific block timestamp and has
                  not been altered since. Browser camera/GPS spoofing before upload remains outside
                  on-chain guarantees.
                </div>
              </div>

              <div className="card">
                <h3>Append-Only On-Chain Verification History</h3>
                {property.records && property.records.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Index</th>
                          <th>Merkle Root</th>
                          <th>Tx Hash</th>
                          <th>Block</th>
                          <th>Sealed At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {property.records.map((rec) => (
                          <tr key={rec.id}>
                            <td>#{rec.recordIndex}</td>
                            <td className="mono">{rec.merkleRoot}</td>
                            <td className="mono">{rec.txHash}</td>
                            <td>{rec.blockNumber}</td>
                            <td>{new Date(rec.createdAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    No verification records committed on-chain yet.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Sticky Sidebar: Booking + Live Photo Authenticity Check */}
        <div className="sticky-sidebar">
          <div className="card">
            <div className="flex-between" style={{ marginBottom: 14 }}>
              <div className="price-tag" style={{ fontSize: '1.45rem' }}>
                ₹{property.price} <span>/ night</span>
              </div>
              <StatusBadge status={property.status} viewMode={viewMode} />
            </div>

            {!user ? (
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                <Link to="/login" style={{ fontWeight: 700, textDecoration: 'underline' }}>
                  Log in
                </Link>{' '}
                or{' '}
                <Link to="/register" style={{ fontWeight: 700, textDecoration: 'underline' }}>
                  sign up
                </Link>{' '}
                to reserve dates at this verified stay.
              </div>
            ) : isGuest ? (
              <form onSubmit={handleBooking} className="form-grid">
                <div className="form-row">
                  <div>
                    <label htmlFor="checkIn">Check-in</label>
                    <input
                      id="checkIn"
                      type="date"
                      required
                      value={checkIn}
                      onChange={(e) => setCheckIn(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="checkOut">Check-out</label>
                    <input
                      id="checkOut"
                      type="date"
                      required
                      value={checkOut}
                      onChange={(e) => setCheckOut(e.target.value)}
                    />
                  </div>
                </div>

                {nightsCount > 0 && (
                  <div
                    className="flex-between"
                    style={{
                      padding: '10px 12px',
                      background: 'var(--surface-soft)',
                      borderRadius: 10,
                      fontSize: '0.9rem',
                    }}
                  >
                    <span>
                      ₹{property.price} × {nightsCount} night{nightsCount > 1 ? 's' : ''}
                    </span>
                    <strong>₹{(property.price * nightsCount).toFixed(2)}</strong>
                  </div>
                )}

                <button type="submit" className="btn" disabled={bookingBusy}>
                  {bookingBusy ? 'Reserving...' : 'Reserve Stay'}
                </button>
              </form>
            ) : isHost ? (
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                You are logged in as a Host. Switch to a Traveler account to book stays.
              </div>
            ) : null}

            {bookingMsg && (
              <div className="alert alert-success" style={{ marginTop: 12, marginBottom: 0 }}>
                {bookingMsg}{' '}
                <Link to="/trips" style={{ fontWeight: 700, textDecoration: 'underline' }}>
                  View My Bookings
                </Link>
              </div>
            )}
            {bookingErr && (
              <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>
                {bookingErr}
              </div>
            )}
          </div>

          <ProofInspector
            records={property.records}
            viewMode={viewMode}
            onSwitchToDev={onSwitchToDev}
            onRunVerify={handleRunVerify}
          />
        </div>
      </div>
    </div>
  );
}
