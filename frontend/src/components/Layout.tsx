import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, ClipboardList, Heart, HelpCircle, Library, LogIn, LogOut, Menu, MessageCircle, PanelLeftClose, PieChart, Sparkles, UserRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, dueAlerts, favoriteIds, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isChat = pathname === '/';
  const hasOverdue = dueAlerts.some((loan) => loan.is_overdue);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [mobileOpen]);

  return <div className="library-app">
    <a href="#main-content" className="skip-link">Đến nội dung chính</a>
    <div className="mobile-app-bar"><Link to="/" className="mobile-brand"><BookOpen size={22} />LibMate<span>AI</span></Link><button type="button" aria-label="Mở menu điều hướng" aria-expanded={mobileOpen} aria-controls="library-sidebar" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <Menu />}</button></div>
    {mobileOpen && <button className="sidebar-overlay" aria-label="Đóng menu điều hướng" onClick={() => setMobileOpen(false)} />}
    <aside id="library-sidebar" className={`library-sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="sidebar-brand-row"><Link to="/" className="sidebar-brand" onClick={() => setMobileOpen(false)}><span className="brand-book"><BookOpen size={23} strokeWidth={1.8} /></span><span>LibMate<span className="brand-ai">AI</span></span></Link><button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Thu gọn menu"><PanelLeftClose size={18} /></button></div>
      <p className="sidebar-tagline">Bạn đọc, mình đồng hành.</p>
      <nav className="sidebar-nav" aria-label="Điều hướng chính">
        <span className="nav-section-label">KHÔNG GIAN CỦA BẠN</span>
        <NavLink to="/" end onClick={() => setMobileOpen(false)}><MessageCircle size={19} />Trợ lý tìm sách<span className="sidebar-new">AI</span></NavLink>
        <NavLink to="/catalog" onClick={() => setMobileOpen(false)}><Library size={19} />Danh mục sách</NavLink>
        {user && <>
          <NavLink to="/my-loans"><ClipboardList size={19} />Mượn &amp; Lịch sử</NavLink>
          <NavLink to="/favorites"><Heart size={19} />Yêu thích <span className="sidebar-count">{favoriteIds.size}</span></NavLink>
        </>}
        {user?.role === 'librarian' && <>
          <span className="nav-section-label librarian-label">QUẢN LÝ THƯ VIỆN</span>
          <NavLink to="/librarian/desk"><ClipboardList size={19} />Quầy Giao/Trả</NavLink>
          <NavLink to="/librarian/books"><Library size={19} />Kho sách &amp; Bản sao</NavLink>
          <NavLink to="/librarian/reports"><PieChart size={19} />Báo cáo &amp; CSV</NavLink>
        </>}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><Sparkles size={20} /><strong>Tò mò là khởi đầu<br />của mọi điều hay.</strong><p>Một câu hỏi nhỏ. Một cuốn sách mới. Một thế giới rộng hơn.</p><span>Trợ lý miễn phí cho bạn đọc</span></div>
        <NavLink to="/guide" className="sidebar-help"><HelpCircle size={18} />Hướng dẫn sử dụng</NavLink>
        <div className="sidebar-account">{user ? <><span className="account-avatar">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><span>{user.role === 'librarian' ? 'Thủ thư' : 'Bạn đọc'} · {user.reader_code}</span></div><button onClick={() => { logout(); navigate('/login'); }} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={18} /></button></> : <><span className="account-avatar"><UserRound size={20} /></span><div><strong>Chào bạn mới!</strong><span>Cùng tìm sách hay nhé</span></div><Link to="/login" aria-label="Đăng nhập" title="Đăng nhập"><LogIn size={19} /></Link></>}</div>
      </div>
    </aside>
    <div className={`library-workspace ${isChat ? 'is-chat' : ''}`}>
      {user && dueAlerts.length > 0 && <div className={`reminder-banner ${hasOverdue ? 'overdue' : ''}`} role="region" aria-label="Nhắc hạn trả sách"><div className="reminder-inner"><span><strong>{hasOverdue ? 'Nhắc trả sách:' : 'Sắp đến hạn:'}</strong> Bạn có {dueAlerts.length} cuốn {hasOverdue ? 'quá hạn hoặc ' : ''}sắp đến hạn trả.</span><Link to="/my-loans">Xem phiếu mượn</Link></div></div>}
      <main id="main-content" className={isChat ? 'chat-main' : 'container'}>{children}</main>
      {!isChat && <footer className="library-footer">LibMate · Đọc điều hay, mở tương lai.</footer>}
    </div>
  </div>;
};
