import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import StatusBadge from '../components/StatusBadge';

const AMENITY_OPTIONS = ['Fast Wi-Fi', 'Full Kitchen', 'Workspace', 'Washer', 'AC', 'Self Check-in'];

export default function HostDashboard({ user, viewMode = 'traveler', initialTab }) {
  const [properties, setProperties] = useState([]);
  const [activeTab, setActiveTab] = useState(initialTab || 'listings'); // 'listings' | 'add' | 'verifications'

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formMsg, setFormMsg] = useState('');
  const [formErr, setFormErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    city: '',
    description: '',
    bedrooms: '1',
    bathrooms: '1',
    maxGuests: '2',
    amenities: ['Fast Wi-Fi', 'Full Kitchen'],
    address: '',
    unitNumber: '',
    building: '',
    latitude: '37.7749',
    longitude: '-122.4194',
    price: '145',
  });

  const loadMine = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/host/properties');
      setProperties(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && user.role === 'HOST') {
      loadMine();
    } else {
      setLoading(false);
    }
  }, [user]);

  const toggleAmenity = (item) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(item)
        ? prev.amenities.filter((a) => a !== item)
        : [...prev.amenities, item],
    }));
  };

  const useBrowserGps = () => {
    if (!navigator.geolocation) {
      setFormErr('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((prev) => ({
          ...prev,
          latitude: String(pos.coords.latitude.toFixed(6)),
          longitude: String(pos.coords.longitude.toFixed(6)),
        }));
      },
      (err) => {
        setFormErr(`Could not read GPS: ${err.message}`);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setFormMsg('');
    setFormErr('');
    setSubmitting(true);
    try {
      const created = await apiRequest('/properties', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          bedrooms: Number(form.bedrooms),
          bathrooms: Number(form.bathrooms),
          maxGuests: Number(form.maxGuests),
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          price: Number(form.price),
        }),
      });
      setFormMsg(
        viewMode === 'developer'
          ? `Registered "${created.name}" (${created.status}). Fingerprint: ${created.fingerprint}${
              created.registerTx ? ` | Tx: ${created.registerTx}` : ''
            }`
          : `"${created.name}" is registered! Open "Live Camera & Geotag" to upload monthly room photos.`
      );
      setForm((prev) => ({
        ...prev,
        name: '',
        description: '',
        address: '',
        unitNumber: '',
        building: '',
      }));
      await loadMine();
      setActiveTab('listings');
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user || user.role !== 'HOST') {
    return (
      <div className="alert alert-warning">
        Host login required to access the Host Portal.
      </div>
    );
  }

  const verifiedCount = properties.filter((p) => p.status === 'VERIFIED').length;
  const dueOrExpiredCount = properties.filter(
    (p) => p.status === 'DUE_SOON' || p.status === 'EXPIRED' || p.status === 'PENDING'
  ).length;
  const reviewCount = properties.filter((p) => p.status === 'UNDER_REVIEW').length;
  const allSubmissions = properties.flatMap((p) =>
    (p.submissions || []).map((s) => ({ ...s, propertyName: p.name, propertyId: p.id }))
  );

  return (
    <div>
      {/* Separate Host Portal Header */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#ffffff',
          border: 'none',
        }}
      >
        <div className="flex-between">
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase' }}>
              Host Verification Portal
            </div>
            <h1 style={{ margin: '4px 0 6px', color: '#ffffff' }}>
              Manage Properties &amp; Monthly Live Photos
            </h1>
            <p style={{ margin: 0, color: '#cbd5e1', maxWidth: 700 }}>
              Every property must upload fresh, geotagged room photos every 30 days using the
              in-app live camera. Duplicate properties and reused photos are blocked on-chain.
            </p>
          </div>

          <button type="button" className="btn" onClick={() => setActiveTab('add')}>
            + Add New Property
          </button>
        </div>

        <div className="grid-3" style={{ marginTop: 20 }}>
          <div style={{ background: 'rgba(255,255,255,0.08)', padding: 14, borderRadius: 12 }}>
            <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>Total Properties</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{properties.length}</div>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.18)', padding: 14, borderRadius: 12 }}>
            <div style={{ fontSize: '0.8rem', color: '#a7f3d0' }}>Verified Fresh (Active)</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{verifiedCount}</div>
          </div>
          <div style={{ background: 'rgba(245,158,11,0.18)', padding: 14, borderRadius: 12 }}>
            <div style={{ fontSize: '0.8rem', color: '#fde68a' }}>Needs Monthly Photo Update</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>
              {dueOrExpiredCount}
              {reviewCount > 0 ? ` (${reviewCount} in review)` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Host Portal Navigation Tabs */}
      <div className="flex-gap" style={{ marginBottom: 18 }}>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'listings' ? 'btn-navy' : 'btn-secondary'}`}
          onClick={() => setActiveTab('listings')}
        >
          My Properties ({properties.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'verifications' ? 'btn-navy' : 'btn-secondary'}`}
          onClick={() => setActiveTab('verifications')}
        >
          Backend Verification &amp; Geotag Log ({allSubmissions.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === 'add' ? 'btn-navy' : 'btn-secondary'}`}
          onClick={() => setActiveTab('add')}
        >
          + Register New Property
        </button>
      </div>

      {formMsg && <div className="alert alert-success">{formMsg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* TAB 1: My Properties & Monthly Freshness */}
      {activeTab === 'listings' && (
        <div>
          {loading && <p className="muted">Loading your properties...</p>}
          {!loading && properties.length === 0 && (
            <div className="card">
              <h3>No properties registered yet</h3>
              <p className="muted">
                Register your first stay and complete a geotagged live camera verification to go
                live.
              </p>
              <button type="button" className="btn" onClick={() => setActiveTab('add')}>
                + Register Property
              </button>
            </div>
          )}

          {properties.map((prop) => {
            const needsMonthlyUpdate =
              prop.status === 'EXPIRED' || prop.status === 'DUE_SOON' || prop.status === 'PENDING';
            return (
              <div className="card" key={prop.id}>
                <div className="flex-between" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    {prop.verificationCount > 0 ? (
                      <img
                        src={`/api/properties/${prop.id}/photos/living_room`}
                        alt={prop.name}
                        style={{
                          width: 112,
                          height: 84,
                          objectFit: 'cover',
                          borderRadius: 12,
                          border: '1px solid var(--border)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 112,
                          height: 84,
                          borderRadius: 12,
                          background: 'var(--surface-soft)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          color: 'var(--muted)',
                          textAlign: 'center',
                          padding: 6,
                        }}
                      >
                        No photos yet
                      </div>
                    )}

                    <div>
                      <div className="flex-gap" style={{ marginBottom: 6 }}>
                        <StatusBadge status={prop.status} viewMode={viewMode} />
                        <strong style={{ fontSize: '1.08rem' }}>{prop.name}</strong>
                        <span className="muted">${prop.price}/night</span>
                      </div>

                      <div className="muted">
                        {prop.address}
                        {prop.unitNumber ? `, ${prop.unitNumber}` : ''}
                        {prop.building ? ` (${prop.building})` : ''} · Geotag Anchor:{' '}
                        {prop.latitude.toFixed(4)}, {prop.longitude.toFixed(4)}
                      </div>

                      <div style={{ marginTop: 6, fontSize: '0.86rem' }}>
                        {prop.status === 'EXPIRED' && (
                          <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                            ⚠ Monthly photo seal expired — capture fresh photos now to restore
                            Verified status.
                          </span>
                        )}
                        {prop.status === 'DUE_SOON' && (
                          <span style={{ color: 'var(--amber)', fontWeight: 700 }}>
                            ⏱ Monthly update due in {prop.daysUntilExpiry} day(s).
                          </span>
                        )}
                        {prop.status === 'VERIFIED' && prop.daysUntilExpiry !== null && (
                          <span style={{ color: 'var(--trust)', fontWeight: 600 }}>
                            ✓ Freshness valid for {prop.daysUntilExpiry} more day(s) (30-day
                            monthly cycle).
                          </span>
                        )}
                        {prop.status === 'PENDING' && (
                          <span className="muted">
                            Capture 3 geotagged room photos to activate your Verified seal.
                          </span>
                        )}
                      </div>

                      {viewMode === 'developer' && (
                        <div className="mono muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                          Fingerprint: {prop.fingerprint}
                          {prop.registerTx && <> | Register Tx: {prop.registerTx}</>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-gap">
                    <Link
                      to={`/properties/${prop.id}/capture`}
                      className={`btn btn-sm ${needsMonthlyUpdate ? '' : 'btn-trust'}`}
                    >
                      {needsMonthlyUpdate ? 'Update Monthly Photos (Camera)' : 'Capture New Photos'}
                    </Link>
                    <Link to={`/properties/${prop.id}`} className="btn btn-secondary btn-sm">
                      View Guest Page
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: Backend Verification & Geotag Log */}
      {activeTab === 'verifications' && (
        <div className="card">
          <h2>Backend Verification &amp; Geotag Log</h2>
          <p className="muted">
            Shows every live photo upload&apos;s backend checks: Geotag coordinates, duplicate-photo
            screening, and blockchain Merkle seal status.
          </p>

          {allSubmissions.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No photo verifications submitted yet.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Captured At</th>
                    <th>Geotag (Lat, Lon)</th>
                    <th>Anti-Duplicate Check</th>
                    <th>Backend &amp; Chain Status</th>
                    {viewMode === 'developer' && <th>Merkle Root &amp; Tx</th>}
                  </tr>
                </thead>
                <tbody>
                  {allSubmissions.map((sub) => {
                    const ph = sub.photos && sub.photos[0];
                    return (
                      <tr key={sub.id}>
                        <td>
                          <strong>{sub.propertyName}</strong>
                        </td>
                        <td>{new Date(sub.createdAt).toLocaleString()}</td>
                        <td className="mono">
                          {ph
                            ? `${ph.latitude.toFixed(5)}, ${ph.longitude.toFixed(5)}`
                            : 'N/A'}
                        </td>
                        <td>
                          {sub.similarFlag ? (
                            <span style={{ color: 'var(--amber)', fontWeight: 700 }}>
                              Flagged for Admin Review
                            </span>
                          ) : (
                            <span style={{ color: 'var(--trust)', fontWeight: 700 }}>
                              ✓ Unique Photos
                            </span>
                          )}
                          {sub.failureReason && (
                            <div className="muted" style={{ fontSize: '0.78rem' }}>
                              {sub.failureReason}
                            </div>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={sub.processingState} viewMode={viewMode} />
                        </td>
                        {viewMode === 'developer' && (
                          <td className="mono">
                            {sub.verificationRecord ? (
                              <>
                                Root: {sub.verificationRecord.merkleRoot.slice(0, 18)}...
                                <br />
                                Tx: {sub.verificationRecord.txHash.slice(0, 18)}... (Block{' '}
                                {sub.verificationRecord.blockNumber})
                              </>
                            ) : (
                              'Not sealed yet'
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Add New Property */}
      {activeTab === 'add' && (
        <div className="card">
          <h2>Register New Property</h2>
          <p className="muted">
            Duplicate properties (same address/unit across any host account) are blocked using a
            privacy-preserving blockchain fingerprint.
          </p>

          <form onSubmit={handleRegister} className="form-grid">
            <div className="form-row">
              <div>
                <label htmlFor="prop-name">Listing Title</label>
                <input
                  id="prop-name"
                  required
                  placeholder="Sunlit Mission Loft"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-city">City / Neighborhood</label>
                <input
                  id="prop-city"
                  placeholder="San Francisco, CA"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-price">Nightly Rate ($)</label>
                <input
                  id="prop-price"
                  type="number"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label htmlFor="prop-desc">Description</label>
              <textarea
                id="prop-desc"
                rows={2}
                placeholder="Describe the space, natural light, neighborhood, and house highlights..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="form-row">
              <div>
                <label htmlFor="prop-beds">Bedrooms</label>
                <input
                  id="prop-beds"
                  type="number"
                  min="1"
                  value={form.bedrooms}
                  onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-baths">Bathrooms</label>
                <input
                  id="prop-baths"
                  type="number"
                  min="1"
                  value={form.bathrooms}
                  onChange={(e) => setForm({ ...form, bathrooms: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-guests">Max Guests</label>
                <input
                  id="prop-guests"
                  type="number"
                  min="1"
                  value={form.maxGuests}
                  onChange={(e) => setForm({ ...form, maxGuests: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label>Amenities</label>
              <div className="amenities-list">
                {AMENITY_OPTIONS.map((item) => {
                  const selected = form.amenities.includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`toggle-chip ${selected ? 'active' : ''}`}
                      onClick={() => toggleAmenity(item)}
                    >
                      {selected ? '✓ ' : '+ '}
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-row">
              <div>
                <label htmlFor="prop-addr">Street Address (Private)</label>
                <input
                  id="prop-addr"
                  required
                  placeholder="12 Elm St"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-unit">Unit / Apt</label>
                <input
                  id="prop-unit"
                  placeholder="Flat 4-B"
                  value={form.unitNumber}
                  onChange={(e) => setForm({ ...form, unitNumber: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-building">Building</label>
                <input
                  id="prop-building"
                  placeholder="North Wing"
                  value={form.building}
                  onChange={(e) => setForm({ ...form, building: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row" style={{ alignItems: 'end' }}>
              <div>
                <label htmlFor="prop-lat">Property Latitude (Geotag Anchor)</label>
                <input
                  id="prop-lat"
                  type="number"
                  step="any"
                  required
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="prop-lon">Property Longitude (Geotag Anchor)</label>
                <input
                  id="prop-lon"
                  type="number"
                  step="any"
                  required
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                />
              </div>
              <div>
                <button type="button" className="btn btn-secondary" onClick={useBrowserGps}>
                  Use Current GPS
                </button>
              </div>
            </div>

            <div>
              <button type="submit" className="btn" disabled={submitting}>
                {submitting ? 'Registering On-Chain...' : 'Register Property'}
              </button>
            </div>
          </form>

          {formErr && (
            <div className="alert alert-error" style={{ marginTop: 14, marginBottom: 0 }}>
              {formErr}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
