import React, { useState } from 'react';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import {
  clearAuthSession,
  getStoredUser,
  getStoredViewMode,
  setAuthSession,
  setStoredViewMode,
} from './api/client';
import Navbar from './components/Navbar';
import ProtectedRoute, { PublicOnlyRoute } from './components/ProtectedRoute';
import Listings from './pages/Listings';
import PropertyDetail from './pages/PropertyDetail';
import MyTrips from './pages/MyTrips';
import HostDashboard from './pages/HostDashboard';
import HostBookings from './pages/HostBookings';
import CapturePage from './pages/CapturePage';
import AdminQueue from './pages/AdminQueue';
import Login from './pages/Login';
import Register from './pages/Register';

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [viewMode, setViewMode] = useState(() => getStoredViewMode());

  const handleAuthSuccess = (token, nextUser) => {
    setAuthSession(token, nextUser);
    setUser(nextUser);
  };

  const handleLogout = () => {
    clearAuthSession();
    setUser(null);
  };

  const handleChangeViewMode = (mode) => {
    setStoredViewMode(mode);
    setViewMode(mode);
  };

  return (
    <BrowserRouter>
      <Navbar
        user={user}
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        onLogout={handleLogout}
      />
      <main className="container">
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Listings viewMode={viewMode} />} />
          <Route
            path="/properties/:id"
            element={
              <PropertyDetail
                user={user}
                viewMode={viewMode}
                onSwitchToDev={() => handleChangeViewMode('developer')}
              />
            }
          />

          {/* Guest/Traveler only */}
          <Route
            path="/trips"
            element={
              <ProtectedRoute allowedRoles={['GUEST']}>
                <MyTrips user={user} viewMode={viewMode} />
              </ProtectedRoute>
            }
          />

          {/* Host only */}
          <Route
            path="/host"
            element={
              <ProtectedRoute allowedRoles={['HOST']}>
                <HostDashboard user={user} viewMode={viewMode} initialTab="listings" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/host/add"
            element={
              <ProtectedRoute allowedRoles={['HOST']}>
                <HostDashboard user={user} viewMode={viewMode} initialTab="add" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/host/bookings"
            element={
              <ProtectedRoute allowedRoles={['HOST']}>
                <HostBookings user={user} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/properties/:id/capture"
            element={
              <ProtectedRoute allowedRoles={['HOST']}>
                <CapturePage user={user} viewMode={viewMode} />
              </ProtectedRoute>
            }
          />

          {/* Admin only */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminQueue user={user} viewMode={viewMode} />
              </ProtectedRoute>
            }
          />

          {/* Auth routes — only for unauthenticated users */}
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login viewMode={viewMode} onAuthSuccess={handleAuthSuccess} />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <Register onAuthSuccess={handleAuthSuccess} />
              </PublicOnlyRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
