import React from 'react';

const CUSTOMER_LABELS = {
  VERIFIED: '✓ Verified Fresh',
  DUE_SOON: 'Re-verification Due Soon',
  EXPIRED: 'Verification Expired',
  UNDER_REVIEW: 'Under Trust Review',
  REJECTED: 'Listing Rejected',
  PENDING: 'Awaiting Live Photos',
  MATCH: '✓ Authentic & Unaltered',
  TAMPERED: '⚠ Photo Mismatch Detected',
  EVIDENCE_INCOMPLETE: 'Incomplete Photo Evidence',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  PENDING_REVIEW: 'Pending Review',
  FAILED: 'Chain Tx Failed',
};

export default function StatusBadge({ status, viewMode = 'traveler' }) {
  const key = String(status || 'PENDING').toUpperCase();
  const normalized = key.toLowerCase();
  const label =
    viewMode === 'developer'
      ? key.replace(/_/g, ' ')
      : CUSTOMER_LABELS[key] || key.replace(/_/g, ' ');

  return <span className={`badge badge-${normalized}`}>{label}</span>;
}
