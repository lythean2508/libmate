import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AISession } from '../types/ai';
import { aiRequest, getGoogleSession } from '../services/googleAI';

interface GoogleAuthValue {
  session: AISession | null;
  loading: boolean;
  error: string;
  login: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const GoogleAuthContext = createContext<GoogleAuthValue | null>(null);

export const GoogleAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AISession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setSession(await getGoogleSession()); setError(''); }
    catch { setSession(null); setError('Chưa kết nối được dịch vụ đăng nhập. Vui lòng tải lại trang hoặc thử lại.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const login = useCallback(async (credential: string) => {
    try {
      if (!session?.csrfToken) throw new Error('Phiên đăng nhập chưa sẵn sàng. Vui lòng thử lại.');
      const result = await aiRequest<AISession>('/api/ai/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Libmate-CSRF': session.csrfToken }, body: JSON.stringify({ credential }) });
      setSession(result); setError('');
    } catch (err) { const message = err instanceof Error ? err.message : 'Không đăng nhập được Google.'; setError(message); throw err; }
  }, [session?.csrfToken]);
  const logout = useCallback(async () => {
    if (!session?.csrfToken) return;
    try {
      setSession(await aiRequest<AISession>('/api/ai/session', { method: 'DELETE', headers: { 'X-Libmate-CSRF': session.csrfToken } }));
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa đăng xuất được.'); }
  }, [session?.csrfToken]);
  return <GoogleAuthContext.Provider value={{ session, loading, error, login, logout, refresh }}>{children}</GoogleAuthContext.Provider>;
};

export function useGoogleAuth() {
  const value = useContext(GoogleAuthContext);
  if (!value) throw new Error('GoogleAuthProvider is required');
  return value;
}
