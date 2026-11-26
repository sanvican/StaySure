import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function Listings({ viewMode = 'traveler' }) {
  const [properties, setProperties] = useState([]);
  const [query, setQuery] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('recommended');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProperties = async (opts = {}) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const qVal = opts.q !== undefined ? opts.q : query;
      const vVal = opts.verifiedOnly !== undefined ? opts.verifiedOnly : verifiedOnly;
      const pVal = opts.maxPrice !== undefined ? opts.maxPrice : maxPrice;
      const sVal = opts.sort !== undefined ? opts.sort : sort;

      if (qVal.trim()) params.set('q', qVal.trim());
      if (vVal) params.set('verifiedOnly', 'true');
      if (pVal && Number(pVal) > 0) params.set('maxPrice', pVal);
      if (sVal) params.set('sort', sVal);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await apiRequest(`/properties${qs}`);
      setProperties(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProperties();
  }, [verifiedOnly, sort]);

  const handleSearch = (e) => {
    e.preventDefault();
    loadProperties();
  };

  return (
    <div>
      <section className="hero-banner">
        <div className="hero-eyebrow">
          ✓ Live-Camera Verified Stays · Zero Bait-and-Switch
        </div>
        <h1>Book stays with photos you can actually trust.</h1>
        <p>
          Unlike traditional rental platforms where listings can use years-old or edited photos,
          every StaySure verified home is captured live on location and sealed against tampering.
        </p>

        <div className="trust-pillars">
          <div className="pillar-chip">
            <strong>Live On-Site Photos</strong>
            <span>Hosts capture living room, bedroom &amp; bath live with GPS verification.</span>
          </div>
          <div className="pillar-chip">
            <strong>Anti-Tamper Seal</strong>
            <span>Check anytime with one click that photos haven&apos;t been swapped or edited.</span>
          </div>
          <div className="pillar-chip">
            <strong>30-Day Freshness Guarantee</strong>
            <span>Stale listings expire automatically so old photos never look verified.</span>
          </div>
        </div>
      </section>

      <form onSubmit={handleSearch} className="search-bar-card">
        <input
          type="text"
          placeholder="Search city or listing name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />

        <input
          type="number"
          min="1"
          placeholder="Max $/night"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          style={{ width: 135 }}
        />

        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recommended">Recommended (Rating + Trust)</option>
          <option value="most_rated">Most Reviewed</option>
          <option value="trust">Highest Trust Score</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
        </select>

        <button
          type="button"
          className={`toggle-chip ${verifiedOnly ? 'active' : ''}`}
          onClick={() => setVerifiedOnly((v) => !v)}
        >
          <span>{verifiedOnly ? '✓' : '○'}</span>
          Verified Only
        </button>

        <button type="submit" className="btn">
          Search
        </button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p className="muted">Finding verified stays...</p>}

      {!loading && properties.length === 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 6 }}>No stays match your search</h3>
          <p className="muted" style={{ margin: 0 }}>
            Try clearing your filters or{' '}
            <Link to="/register" style={{ color: 'var(--brand)', fontWeight: 700 }}>
              become a verified host
            </Link>
            .
          </p>
        </div>
      )}

      <div className="listings-grid">
        {properties.map((prop) => {
          const hasPhotos = prop.verificationCount > 0;
          return (
            <Link to={`/properties/${prop.id}`} className="listing-card" key={prop.id}>
              <div className="listing-media">
                {hasPhotos ? (
                  <img
                    src={`/api/properties/${prop.id}/photos/living_room`}
                    alt={prop.name}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="listing-placeholder">
                    <span>Photos pending live camera verification</span>
                  </div>
                )}

                <div className="media-overlay-top">
                  <StatusBadge status={prop.status} viewMode={viewMode} />
                  {prop.trustIndex && (
                    <span className="trust-pill">
                      Trust {prop.trustIndex.score}/{prop.trustIndex.maxScore}
                    </span>
                  )}
                </div>
              </div>

              <div className="listing-body">
                <div className="listing-location">
                  {prop.city || `Area ${prop.approxLatitude}, ${prop.approxLongitude}`}
                </div>

                <h3 className="listing-title">{prop.name}</h3>

                <div className="listing-meta">
                  {prop.bedrooms} bed · {prop.bathrooms} bath · Up to {prop.maxGuests} guests
                </div>

                <div className="listing-meta">
                  Hosted by <strong>{prop.hostUsername || 'Host'}</strong>
                  {prop.hostIdentityVerified ? ' · ✓ ID Verified' : ''}
                </div>

                {/* Rating display */}
                {prop.averageRating > 0 && (
                  <div className="listing-rating">
                    <span className="rating-star">★</span> {prop.averageRating.toFixed(1)}
                    <span className="muted"> ({prop.ratingCount} review{prop.ratingCount !== 1 ? 's' : ''})</span>
                  </div>
                )}

                {viewMode === 'developer' && (
                  <div className="mono muted" style={{ fontSize: '0.73rem' }}>
                    FP: {prop.fingerprint.slice(0, 18)}...
                  </div>
                )}

                <div className="listing-footer">
                  <div className="price-tag">
                    ${prop.price} <span>/ night</span>
                  </div>
                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--brand)' }}>
                    View stay →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
