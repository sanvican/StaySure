import React from 'react';

const FRIENDLY_FACTORS = {
  'Latest photo verification': 'Recent live-camera room inspection',
  'Host identity verification': 'Government ID & host identity check',
  'Duplicate checks': 'Zero duplicate or stolen listing photos',
  'Verification history': 'Consistent multi-month verification history',
  'Host rating': 'Guest review score',
};

export default function TrustIndexCard({ trustIndex, viewMode = 'traveler' }) {
  if (!trustIndex) return null;

  const pct = Math.min(
    100,
    Math.max(0, Math.round((trustIndex.score / trustIndex.maxScore) * 100))
  );

  const tier =
    trustIndex.score >= 80
      ? 'High Confidence'
      : trustIndex.score >= 50
      ? 'Moderate Confidence'
      : 'Needs Attention';

  return (
    <div className="card">
      <div className="trust-score-row">
        <div>
          <h3 style={{ marginBottom: 4 }}>StaySure Trust Score</h3>
          <span className="muted">
            {viewMode === 'traveler' ? tier : 'Evidence-backed composite Trust Index'}
          </span>
        </div>
        <div className="trust-score-big">
          {trustIndex.score}
          <span style={{ fontSize: '1rem', color: 'var(--muted)' }}> / {trustIndex.maxScore}</span>
        </div>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Verification Check</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {trustIndex.breakdown.map((item) => {
              const title =
                viewMode === 'traveler'
                  ? FRIENDLY_FACTORS[item.factor] || item.factor
                  : item.factor;
              return (
                <tr key={item.factor}>
                  <td>
                    {title}
                    {item.note && (
                      <span className="muted">
                        {' '}
                        ({viewMode === 'traveler' ? 'Coming soon' : item.note})
                      </span>
                    )}
                  </td>
                  <td>
                    <strong>{item.points}</strong> / {item.max}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: '0.82rem' }}>
        {trustIndex.disclaimer}
      </p>
    </div>
  );
}
