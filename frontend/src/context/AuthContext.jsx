import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  // Logged out because the account logged in on another device.
  useEffect(() => {
    const onReplaced = () => {
      try {
        sessionStorage.setItem('psq_replaced', '1');
      } catch {
        /* ignore */
      }
      setUser(null);
    };
    window.addEventListener('psq:replaced', onReplaced);
    return () => window.removeEventListener('psq:replaced', onReplaced);
  }, []);

  // Heartbeat: keeps "online" accurate for the examiner and notices a login elsewhere.
  useEffect(() => {
    if (!user || user.role !== 'participant') return undefined;
    const beat = () => api('/auth/ping', { method: 'POST', body: {} }).catch(() => {});
    const timer = setInterval(beat, 60 * 1000);
    return () => clearInterval(timer);
  }, [user]);

  const login = useCallback(async (username, password, force = false) => {
    const d = await api('/auth/login', { method: 'POST', body: { username, password, ...(force ? { force: true } : {}) } });
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setUser(null);
    }
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
