import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, fetchAuthorizedBlobUrl } from '../api/client';
import StatusBadge from '../components/StatusBadge';

function AdminPhotoThumb({ submissionId, viewLabel }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let active = true;
    let createdUrl = '';
    fetchAuthorizedBlobUrl(`/admin/submissions/${submissionId}/photos/${viewLabel}`).then((u) => {
      if (active && u) {
        createdUrl = u;
        setUrl(u);
      }
    });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [submissionId, viewLabel]);

  if (!url) return null;
  return (
    <img
      src={url}
      alt={viewLabel}
      style={{
        width: 72,
        height: 54,
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid var(--border)',
      }}
    />
  );
}

export default function AdminQueue({ user, viewMode = 'traveler' }) {
  const [submissions, setSubmissions] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadQueue = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/admin/submissions');
      setSubmissions(data.submissions || []);
      setHosts(data.hosts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && user.role === 'ADMIN') {
      loadQueue();
    } else {
      setLoading(false);
    }
  }, [user]);

  const handleAction = async (submissionId, action) => {
    setError('');
    setNotice('');
    try {
      const updated = await apiRequest(`/admin/submissions/${submissionId}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? JSON.stringify({ reason: 'Rejected in Trust Review' }) : undefined,
      });
      setNotice(
        `Submission updated to ${updated.processingState}${
          viewMode === 'developer' && updated.txHash ? ` (Tx: ${updated.txHash})` : ''
        }`
      );
      await loadQueue();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleHostIdentity = async (hostId, currentVal) => {
    setError('');
    setNotice('');
    try {
      const updated = await apiRequest(`/admin/users/${hostId}/identity`, {
        method: 'PATCH',
        body: JSON.stringify({ identityVerified: !currentVal }),
      });
      setNotice(
        `Host "${updated.username}" ID verification set to ${
          updated.identityVerified ? 'Verified' : 'Unverified'
        }.`
      );
      await loadQueue();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="alert alert-warning">
        Admin login required to access Backend Verification &amp; Trust Operations.
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 6 }}>Backend Verification &amp; Trust Console</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
        Inspect geotag checks, flagged duplicate photos, blockchain seals, and host identity status.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      {loading && <p className="muted">Loading verification queue...</p>}

      <div className="card">
        <h2>Photo Verification &amp; Geotag Queue</h2>
        {submissions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No submissions found.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Captured Photos</th>
                  <th>Geotag Check</th>
                  <th>State</th>
                  <th>Anti-Duplicate Notes</th>
                  {viewMode === 'developer' && <th>Tx Hash</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub.id}>
                    <td>
                      <Link to={`/properties/${sub.propertyId}`}>
                        <strong>{sub.property?.name || sub.propertyId}</strong>
                      </Link>
                      <div className="muted">
                        Host: {sub.property?.host?.username || 'unknown'}
                      </div>
                    </td>
                    <td>
                      <div className="flex-gap">
                        {(sub.photos || []).map((ph) => (
                          <AdminPhotoThumb
                            key={ph.id}
                            submissionId={sub.id}
                            viewLabel={ph.viewLabel}
                          />
                        ))}
                      </div>
                    </td>
                    <td>
                      {sub.distanceMeters !== null ? (
                        <div>
                          <strong>{sub.distanceMeters}m</strong> from property
                          <div className="muted" style={{ fontSize: '0.76rem' }}>
                            {sub.photos?.[0]?.latitude?.toFixed(4)},{' '}
                            {sub.photos?.[0]?.longitude?.toFixed(4)}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <StatusBadge status={sub.processingState} viewMode={viewMode} />
                    </td>
                    <td>
                      {sub.similarFlag ? 'Similar Photo Flag' : 'Unique (Passed)'}
                      {sub.failureReason && (
                        <div className="muted" style={{ marginTop: 4 }}>
                          {sub.failureReason}
                        </div>
                      )}
                    </td>
                    {viewMode === 'developer' && (
                      <td className="mono">{sub.txHash || '—'}</td>
                    )}
                    <td>
                      <div className="flex-gap">
                        {sub.processingState === 'PENDING_REVIEW' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-trust btn-sm"
                              onClick={() => handleAction(sub.id, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleAction(sub.id, 'reject')}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {(sub.processingState === 'FAILED' ||
                          sub.processingState === 'APPROVED' ||
                          sub.processingState === 'CHAIN_SUBMITTED') && (
                          <button
                            type="button"
                            className="btn btn-navy btn-sm"
                            onClick={() => handleAction(sub.id, 'retry')}
                          >
                            Retry Seal
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Host Identity Verification</h2>
        <p className="muted">
          Verified hosts earn +25 points on their listing&apos;s StaySure Trust Score.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Host</th>
                <th>Role</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.username}</strong>
                    <div className="muted">{h.email}</div>
                  </td>
                  <td>{h.role}</td>
                  <td>
                    <StatusBadge
                      status={h.identityVerified ? 'VERIFIED' : 'PENDING'}
                      viewMode={viewMode}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => toggleHostIdentity(h.id, h.identityVerified)}
                    >
                      {h.identityVerified ? 'Revoke ID Check' : 'Verify Host ID'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
