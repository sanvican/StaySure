import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';

const REQUIRED_VIEWS = ['living_room', 'bedroom', 'bathroom'];
const ROOM_LABELS = {
  living_room: 'Living Room',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
};

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function CapturePage({ user, viewMode = 'traveler' }) {
  const { id } = useParams();
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [session, setSession] = useState(null);
  const [coords, setCoords] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('Waiting to start');
  const [cameraActive, setCameraActive] = useState(false);
  const [captures, setCaptures] = useState({});
  const [activeView, setActiveView] = useState('living_room');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const liveDistanceMeters =
    session && coords && session.propertyLatitude !== undefined
      ? Number(
          haversineMeters(
            session.propertyLatitude,
            session.propertyLongitude,
            coords.latitude,
            coords.longitude
          ).toFixed(1)
        )
      : null;

  const startSessionAndCamera = async () => {
    setError('');
    setResult(null);
    try {
      const sess = await apiRequest(`/properties/${id}/capture-session`, {
        method: 'POST',
      });
      setSession(sess);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser camera API (getUserMedia) is unavailable.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);

      if (navigator.geolocation) {
        setGpsStatus('Acquiring live GPS geotag...');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setCoords({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
            setGpsStatus('Geotag locked');
          },
          (geoErr) => {
            setGpsStatus(`Location error: ${geoErr.message}`);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        setGpsStatus('Geolocation unavailable in this browser.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const takeSnapshot = (viewLabel) => {
    if (!videoRef.current || !cameraActive) {
      setError('Start the live camera first.');
      return;
    }
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Failed to capture image from camera.');
          return;
        }
        const previewUrl = URL.createObjectURL(blob);
        const capturedAt = new Date().toLocaleTimeString();
        setCaptures((prev) => ({
          ...prev,
          [viewLabel]: {
            blob,
            previewUrl,
            capturedAt,
            geotag: coords ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` : null,
          },
        }));

        const nextMissing = REQUIRED_VIEWS.find((v) => v !== viewLabel && !captures[v]);
        if (nextMissing) setActiveView(nextMissing);
      },
      'image/jpeg',
      0.92
    );
  };

  const handleSubmit = async () => {
    if (!session) {
      setError('No active capture session.');
      return;
    }
    if (!coords) {
      setError('Live GPS geotag is required before uploading.');
      return;
    }
    for (const view of REQUIRED_VIEWS) {
      if (!captures[view]) {
        setError(`Missing snapshot for ${ROOM_LABELS[view]}.`);
        return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('session_id', session.id);
      formData.append('nonce', session.nonce);
      formData.append('latitude', String(coords.latitude));
      formData.append('longitude', String(coords.longitude));
      for (const view of REQUIRED_VIEWS) {
        formData.append(view, captures[view].blob, `${view}.jpg`);
      }

      const data = await apiRequest(`/properties/${id}/upload-photo`, {
        method: 'POST',
        body: formData,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user || (user.role !== 'HOST' && user.role !== 'ADMIN')) {
    return <div className="alert alert-warning">Host login required.</div>;
  }

  const capturedCount = REQUIRED_VIEWS.filter((v) => Boolean(captures[v])).length;
  const allCaptured = capturedCount === REQUIRED_VIEWS.length;

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Live Camera &amp; Geotag Verification</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Take 3 live room photos ({capturedCount}/3 ready). File uploads are disabled—every
            photo is geotagged and anchored on-chain for 30 days.
          </p>
        </div>
        <Link to="/host" className="btn btn-secondary btn-sm">
          ← Back to Host Portal
        </Link>
      </div>

      <div className="card">
        {!session ? (
          <button type="button" className="btn btn-trust" onClick={startSessionAndCamera}>
            Open In-App Camera &amp; Lock GPS Geotag
          </button>
        ) : (
          <div className="alert alert-info">
            <div className="flex-between">
              <div>
                <strong>Session Active</strong> · Expires{' '}
                {new Date(session.expiresAt).toLocaleTimeString()} · <strong>GPS:</strong>{' '}
                {coords
                  ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
                  : gpsStatus}
              </div>
              {liveDistanceMeters !== null && (
                <strong>
                  {liveDistanceMeters <= (session.maxRadiusMeters || 100)
                    ? `✓ ${liveDistanceMeters}m from property (within ${session.maxRadiusMeters || 100}m)`
                    : `⚠ ${liveDistanceMeters}m from property (max ${session.maxRadiusMeters || 100}m)`}
                </strong>
              )}
            </div>
            {viewMode === 'developer' && (
              <div className="mono" style={{ marginTop: 6 }}>
                Session ID: {session.id} | Nonce: {session.nonce}
              </div>
            )}
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div>
            <video ref={videoRef} autoPlay playsInline muted className="video-preview" />
            <div className="flex-gap" style={{ marginTop: 12 }}>
              <select
                value={activeView}
                onChange={(e) => setActiveView(e.target.value)}
                style={{ width: 'auto' }}
              >
                {REQUIRED_VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {ROOM_LABELS[v]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={!cameraActive}
                onClick={() => takeSnapshot(activeView)}
              >
                Capture {ROOM_LABELS[activeView]}
              </button>
            </div>
          </div>

          <div>
            <h3 style={{ marginTop: 0 }}>Geotagged Room Checklist ({capturedCount} / 3)</h3>
            <div className="photo-grid">
              {REQUIRED_VIEWS.map((view) => (
                <div className="photo-card" key={view}>
                  {captures[view] ? (
                    <img src={captures[view].previewUrl} alt={ROOM_LABELS[view]} />
                  ) : (
                    <div
                      style={{
                        height: 150,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--muted)',
                        fontSize: '0.85rem',
                      }}
                    >
                      Awaiting live photo
                    </div>
                  )}
                  <div className="photo-card-body">
                    <div className="flex-between">
                      <strong>{ROOM_LABELS[view]}</strong>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!cameraActive}
                        onClick={() => takeSnapshot(view)}
                      >
                        {captures[view] ? 'Retake' : 'Snap'}
                      </button>
                    </div>
                    {captures[view] && (
                      <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                        📍 {captures[view].geotag || 'GPS pending'} · {captures[view].capturedAt}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-trust"
              style={{ width: '100%', marginTop: 16 }}
              disabled={!allCaptured || !coords || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Verifying & Sealing On-Chain...' : 'Upload, Geotag & Verify On-Chain'}
            </button>
          </div>
        </div>

        {/* Backend Verification Pipeline Result */}
        {result && (
          <div className="card" style={{ marginTop: 18, marginBottom: 0, background: '#f8fafc' }}>
            <h3 style={{ marginBottom: 10 }}>Backend Verification Pipeline Result</h3>
            <div className="grid-2" style={{ gap: 10 }}>
              <div className="alert alert-success" style={{ marginBottom: 0 }}>
                <strong>1. Live Camera &amp; Nonce:</strong> ✓ Verified single-use session
              </div>
              <div className="alert alert-success" style={{ marginBottom: 0 }}>
                <strong>2. Geotag Check:</strong> ✓ {result.geotag?.distanceMeters ?? 0}m from
                property (limit {result.geotag?.maxRadiusMeters ?? 100}m)
              </div>
              <div
                className={`alert ${result.similarFlag ? 'alert-warning' : 'alert-success'}`}
                style={{ marginBottom: 0 }}
              >
                <strong>3. Anti-Duplicate Photo Screen:</strong>{' '}
                {result.similarFlag
                  ? '⚠ Similar photo flagged for Trust Review'
                  : '✓ Unique photos (SHA-256 & pHash passed)'}
              </div>
              <div
                className={`alert ${
                  result.processingState === 'CONFIRMED' ? 'alert-success' : 'alert-warning'
                }`}
                style={{ marginBottom: 0 }}
              >
                <strong>4. Blockchain Seal:</strong>{' '}
                {result.processingState === 'CONFIRMED'
                  ? `✓ Sealed on-chain (${result.propertyStatus})`
                  : `Status: ${result.processingState} (${result.propertyStatus})`}
              </div>
            </div>

            {viewMode === 'developer' && result.txHash && (
              <div className="mono" style={{ marginTop: 12 }}>
                TxHash: {result.txHash}
                {result.verificationRecord && (
                  <>
                    <br />
                    Block: {result.verificationRecord.blockNumber} | Merkle Root:{' '}
                    {result.verificationRecord.merkleRoot}
                  </>
                )}
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <Link to={`/properties/${id}`} className="btn btn-navy btn-sm">
                View Verified Listing
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
