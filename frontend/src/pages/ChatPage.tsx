import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Check, ChevronRight, Cloud, CornerDownLeft, Heart, LogOut, MapPin, MessageCircle, Plus, Search, Send, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGoogleAuth } from '../context/GoogleAuthContext';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { BookCover, BookLanguage, BookSourceLink } from '../components/BookMedia';
import type { ChatContext } from '../services/libraryChat';
import { askGoogleAI, AIRequestError, type AIReply } from '../services/googleAI';
import { libraryStore } from '../services/libraryStore';
import type { BookWithAvailability } from '../types/library';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: AIReply;
}

// Keep a conversation when opening a book and coming back. A reload starts fresh.
const conversations = new Map<string, { messages: Message[]; context?: ChatContext; onlyAvailable: boolean }>();

const PROMPTS = [
  { icon: '∑', title: 'Chinh phục môn Toán', text: 'Tìm một cách học dễ hiểu hơn', query: 'Em muốn học toán', color: 'mint' },
  { icon: '</>', title: 'Bắt đầu lập trình', text: 'Từ dòng code đầu tiên', query: 'Em muốn học lập trình Python', color: 'blue' },
  { icon: 'Aa', title: 'Giỏi tiếng Anh hơn', text: 'Tự tin học và giao tiếp', query: 'Em muốn học tiếng Anh', color: 'peach' },
  { icon: '✦', title: 'Hiểu mình một chút', text: 'Bớt áp lực, thêm tập trung', query: 'Em hay căng thẳng trước kỳ thi', color: 'lilac' },
];

export const ChatPage: React.FC = () => {
  const { user, favoriteIds, toggleFavoriteBook } = useAuth();
  const { session: googleSession, refresh: refreshGoogleSession, logout: logoutGoogle } = useGoogleAuth();
  const googleReader = googleSession?.user;
  const conversationKey = `${googleReader?.id ?? 'guest'}:${user?.id ?? 'guest'}`;
  const saved = conversations.get(conversationKey);
  const [messages, setMessages] = useState<Message[]>(() => saved?.messages ?? []);
  const [draft, setDraft] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(saved?.onlyAvailable ?? false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const context = useRef<ChatContext | undefined>(saved?.context);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pendingRequest = useRef<AbortController>();
  const sequence = useRef(saved?.messages.at(-1)?.id ?? 0);
  const latestMessageRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const featured = libraryStore.listCatalogBooks({ pageSize: 3 }).items;
  const total = libraryStore.listCatalogBooks({ pageSize: 1 }).total;

  useEffect(() => {
    if (messages.length) latestMessageRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    conversations.set(conversationKey, { messages, context: context.current, onlyAvailable });
  }, [messages, onlyAvailable, conversationKey]);
  useEffect(() => () => { generation.current++; pendingRequest.current?.abort(); }, []);

  const newChat = () => {
    generation.current++;
    pendingRequest.current?.abort();
    inFlight.current = false;
    setMessages([]);
    setDraft('');
    setBusy(false);
    setNotice('');
    context.current = undefined;
    conversations.delete(conversationKey);
    headerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    inputRef.current?.focus({ preventScroll: true });
  };

  const send = async (value: string) => {
    const text = value.trim().slice(0, 1000);
    if (!text || inFlight.current) return;
    if (!googleReader || !googleSession?.csrfToken) { setNotice('Bạn đăng nhập Google trước khi trò chuyện với AI nhé.'); return; }
    inFlight.current = true;
    const currentGeneration = generation.current;
    setDraft('');
    setNotice('');
    setMessages((prev) => [...prev, { id: ++sequence.current, role: 'user', text }]);
    setBusy(true);
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      const reply = await askGoogleAI(text, context.current, { csrfToken: googleSession.csrfToken, onlyAvailable, history: messages.map(({ role, text }) => ({ role, text })), signal: controller.signal });
      if (currentGeneration !== generation.current) return;
      context.current = reply.context ?? context.current;
      setMessages((prev) => [...prev, { id: ++sequence.current, role: 'assistant', text: reply.text, reply }]);
    } catch (error) {
      if (currentGeneration !== generation.current) return;
      if (controller.signal.aborted) return;
      if (error instanceof AIRequestError && [401, 403].includes(error.status)) void refreshGoogleSession();
      setMessages((prev) => [...prev, { id: ++sequence.current, role: 'assistant', text: error instanceof AIRequestError ? error.message : 'Mình chưa thể tra cứu lúc này. Bạn thử gửi lại câu hỏi nhé.' }]);
    } finally {
      if (currentGeneration === generation.current) {
        inFlight.current = false;
        setBusy(false);
        inputRef.current?.focus({ preventScroll: true });
      }
    }
  };

  const favorite = (book: BookWithAvailability) => {
    try {
      const added = toggleFavoriteBook(book.id);
      setNotice(added ? `Đã lưu “${book.title}” vào yêu thích.` : `Đã bỏ lưu “${book.title}”.`);
    } catch {
      setNotice('Bạn đăng nhập để lưu sách vào danh sách yêu thích nhé.');
    }
  };

  return <div className="chat-page">
    <header className="chat-topbar" ref={headerRef}>
      <div><span className="chat-breadcrumb">GÓC KHÁM PHÁ CỦA BẠN</span><h1>Trò chuyện cùng LibMate <span className="free-badge">Gemini AI</span></h1></div>
      <div className="chat-header-actions">{googleReader && <div className="google-reader-chip"><span>{googleReader.name}</span><button onClick={() => void logoutGoogle()} aria-label="Đăng xuất Google" title="Đăng xuất Google"><LogOut size={15} /></button></div>}<button className="chat-new-button" onClick={newChat} aria-label="Cuộc trò chuyện mới"><Plus size={17} /><span>Chat mới</span></button></div>
    </header>

    <div className={`chat-content ${messages.length ? 'has-messages' : ''}`}>
      {messages.length === 0 ? <>
        <section className="chat-welcome" aria-labelledby="welcome-title">
          <div className="welcome-symbol"><Sparkles size={32} strokeWidth={1.5} /><span className="welcome-symbol-spark">✦</span></div>
          <div className="welcome-eyebrow">MỘT CUỐN SÁCH, MỘT KHỞI ĐẦU MỚI</div>
          <h2 id="welcome-title">Hôm nay, bạn muốn<br /><em>khám phá điều gì?</em></h2>
          <p>Kể mình nghe điều bạn muốn học.<br className="mobile-break" /> Mình sẽ tìm những cuốn sách dành cho bạn.</p>
          <div className="prompt-grid">
            {PROMPTS.map((prompt) => <button className={`prompt-card ${prompt.color}`} key={prompt.title} onClick={() => void send(prompt.query)} disabled={!googleReader}>
              <span className="prompt-icon">{prompt.icon}</span><strong>{prompt.title}</strong><span>{prompt.text}</span><ChevronRight className="prompt-chevron" size={17} />
            </button>)}
          </div>
        </section>
        <section className="chat-discover" aria-labelledby="discover-title">
          <div className="discover-heading"><div><span className="section-eyebrow">MỞ MỘT TRANG SÁCH</span><h3 id="discover-title">Một chút cảm hứng cho bạn</h3></div><Link to="/catalog">Xem danh mục <BookOpen size={15} /></Link></div>
          <div className="discover-books">{featured.map((book) => <Link to={`/books/${book.id}`} className="discover-book" key={book.id}>
            <BookCover book={book} size="small" eager /><div><span>{book.category}</span><h4>{book.title}</h4><p>{book.author}</p><span className="discover-availability">{book.available_copies > 0 ? 'Có sẵn trong thư viện' : 'Đang được mượn'}</span></div>
          </Link>)}</div>
        </section>
      </> : <section className="chat-messages" role="log" aria-label="Cuộc trò chuyện tìm sách" aria-live="polite" aria-relevant="additions" aria-busy={busy}>
        {messages.map((message, messageIndex) => <article className={`chat-message ${message.role}`} key={message.id} ref={messageIndex === messages.length - 1 ? latestMessageRef : undefined}>
          <div className="message-avatar" aria-hidden="true">{message.role === 'assistant' ? <Sparkles size={20} /> : (googleReader?.name.slice(0, 1) || 'B')}</div>
          <div className="message-body"><div className="message-author">{message.role === 'assistant' ? 'LibMate' : (googleReader?.name || 'Bạn')} {message.role === 'assistant' && <span>{message.reply?.source === 'gemini' ? 'GEMINI AI' : 'TÌM SÁCH THƯ VIỆN'}</span>}</div>
            {message.reply?.providerNotice && <p className="ai-provider-notice">{message.reply.providerNotice}</p>}
            <p className="message-text">{message.text}</p>
            {message.reply && message.reply.books.length > 0 && <div className="chat-book-results">
              {message.reply.books.map(({ book, reason }) => <article key={book.id} className="chat-result-card">
                <div className="result-main"><BookCover book={book} /><div className="result-info"><span className="result-category">{book.category}</span><h3><Link to={`/books/${book.id}`}>{book.title}</Link></h3><p className="result-author">{book.author} <BookLanguage book={book} /></p><p className="result-excerpt">{reason.excerpt}</p></div></div>
                <div className="result-footer"><span className={book.available_copies > 0 ? 'book-available' : 'book-unavailable'}>{book.available_copies > 0 ? <Check size={14} /> : <BookOpen size={14} />}{book.available_copies > 0 ? `Còn ${book.available_copies} bản` : 'Đang hết bản'}</span><span className="result-shelf"><MapPin size={14} />Kệ {book.shelf}</span><BookSourceLink book={book} /><div className="result-actions"><button onClick={() => favorite(book)} className={`save-book ${favoriteIds.has(book.id) ? 'saved' : ''}`} aria-label={`${favoriteIds.has(book.id) ? 'Bỏ lưu' : 'Lưu'} ${book.title}`} aria-pressed={favoriteIds.has(book.id)}><Heart size={17} fill={favoriteIds.has(book.id) ? 'currentColor' : 'none'} /></button><Link to={`/books/${book.id}`} className="result-detail">Xem &amp; đặt mượn</Link></div></div>
              </article>)}
            </div>}
            {messageIndex === messages.length - 1 && message.reply && <div className="chat-followups">{message.reply.suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)} disabled={busy}><MessageCircle size={14} />{suggestion}</button>)}</div>}
          </div>
        </article>)}
        {busy && <div className="chat-thinking" role="status"><Search size={16} />Gemini đang tìm sách phù hợp với bạn…</div>}
      </section>}
    </div>

    <div className="chat-composer-area">
      {notice && <div className="chat-notice" role="status">{notice}{!user && <> <Link to="/login">Đăng nhập</Link></>}</div>}
      {googleReader ? <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        <label htmlFor="chat-input" className="sr-only">Bạn muốn tìm sách gì?</label>
        <textarea id="chat-input" ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} rows={2} placeholder="Ví dụ: Em muốn học toán, có sách nào dễ hiểu không?" onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); }
        }} />
        <div className="composer-bottom"><span className="composer-hint"><Sparkles size={14} />Tìm trong {total} đầu sách của thư viện</span><div><span className="enter-hint"><CornerDownLeft size={12} /> Enter để gửi</span><button type="submit" className="chat-send" disabled={!draft.trim() || busy} aria-label="Gửi tin nhắn"><Send size={18} /></button></div></div>
      </form> : <GoogleSignIn compact />}
      <div className="composer-caption"><span><Cloud size={13} />Gemini Free Tier · Gợi ý từ danh mục thư viện</span><label><input type="checkbox" checked={onlyAvailable} onChange={(event) => { setOnlyAvailable(event.target.checked); if (context.current) context.current.onlyAvailable = event.target.checked; }} />Chỉ sách còn bản</label></div>
    </div>
  </div>;
};
