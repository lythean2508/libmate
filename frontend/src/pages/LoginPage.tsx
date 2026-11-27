import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { libraryStore } from '../services/libraryStore';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { useGoogleAuth } from '../context/GoogleAuthContext';
import { Link } from 'react-router-dom';

export const LoginPage: React.FC = () => {
  const { session: googleSession } = useGoogleAuth();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [readerCode, setReaderCode] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [gradeOrDept, setGradeOrDept] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    try {
      if (mode === 'login') {
        login(readerCode, password);
        navigate('/');
      } else {
        const created = libraryStore.registerReader({
          reader_code: readerCode,
          name: fullName,
          password,
          grade_or_dept: gradeOrDept,
        });
        setSuccessMsg(
          `Đăng ký thành công tài khoản bạn đọc "${created.reader_code}" (vai trò: ${created.role}). Bạn có thể đăng nhập ngay.`
        );
        setMode('login');
        setPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    }
  };

  const quickFill = (code: string, pass: string) => {
    setMode('login');
    setReaderCode(code);
    setPassword(pass);
    setError(null);
  };

  return (
    <div style={{ maxWidth: '640px', margin: '1rem auto' }}>
      {googleSession?.user ? <div className="google-connected-card"><strong>Đã đăng nhập Google · {googleSession.user.name}</strong><Link to="/">Trò chuyện với Gemini</Link></div> : <GoogleSignIn />}
      <div className="library-login-divider">Tài khoản thẻ thư viện · Dành cho mượn/trả và quản lý sách</div>
      <div className="card">
        <div className="tabs">
          <button
            type="button"
            className={`tab-btn ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setError(null);
            }}
          >
            Đăng nhập hệ thống
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === 'register' ? 'active' : ''}`}
            onClick={() => {
              setMode('register');
              setError(null);
            }}
          >
            Đăng ký bạn đọc mới
          </button>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {successMsg && <div className="alert alert-success">{successMsg}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div className="field">
            <label htmlFor="readerCode">Mã người đọc / Mã thẻ thư viện</label>
            <input
              id="readerCode"
              className="input"
              value={readerCode}
              onChange={(e) => setReaderCode(e.target.value)}
              placeholder="Ví dụ: LIB001, HS10A1, PILOT01"
              required
            />
          </div>

          {mode === 'register' && (
            <>
              <div className="field">
                <label htmlFor="fullName">Họ và tên học sinh / giáo viên</label>
                <input
                  id="fullName"
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ví dụ: Lê Minh Khôi"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="gradeOrDept">Lớp / Tổ bộ môn</label>
                <input
                  id="gradeOrDept"
                  className="input"
                  value={gradeOrDept}
                  onChange={(e) => setGradeOrDept(e.target.value)}
                  placeholder="Ví dụ: Lớp 11A3"
                />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu"
              required
            />
          </div>

          {mode === 'register' && (
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              Lưu ý phân quyền (`F03` / `TC02`): Tự đăng ký công khai chỉ tạo tài khoản <strong>Người đọc (`reader`)</strong>. Vai trò Thủ thư do quản trị viên cấp sẵn.
            </div>
          )}

          <button type="submit" className="btn btn-primary">
            {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản bạn đọc'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
          Tài khoản mẫu phục vụ Kiểm thử, Demo &amp; Pilot (`T07`, `T37`)
        </h3>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
          Bấm chọn nhanh một tài khoản dưới đây để điền thông tin đăng nhập thử nghiệm:
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => quickFill('LIB001', 'libmate123')}
          >
            Thủ thư: LIB001
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => quickFill('HS10A1', 'reader123')}
          >
            Bạn đọc (có sách quá hạn): HS10A1
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => quickFill('HS11B2', 'reader123')}
          >
            Bạn đọc (sắp đến hạn): HS11B2
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => quickFill('PILOT01', 'pilot123')}
          >
            Người thử Pilot: PILOT01..PILOT10
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => quickFill('HSKHOA', 'reader123')}
          >
            Tài khoản bị khóa: HSKHOA
          </button>
        </div>
      </div>
    </div>
  );
};
