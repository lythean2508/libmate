import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AuthProvider } from '../context/AuthContext';
import { GoogleAuthProvider } from '../context/GoogleAuthContext';
import { findBooksForChat } from '../services/libraryChat';
import { libraryStore } from '../services/libraryStore';

async function renderChat() {
  const result = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><GoogleAuthProvider><App /></GoogleAuthProvider></AuthProvider></MemoryRouter>);
  await screen.findByRole('textbox', { name: 'Bạn muốn tìm sách gì?' });
  return result;
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith('/session')
    ? { user: { id: 'google-reader-test', name: 'Bạn đọc Google', email: 'reader@example.test' }, googleClientId: '', csrfToken: '0'.repeat(64), geminiConfigured: true, model: 'gemini-3.5-flash-lite' }
    : { code: 'AI_UNAVAILABLE', message: 'Gemini đang tạm ngưng.' }), { status: String(url).endsWith('/session') ? 200 : 503, headers: { 'Content-Type': 'application/json' } }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Chat tìm sách miễn phí', () => {
  it.each(['Em muốn học toán', 'em muon hoc toan', 'Em muốn học toán, có sách nào dễ hiểu không?'])('tự tìm sách Toán từ nhu cầu: %s', (query) => {
    const reply = findBooksForChat(query);
    expect(reply.books.length).toBeGreaterThan(0);
    expect(reply.books.every(({ book }) => book.category === 'Toán học & Tư duy')).toBe(true);
    for (const { book, reason } of reply.books) {
      expect(libraryStore.getBookDetail(book.id).book.title).toBe(book.title);
      expect(book.description).toContain(reason.excerpt);
    }
  });

  it('tìm đúng môn mới và giữ ngữ cảnh khi hỏi thêm, không lặp lại sách', () => {
    const first = findBooksForChat('Em muốn học toán');
    const next = findBooksForChat('Còn sách nào khác không?', first.context);
    expect(next.books.length).toBeGreaterThan(0);
    expect(next.books.every(({ book }) => book.category === 'Toán học & Tư duy' && !first.books.some((item) => item.book.id === book.id))).toBe(true);
    const exhausted = findBooksForChat('Còn sách nào khác không?', next.context);
    expect(exhausted.books).toHaveLength(0);
    expect(exhausted.text).toMatch(/chưa tìm thấy thêm/i);
    const changed = findBooksForChat('Em muốn học lập trình Python', next.context);
    expect(changed.books.some(({ book }) => book.id === 'B053')).toBe(true);
    expect(changed.books.every(({ book }) => book.category === 'Tin học & AI')).toBe(true);
  });

  it('hiểu câu hỏi cụ thể tiếp theo và không gán mọi câu cho môn Toán', () => {
    const math = findBooksForChat('Em muốn học toán');
    const geometry = findBooksForChat('Em cần sách hình học', math.context);
    expect(geometry.books.some(({ book }) => book.id === 'B026')).toBe(true);
    const english = findBooksForChat('Em muốn học tiếng Anh', math.context);
    expect(english.books.length).toBeGreaterThan(0);
    expect(english.books.every(({ book }) => book.category === 'Ngoại ngữ & Kỹ năng học thuật')).toBe(true);
    expect(english.books.every(({ book }) => /tiếng anh/i.test(book.title) || book.language?.includes('Anh'))).toBe(true);
  });

  it('chào hỏi, hỏi lại khi chưa có chủ đề và báo rõ khi không có sách', () => {
    expect(findBooksForChat('Xin chào!').books).toHaveLength(0);
    expect(findBooksForChat('Em muốn tìm sách').text).toMatch(/cho mình biết/i);
    expect(findBooksForChat('Em muốn học chủ đề khác').text).toMatch(/cho mình biết/i);
    const missing = findBooksForChat('zzzzzzzzzzzz xxxxxxxxxxxx');
    expect(missing.books).toHaveLength(0);
    expect(missing.text).toMatch(/chưa tìm thấy sách phù hợp/i);
  });

  it('loại sách ẩn và sách hết bản; chỉ dùng danh mục hiện tại, không gọi mạng', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const lib = libraryStore.login('LIB001', 'libmate123');
      const hidden = libraryStore.getBookDetail('B023').book;
      libraryStore.createOrUpdateBook(lib.token, { ...hidden, visible: false });
      const unavailable = libraryStore.getBookDetail('B024');
      for (const copy of unavailable.copies) {
        if (copy.status === 'available') libraryStore.updateCopyStatus(lib.token, copy.id, 'maintenance');
      }
      const reply = findBooksForChat('Em muốn học toán', undefined, { onlyAvailable: true });
      expect(reply.books.length).toBeGreaterThan(0);
      expect(reply.books.every(({ book }) => book.id !== 'B023' && book.id !== 'B024' && book.available_copies > 0)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('hiểu yêu cầu chỉ lấy sách còn bản ở lượt chat sau', () => {
    const first = findBooksForChat('Em muốn học toán');
    const filtered = findBooksForChat('Chỉ sách còn bản', first.context);
    expect(filtered.context?.onlyAvailable).toBe(true);
    expect(filtered.books.length).toBeGreaterThan(0);
    expect(filtered.books.every(({ book }) => book.available_copies > 0 && book.category === 'Toán học & Tư duy')).toBe(true);
  });

  it('gửi câu tự nhiên bằng Enter, xem sách thật và bắt đầu chat mới', async () => {
    const user = userEvent.setup();
    await renderChat();
    const input = screen.getByRole('textbox', { name: 'Bạn muốn tìm sách gì?' });
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeDisabled();
    await user.type(input, 'Em muốn học toán{Enter}');
    const log = await screen.findByRole('log');
    expect(await within(log).findByRole('link', { name: 'Giải Bài Toán Như Thế Nào?' })).toHaveAttribute('href', '/books/B023');
    expect(within(log).getAllByRole('link', { name: 'Xem & đặt mượn' })).toHaveLength(5);
    expect(within(log).getAllByRole('img', { name: /^Bìa sách / })).toHaveLength(5);
    expect(within(log).getAllByRole('link', { name: /^Trang sách tại / })).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Còn sách nào khác không?' }));
    expect(await within(log).findByText(/5 cuốn khác/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' }));
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('câu hỏi gợi ý hoạt động, Shift+Enter xuống dòng và nội dung không có sách không sinh thẻ sách', async () => {
    const user = userEvent.setup();
    await renderChat();
    await user.click(screen.getByRole('button', { name: /Chinh phục môn Toán/ }));
    expect(await screen.findByText(/5 cuốn thuộc chủ đề Toán/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' }));
    const input = screen.getByRole('textbox');
    await user.type(input, 'zzzzzz{Shift>}{Enter}{/Shift}xxxxxxxx');
    expect(input).toHaveValue('zzzzzz\nxxxxxxxx');
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
    expect(await screen.findByText(/Mình chưa tìm thấy sách phù hợp với nhu cầu này/)).toBeInTheDocument();
    expect(within(screen.getByRole('log')).queryByRole('link', { name: 'Xem & đặt mượn' })).not.toBeInTheDocument();
  });

  it('giữ cuộc trò chuyện khi xem chi tiết sách rồi quay lại; lưu yêu thích yêu cầu đăng nhập', async () => {
    const user = userEvent.setup();
    await renderChat();
    await user.click(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' }));
    await user.click(screen.getByRole('button', { name: /Chinh phục môn Toán/ }));
    const bookLink = await screen.findByRole('link', { name: 'Giải Bài Toán Như Thế Nào?' });
    await user.click(screen.getByRole('button', { name: 'Lưu Giải Bài Toán Như Thế Nào?' }));
    expect(screen.getByRole('status')).toHaveTextContent(/đăng nhập/i);
    await user.click(bookLink);
    expect(screen.getByRole('heading', { name: 'Giải Bài Toán Như Thế Nào?' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Trợ lý tìm sách AI' }));
    expect(screen.getByRole('log')).toHaveTextContent('Em muốn học toán');
    expect(screen.getByRole('link', { name: 'Giải Bài Toán Như Thế Nào?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' }));
  });
});
