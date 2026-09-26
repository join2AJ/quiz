export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
    this.code = (data && data.code) || '';
  }
}

export async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    keepalive,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    // This browser's session was ended by a login on another device.
    if (res.status === 401 && data && data.code === 'SESSION_REPLACED') window.dispatchEvent(new Event('psq:replaced'));
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
