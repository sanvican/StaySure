import React from 'react';
import { Navigate } from 'react-router-dom';
import { getStoredUser } from '../api/client';

function getRoleHome(role) {
  if (role === 'HOST') return '/host';
  if (role === 'ADMIN') return '/admin';
  return '/';
}

export default function ProtectedRoute({ allowedRoles, children }) {
  const user = getStoredUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleHome(user.role)} replace />;
  }

  return children;
}

export function PublicOnlyRoute({ children }) {
  const user = getStoredUser();
  if (user) {
    return <Navigate to={getRoleHome(user.role)} replace />;
  }
  return children;
}
