import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, dueAlerts, favoriteIds, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const hasOverdue = dueAlerts.some((l) => l.is_overdue);

  const handleLogout = () => {
    logout();
    setMobileOpen(false);
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Link to="/" className="brand" onClick={() => setMobileOpen(false)}>
              <span className="brand-badge">LibMate</span>
              <span>Thư viện AI Trường học</span>
            </Link>
          </div>

          <button
            type="button"
            className="mobile-menu-btn"
            aria-label="Mở menu điều hướng"
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            ☰ Menu
          </button>

          <nav className={`nav-links ${mobileOpen ? 'open' : ''}`} aria-label="Điều hướng chính">
            <NavLink to="/" end className="nav-link" onClick={() => setMobileOpen(false)}>
              Danh mục & AI
            </NavLink>

            {user && (
              <>
                <NavLink to="/my-loans" className="nav-link" onClick={() => setMobileOpen(false)}>
                  Mượn & Lịch sử
                </NavLink>
                <NavLink to="/favorites" className="nav-link" onClick={() => setMobileOpen(false)}>
                  Yêu thích ({favoriteIds.size})
                </NavLink>
              </>
            )}

            {/* Phân quyền màn hình T07: Người đọc tuyệt đối không thấy thao tác thủ thư */}
            {user?.role === 'librarian' && (
              <>
                <NavLink
                  to="/librarian/desk"
                  className="nav-link nav-link-librarian"
                  onClick={() => setMobileOpen(false)}
                >
                  Quầy Giao/Trả
                </NavLink>
                <NavLink
                  to="/librarian/books"
                  className="nav-link nav-link-librarian"
                  onClick={() => setMobileOpen(false)}
                >
                  Kho sách & Bản sao
                </NavLink>
                <NavLink
                  to="/librarian/reports"
                  className="nav-link nav-link-librarian"
                  onClick={() => setMobileOpen(false)}
                >
                  Báo cáo & CSV
                </NavLink>
              </>
            )}

            <NavLink to="/guide" className="nav-link" onClick={() => setMobileOpen(false)}>
              Hướng dẫn
            </NavLink>
          </nav>

          <div className="user-area">
            {user ? (
              <>
                <span className="badge badge-info" title={`Mã: ${user.reader_code}`}>
                  {user.role === 'librarian' ? 'Thủ thư' : 'Bạn đọc'}: {user.name}
                </span>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleLogout}>
                  Đăng xuất
                </button>
              </>
            ) : (
              <Link to="/login" className="btn btn-primary btn-sm">
                Đăng nhập
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Thông báo nhắc hạn trả trực tiếp trong ứng dụng (F12 / T32 — chưa tích hợp email/SMS) */}
      {user && dueAlerts.length > 0 && (
        <div className={`reminder-banner ${hasOverdue ? 'overdue' : ''}`} role="region" aria-label="Nhắc hạn trả sách">
          <div className="reminder-inner">
            <div>
              <strong>{hasOverdue ? 'Cảnh báo quá hạn trả sách:' : 'Nhắc hạn trả trong ứng dụng:'}</strong>{' '}
              Bạn có {dueAlerts.length} cuốn đang mượn {hasOverdue ? 'đã quá hạn hoặc ' : ''}sắp đến hạn trả.
              <span style={{ opacity: 0.85, marginLeft: '0.4rem' }}>
                (Thông báo hiển thị trong ứng dụng — MVP chưa gửi Email/SMS)
              </span>
            </div>
            <Link to="/my-loans" className="btn btn-outline btn-sm">
              Xem phiếu mượn
            </Link>
          </div>
        </div>
      )}

      <main className="container">{children}</main>

      <footer className="footer">
        LibMate MVP — Thư viện trường học tích hợp AI local miễn phí • Nhóm phát triển: Lý Thế An &amp; Phạm Hiển
      </footer>
    </div>
  );
};
