import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorState } from './components/StateViews';
import { useAuth } from './context/AuthContext';
import { useGoogleAuth } from './context/GoogleAuthContext';
import { BookDetailPage } from './pages/BookDetailPage';
import { CatalogPage } from './pages/CatalogPage';
import { ChatPage } from './pages/ChatPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { GuidePage } from './pages/GuidePage';
import { LibrarianBooksPage } from './pages/LibrarianBooksPage';
import { LibrarianDeskPage } from './pages/LibrarianDeskPage';
import { LibrarianReportsPage } from './pages/LibrarianReportsPage';
import { LoginPage } from './pages/LoginPage';
import { MyLoansPage } from './pages/MyLoansPage';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const RequireLibrarian: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== 'librarian') {
    return (
      <ErrorState message="Từ chối truy cập (403): Màn hình quản trị này chỉ dành cho Thủ thư (TC03 / T07)." />
    );
  }
  return <>{children}</>;
};

export const App: React.FC = () => {
  const { session: googleSession } = useGoogleAuth();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ChatPage key={googleSession?.user?.id ?? 'guest'} />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/books/:id" element={<BookDetailPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/guide" element={<GuidePage />} />

        <Route
          path="/my-loans"
          element={
            <RequireAuth>
              <MyLoansPage />
            </RequireAuth>
          }
        />
        <Route
          path="/favorites"
          element={
            <RequireAuth>
              <FavoritesPage />
            </RequireAuth>
          }
        />

        <Route
          path="/librarian/desk"
          element={
            <RequireLibrarian>
              <LibrarianDeskPage />
            </RequireLibrarian>
          }
        />
        <Route
          path="/librarian/books"
          element={
            <RequireLibrarian>
              <LibrarianBooksPage />
            </RequireLibrarian>
          }
        />
        <Route
          path="/librarian/reports"
          element={
            <RequireLibrarian>
              <LibrarianReportsPage />
            </RequireLibrarian>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};
