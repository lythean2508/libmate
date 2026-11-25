import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { AuthSession, LoanView, User } from '../types/library';
import { libraryStore } from '../services/libraryStore';

interface AuthContextValue {
  session: AuthSession | null;
  user: User | null;
  token: string | null;
  dueAlerts: LoanView[];
  favoriteIds: Set<string>;
  login: (readerCode: string, password: string) => void;
  logout: () => void;
  refreshUserAlerts: () => void;
  toggleFavoriteBook: (bookId: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(() => libraryStore.getCurrentSession());
  const [dueAlerts, setDueAlerts] = useState<LoanView[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  const refreshUserAlerts = useCallback(() => {
    const current = libraryStore.getCurrentSession();
    setSession(current);
    if (!current) {
      setDueAlerts([]);
      setFavoriteIds(new Set());
      return;
    }
    try {
      const { activeLoans } = libraryStore.getMyActivity(current.token);
      // Nhắc hạn trong ứng dụng (T32): quá hạn hoặc còn <= 3 ngày
      setDueAlerts(activeLoans.filter((l) => l.is_overdue || l.days_remaining <= 3));
      const favs = libraryStore.getMyFavorites(current.token);
      setFavoriteIds(new Set(favs.map((f) => f.id)));
    } catch {
      setDueAlerts([]);
      setFavoriteIds(new Set());
    }
  }, []);

  useEffect(() => {
    refreshUserAlerts();
  }, [refreshUserAlerts]);

  const login = useCallback((readerCode: string, password: string) => {
    const nextSession = libraryStore.login(readerCode, password);
    setSession(nextSession);
    const { activeLoans } = libraryStore.getMyActivity(nextSession.token);
    setDueAlerts(activeLoans.filter((l) => l.is_overdue || l.days_remaining <= 3));
    const favs = libraryStore.getMyFavorites(nextSession.token);
    setFavoriteIds(new Set(favs.map((f) => f.id)));
  }, []);

  const logout = useCallback(() => {
    libraryStore.logout(session?.token);
    setSession(null);
    setDueAlerts([]);
    setFavoriteIds(new Set());
  }, [session?.token]);

  const toggleFavoriteBook = useCallback(
    (bookId: string) => {
      if (!session?.token) {
        throw new Error('Vui lòng đăng nhập để lưu sách yêu thích.');
      }
      const res = libraryStore.toggleFavorite(session.token, bookId);
      refreshUserAlerts();
      return res.favorited;
    },
    [session?.token, refreshUserAlerts]
  );

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        token: session?.token ?? null,
        dueAlerts,
        favoriteIds,
        login,
        logout,
        refreshUserAlerts,
        toggleFavoriteBook,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
