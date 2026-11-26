import React, { useState } from 'react';
import StatusBadge from './StatusBadge';

const ROOM_NAMES = {
  bathroom: 'Bathroom',
  bedroom: 'Bedroom',
  living_room: 'Living Room',
};

export default function ProofInspector({
  records = [],
  viewMode = 'traveler',
  onSwitchToDev,
  onRunVerify,
}) {
  const [selectedIndex, setSelectedIndex] = useState(
    records.length > 0 ? records[0].recordIndex : 0
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const runVerify = async (idxToCheck = selectedIndex) => {
    setLoading(true);
    setError('');
    try {
      const data = await onRunVerify(idxToCheck);
      setResult(data);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const boxClass =
    result?.status === 'MATCH'
      ? 'match'
      : result?.status === 'TAMPERED'
      ? 'tampered'
      : 'incomplete';

  const alteredRooms = (result?.perPhoto || [])
    .filter((p) => !p.shaMatch)
    .map((p) => ROOM_NAMES[p.viewLabel] || p.viewLabel);

  return (
    <div className="card">
      <div className="flex-between">
        <div>
          <h3 style={{ marginBottom: 4 }}>
            {viewMode === 'traveler' ? 'Photo Authenticity Guarantee' : 'Cryptographic Proof Inspector'}
          </h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
            {viewMode === 'traveler'
              ? 'Check instantly that these room photos have not been edited or swapped since verification.'
              : 'Recomputes SHA-256 & Merkle proofs from private disk files and calls PropertyRegistry.verifyPhoto() on-chain.'}
          </p>
        </div>
      </div>

      <div className="flex-gap" style={{ marginTop: 14 }}>
        {viewMode === 'developer' && records.length > 1 && (
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            style={{ width: 'auto' }}
          >
            {records.map((r) => (
              <option key={r.recordIndex} value={r.recordIndex}>
                Record #{r.recordIndex} (Block {r.blockNumber})
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="btn btn-trust"
          style={{ width: viewMode === 'traveler' ? '100%' : 'auto' }}
          disabled={loading || records.length === 0}
          onClick={() => runVerify(selectedIndex)}
        >
          {loading
            ? 'Checking Authenticity...'
            : viewMode === 'traveler'
            ? 'Verify Photos Are Authentic'
            : 'Verify On-Chain'}
        </button>
      </div>

      {records.length === 0 && (
        <div className="alert alert-info" style={{ marginTop: 14, marginBottom: 0 }}>
          {viewMode === 'traveler'
            ? 'This host has not completed live room photo verification yet.'
            : 'No on-chain verification records exist for this property yet.'}
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: 14, marginBottom: 0 }}>
          {error}
        </div>
      )}

      {result && viewMode === 'traveler' && (
        <div className={`certificate-box ${boxClass}`}>
          <div className="flex-between" style={{ marginBottom: 8 }}>
            <StatusBadge status={result.status} viewMode="traveler" />
            {result.onchainTimestamp && (
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                Sealed {new Date(result.onchainTimestamp * 1000).toLocaleDateString()}
              </span>
            )}
          </div>

          {result.status === 'MATCH' && (
            <p style={{ margin: '6px 0 0', fontSize: '0.92rem' }}>
              <strong>100% Authentic.</strong> All {result.perPhoto?.length || 3} live-captured room
              photos match the tamper-proof verification seal recorded at inspection time.
            </p>
          )}

          {result.status === 'TAMPERED' && (
            <p style={{ margin: '6px 0 0', fontSize: '0.92rem' }}>
              <strong>Warning:</strong>{' '}
              {alteredRooms.length > 0
                ? `The ${alteredRooms.join(', ')} photo differs from the verified original.`
                : 'One or more photos no longer match the verified seal.'}{' '}
              We recommend contacting StaySure support before booking.
            </p>
          )}

          {result.status === 'EVIDENCE_INCOMPLETE' && (
            <p style={{ margin: '6px 0 0', fontSize: '0.92rem' }}>
              <strong>Verification Incomplete:</strong> One or more verified photos are missing from
              storage and could not be audited.
            </p>
          )}

          {result.perPhoto && result.perPhoto.length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              {result.perPhoto.map((p) => (
                <div
                  key={p.viewLabel}
                  className="flex-between"
                  style={{
                    background: 'rgba(255,255,255,0.75)',
                    padding: '6px 10px',
                    borderRadius: 8,
                    fontSize: '0.85rem',
                  }}
                >
                  <span>{ROOM_NAMES[p.viewLabel] || p.viewLabel}</span>
                  <strong>
                    {p.shaMatch && p.onchainProofValid ? '✓ Unaltered' : '✗ Modified'}
                  </strong>
                </div>
              ))}
            </div>
          )}

          {onSwitchToDev && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onSwitchToDev}
              >
                Inspect Cryptographic Proofs (Developer Mode)
              </button>
            </div>
          )}
        </div>
      )}

      {result && viewMode === 'developer' && (
        <div className={`certificate-box ${boxClass}`}>
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <div className="flex-gap">
              <StatusBadge status={result.status} viewMode="developer" />
              <strong>{result.message}</strong>
            </div>
            <span className="mono">Record #{result.recordIndex}</span>
          </div>

          <div className="grid-2" style={{ marginTop: 10, gap: 12 }}>
            <div>
              <div className="muted">On-Chain Merkle Root (PropertyRegistry.sol)</div>
              <div className="mono">{result.onchainRoot || 'N/A'}</div>
            </div>
            <div>
              <div className="muted">Recomputed Merkle Root (Current Disk Files)</div>
              <div className="mono">{result.recomputedRoot || 'N/A (Missing files)'}</div>
            </div>
          </div>

          <div className="grid-3" style={{ marginTop: 10, gap: 12 }}>
            <div>
              <div className="muted">Tx Hash</div>
              <div className="mono">{result.txHash}</div>
            </div>
            <div>
              <div className="muted">Block Number</div>
              <div className="mono">{result.blockNumber}</div>
            </div>
            <div>
              <div className="muted">On-Chain Timestamp</div>
              <div className="mono">
                {result.onchainTimestamp
                  ? new Date(result.onchainTimestamp * 1000).toISOString()
                  : 'N/A'}
              </div>
            </div>
          </div>

          {result.perPhoto && result.perPhoto.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 14, background: '#fff', borderRadius: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>View</th>
                    <th>On-Chain Proof</th>
                    <th>Recorded vs. Current SHA-256</th>
                    <th>Merkle Leaf &amp; Sibling Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perPhoto.map((p) => {
                    const rowDamaged = !p.shaMatch || !p.onchainProofValid;
                    return (
                      <tr key={p.viewLabel} className={rowDamaged ? 'row-tampered' : ''}>
                        <td>
                          <strong>{p.viewLabel}</strong>
                          {!p.shaMatch && (
                            <div style={{ color: '#b91c1c', fontSize: '0.76rem', fontWeight: 700 }}>
                              BYTES ALTERED
                            </div>
                          )}
                        </td>
                        <td>
                          <StatusBadge
                            status={p.onchainProofValid ? 'MATCH' : 'TAMPERED'}
                            viewMode="developer"
                          />
                        </td>
                        <td className="mono">
                          <div>Recorded: {p.storedSha256}</div>
                          <div
                            style={{
                              color: p.shaMatch ? 'inherit' : '#b91c1c',
                              fontWeight: p.shaMatch ? 400 : 700,
                            }}
                          >
                            Current:&nbsp;&nbsp;{p.recomputedSha256}
                          </div>
                        </td>
                        <td className="mono">
                          <div>Leaf: {p.leaf}</div>
                          <div>
                            Proof ({p.proofLength}): {JSON.stringify(p.proof)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
