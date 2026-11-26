import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function Navbar({ user, viewMode, onChangeViewMode, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    onLogout();
    navigate('/');
  };

  const isActive = (path) => (location.pathname === path ? 'nav-link active' : 'nav-link');

  const roleBadge = user
    ? user.role === 'HOST'
      ? 'Host'
      : user.role === 'ADMIN'
      ? 'Admin'
      : 'Traveler'
    : null;

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/" className="navbar-brand">
            <span className="brand-mark">S</span>
            <span>StaySure</span>
          </Link>

          <div className="navbar-links">
            {/* Unauthenticated & GUEST: Explore */}
            {(!user || user.role === 'GUEST') && (
              <Link to="/" className={isActive('/')}>
                Explore
              </Link>
            )}

            {/* GUEST only */}
            {user && user.role === 'GUEST' && (
              <Link to="/trips" className={isActive('/trips')}>
                My Bookings
              </Link>
            )}

            {/* HOST only */}
            {user && user.role === 'HOST' && (
              <>
                <Link to="/host" className={isActive('/host')}>
                  My Properties
                </Link>
                <Link to="/host/add" className={isActive('/host/add')}>
                  Add Property
                </Link>
                <Link to="/host/bookings" className={isActive('/host/bookings')}>
                  Property Bookings
                </Link>
              </>
            )}

            {/* ADMIN only */}
            {user && user.role === 'ADMIN' && (
              <>
                <Link to="/admin" className={isActive('/admin')}>
                  Review Queue
                </Link>
                <Link to="/" className={isActive('/')}>
                  All Listings
                </Link>
              </>
            )}

            {/* Mode switch — only show for ADMIN or on detail pages for anyone */}
            {(user && user.role === 'ADMIN') && (
              <div className="mode-switch" role="group" aria-label="Interface Mode">
                <button
                  type="button"
                  className={`mode-btn ${viewMode === 'traveler' ? 'active' : ''}`}
                  onClick={() => onChangeViewMode('traveler')}
                  title="Clean Airbnb-style traveler view"
                >
                  Traveler
                </button>
                <button
                  type="button"
                  className={`mode-btn dev ${viewMode === 'developer' ? 'active' : ''}`}
                  onClick={() => onChangeViewMode('developer')}
                  title="Show cryptographic Merkle proofs, hashes, and blockchain audit details"
                >
                  Developer / Auditor
                </button>
              </div>
            )}

            {user ? (
              <>
                <span className="user-pill">
                  {user.username}
                  {roleBadge && <span className="role-badge">{roleBadge}</span>}
                  {user.identityVerified ? ' ✓' : ''}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className={isActive('/login')}>
                  Log in
                </Link>
                <Link to="/register" className="btn btn-sm">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {viewMode === 'developer' && (
        <div className="dev-banner">
          <strong>Developer / Auditor Mode Active:</strong> Displaying HMAC property fingerprints,
          Merkle roots, SHA-256 digests, smart-contract transaction hashes, and on-chain proofs.
        </div>
      )}
    </>
  );
}
