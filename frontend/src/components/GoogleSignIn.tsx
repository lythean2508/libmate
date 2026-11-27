import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useGoogleAuth } from '../context/GoogleAuthContext';

interface GoogleIdentity {
  initialize: (options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean }) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
  disableAutoSelect: () => void;
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }
let scriptPromise: Promise<void> | undefined;
function loadGoogleIdentity() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client?hl=vi';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); scriptPromise = undefined; reject(new Error('Không tải được nút đăng nhập Google. Kiểm tra kết nối mạng rồi thử lại nhé.')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export const GoogleSignIn: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { session, loading, error, login, refresh } = useGoogleAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const loginRef = useRef(login);
  loginRef.current = login;
  const [scriptError, setScriptError] = useState('');
  const [retry, setRetry] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  const localhostLink = location.hostname === '127.0.0.1' ? `http://localhost:${location.port || '5173'}${location.pathname}` : '';

  useEffect(() => {
    if (!session?.googleClientId || !session.csrfToken || session.user || localhostLink) return;
    let cancelled = false;
    void loadGoogleIdentity().then(() => {
      if (cancelled || !buttonRef.current || !window.google) return;
      window.google.accounts.id.initialize({ client_id: session.googleClientId, nonce: session.csrfToken, auto_select: false, callback: (response) => {
        if (cancelled) return;
        setSigningIn(true);
        void loginRef.current(response.credential).catch(() => {}).finally(() => { if (!cancelled) setSigningIn(false); });
      } });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'vi', width: 260 });
      setScriptError('');
    }).catch((err) => { if (!cancelled) setScriptError(err.message); });
    return () => { cancelled = true; };
  }, [session?.googleClientId, session?.csrfToken, session?.user, retry, localhostLink]);

  if (session?.user) return null;
  return <section className={`google-signin-panel ${compact ? 'compact' : ''}`} aria-label="Đăng nhập Google để dùng AI">
    <div className="google-signin-icon"><ShieldCheck size={22} /></div>
    <div className="google-signin-copy"><strong>Đăng nhập Google để trò chuyện với AI</strong><p>Tìm sách theo nhu cầu, nhận gợi ý từ Gemini và tiếp tục câu chuyện của bạn.</p></div>
    <div className="google-button-area">
      {loading ? <span role="status">Đang kiểm tra đăng nhập…</span> : localhostLink ? <a href={localhostLink} className="google-localhost-link">Mở LibMate để đăng nhập Google</a> : !session?.googleClientId ? <><button className="google-disabled-button" disabled><span>G</span>Đăng nhập bằng Google</button><small>Đăng nhập Google đang được thiết lập.</small></> : <div ref={buttonRef} className="google-official-button" />}
      {signingIn && <span role="status">Đang xác minh tài khoản…</span>}
      {(error || scriptError) && <div className="google-signin-error" role="alert">{error || scriptError}<button onClick={() => { setScriptError(''); setRetry((value) => value + 1); void refresh(); }}>Thử lại</button></div>}
    </div>
  </section>;
};
