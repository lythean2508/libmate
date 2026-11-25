import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AvailabilityBadge, EmptyState } from '../components/StateViews';
import { useAuth } from '../context/AuthContext';
import { libraryStore } from '../services/libraryStore';

export const FavoritesPage: React.FC = () => {
  const { token, favoriteIds, toggleFavoriteBook } = useAuth();

  const favorites = useMemo(() => {
    if (!token) return [];
    // Re-read whenever favoriteIds changes
    void favoriteIds.size;
    return libraryStore.getMyFavorites(token);
  }, [token, favoriteIds]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tủ sách Yêu thích của tôi (`F12`)</h1>
          <p className="page-subtitle">
            Lưu riêng theo tài khoản cá nhân để tiện theo dõi tình trạng bản sao sẵn có trước khi đặt mượn.
          </p>
        </div>
      </div>

      {favorites.length === 0 ? (
        <EmptyState
          title="Danh sách yêu thích đang trống"
          description="Hãy bấm nút ☆ Yêu thích trên trang Danh mục hoặc Chi tiết sách để lưu lại những cuốn bạn muốn đọc."
          action={
            <Link to="/" className="btn btn-primary">
              Tìm sách ngay
            </Link>
          }
        />
      ) : (
        <div className="grid-books">
          {favorites.map((book) => (
            <article key={book.id} className="card book-card">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span className="badge badge-info">{book.category}</span>
                  <span className="badge badge-neutral">Kệ {book.shelf}</span>
                </div>
                <h2 style={{ margin: '0.2rem 0', fontSize: '1.05rem' }}>
                  <Link to={`/books/${book.id}`}>{book.title}</Link>
                </h2>
                <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>{book.author}</div>
                <p className="book-desc-clamp">{book.description}</p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <AvailabilityBadge available={book.available_copies} total={book.total_copies} />
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => toggleFavoriteBook(book.id)}
                  >
                    Bỏ lưu
                  </button>
                  <Link to={`/books/${book.id}`} className="btn btn-primary btn-sm">
                    Chi tiết
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
