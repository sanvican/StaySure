const API_BASE = '/api';

export function getToken() {
  return localStorage.getItem('staysure_token');
}

export function getStoredUser() {
  const raw = localStorage.getItem('staysure_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setAuthSession(token, user) {
  localStorage.setItem('staysure_token', token);
  localStorage.setItem('staysure_user', JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem('staysure_token');
  localStorage.removeItem('staysure_user');
}

export function getStoredViewMode() {
  const saved = localStorage.getItem('staysure_view_mode');
  return saved === 'developer' ? 'developer' : 'traveler';
}

export function setStoredViewMode(mode) {
  localStorage.setItem('staysure_view_mode', mode === 'developer' ? 'developer' : 'traveler');
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && (data.detail || data.message)) ||
      (typeof data === 'string' && data) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export async function fetchAuthorizedBlobUrl(path) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
