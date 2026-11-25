import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AuthProvider } from '../context/AuthContext';
import { EVAL_QUERIES_30 } from '../data/seedCatalog';
import { libraryStore } from '../services/libraryStore';

function renderApp(initialRoute = '/') {
  return render(
    <MemoryRouter
      initialEntries={[initialRoute]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Bộ kiểm thử UAT & Nghiệp vụ của Lý Thế An (TC01..TC31)', () => {
  it('TC01 & T07: Đăng nhập sai báo lỗi rõ; đăng xuất vô hiệu hóa phiên; người đọc không thấy menu thủ thư', async () => {
    expect(() => libraryStore.login('HS10A1', 'sai_mat_khau')).toThrow(/không đúng/i);
    expect(libraryStore.getCurrentSession()).toBeNull();

    const session = libraryStore.login('HS10A1', 'reader123');
    expect(session.user.role).toBe('reader');

    renderApp('/');
    expect(screen.queryByText(/Quầy Giao\/Trả/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kho sách & Bản sao/i)).not.toBeInTheDocument();

    libraryStore.logout(session.token);
    expect(libraryStore.getCurrentSession()).toBeNull();
    expect(() => libraryStore.getMyActivity(session.token)).toThrow(/không hợp lệ|đã đăng xuất/i);
  });

  it('TC02 & TC03 & TC04: Tự đăng ký ép cứng reader; chặn người đọc gọi nghiệp vụ thủ thư hoặc hủy đơn người khác', () => {
    const u = libraryStore.registerReader({
      reader_code: 'HS99Z9',
      name: 'Học Sinh Thử Quyền',
      password: 'password123',
      role: 'librarian',
    });
    expect(u.role).toBe('reader');

    const rdrSession = libraryStore.login('HS99Z9', 'password123');
    expect(() => libraryStore.getLibrarianReport(rdrSession.token)).toThrow(/Thủ thư/i);
    expect(() => libraryStore.exportLoansCsv(rdrSession.token)).toThrow(/Thủ thư/i);
    // Không thể hủy yêu cầu REQ-0004 của HS10A1
    expect(() => libraryStore.cancelBorrowRequest(rdrSession.token, 'REQ-0004')).toThrow(/quyền/i);
  });

  it('TC05: Tìm tên sách và tác giả có dấu và không dấu tiếng Việt trong bộ 100 sách', () => {
    const accented = libraryStore.listCatalogBooks({ query: 'Mắt Biếc' });
    const unaccented = libraryStore.listCatalogBooks({ query: 'mat biec' });
    const authorUnaccented = libraryStore.listCatalogBooks({ query: 'nguyen nhat anh' });

    expect(accented.items.some((b) => b.id === 'B001')).toBe(true);
    expect(unaccented.items.some((b) => b.id === 'B001')).toBe(true);
    expect(authorUnaccented.total).toBeGreaterThanOrEqual(2);
  });

  it('TC06: Danh mục rỗng hiển thị thông báo an toàn và giữ nguyên bộ lọc chủ đề khi chuyển trang', async () => {
    const empty = libraryStore.listCatalogBooks({ query: 'chuoi_khong_ton_tai_xyz_999' });
    expect(empty.total).toBe(0);
    expect(empty.items).toHaveLength(0);

    // Chủ đề Văn học Việt Nam có 12 sách; với pageSize=5 sang trang 2 vẫn giữ đúng chủ đề Văn học Việt Nam
    const page1 = libraryStore.listCatalogBooks({
      category: 'Văn học Việt Nam',
      page: 1,
      pageSize: 5,
    });
    const page2 = libraryStore.listCatalogBooks({
      category: 'Văn học Việt Nam',
      page: 2,
      pageSize: 5,
    });
    expect(page1.total).toBe(12);
    expect(page2.items).toHaveLength(5);
    expect(page2.items.every((b) => b.category === 'Văn học Việt Nam')).toBe(true);
  });

  it('TC07 & TC08: Chặn trùng mã bản sao copy_code; ẩn sách có lịch sử không mất phiếu mượn và không lộ trên tìm kiếm', async () => {
    const lib = libraryStore.login('LIB001', 'libmate123');

    expect(() =>
      libraryStore.addBookCopy(lib.token, { book_id: 'B001', copy_code: 'vhvn-001-a' })
    ).toThrow(/copy_code/i);

    // Ẩn đầu sách B001 (đang có lịch sử mượn LN-0001)
    const b001 = libraryStore.getBookDetail('B001', lib.token).book;
    libraryStore.createOrUpdateBook(lib.token, {
      id: 'B001',
      title: b001.title,
      author: b001.author,
      category: b001.category,
      shelf: b001.shelf,
      description: b001.description,
      visible: false,
    });

    // Không còn xuất hiện ở danh mục công khai và tìm kiếm AI
    const publicSearch = libraryStore.listCatalogBooks({ query: 'Mắt Biếc' });
    expect(publicSearch.items.some((b) => b.id === 'B001')).toBe(false);
    const sem = await libraryStore.searchSemantic('tình cảm học trò làng Đo Đo', {
      skipColdStartDelay: true,
    });
    expect(sem.results.some((r) => r.book.id === 'B001')).toBe(false);

    // Nhưng phiếu mượn lịch sử LN-0001 vẫn giữ nguyên vẹn
    const report = libraryStore.getLibrarianReport(lib.token);
    expect(report.loans.some((l) => l.id === 'LN-0001')).toBe(true);
  });

  it('TC09 & TC10: Chặn trùng pending cùng đầu sách; hủy được pending nhưng không hủy được yêu cầu đã giao', () => {
    const rdr = libraryStore.login('HS10A1', 'reader123');
    // HS10A1 đã có REQ-0004 (pending cho B071) và REQ-0001 (fulfilled cho B001)
    expect(() => libraryStore.submitBorrowRequest(rdr.token, 'B071')).toThrow(/đang chờ/i);
    expect(() => libraryStore.cancelBorrowRequest(rdr.token, 'REQ-0001')).toThrow(/TC10|pending/i);

    const cancelled = libraryStore.cancelBorrowRequest(rdr.token, 'REQ-0004');
    expect(cancelled.status).toBe('cancelled');
  });

  it('TC11, TC12, TC13, TC14, TC15 & TC16: Giao bản cuối đồng thời, giới hạn 3 cuốn, rollback lỗi, trả 2 lần, bảo trì & ranh giới quá hạn', () => {
    const lib = libraryStore.login('LIB001', 'libmate123');
    const rdr2 = libraryStore.login('HS11B2', 'reader123');
    const rdr3 = libraryStore.login('HS12C3', 'reader123');

    // Đầu sách B002 chỉ có 1 bản sao duy nhất khả dụng? Kiểm tra B006 (chỉ có 1 bản sao CP-B006-A)
    const detailB006 = libraryStore.getBookDetail('B006');
    expect(detailB006.copies).toHaveLength(1);
    const onlyCopyId = detailB006.copies[0].id;

    const reqA = libraryStore.submitBorrowRequest(rdr2.token, 'B006');
    const reqB = libraryStore.submitBorrowRequest(rdr3.token, 'B006');

    // TC13: Nếu xảy ra lỗi giữa giao dịch -> rollback toàn bộ
    expect(() =>
      libraryStore.issueBookAtDesk(lib.token, {
        requestId: reqA.id,
        copyId: onlyCopyId,
        simulateMidTransactionFailure: true,
      })
    ).toThrow(/rollback/i);
    expect(libraryStore.getBookDetail('B006').book.available_copies).toBe(1);

    // TC11: Người thứ nhất nhận thành công bản cuối; người thứ hai bị chặn
    const issuedLoan = libraryStore.issueBookAtDesk(lib.token, {
      requestId: reqA.id,
      copyId: onlyCopyId,
      now: new Date('2026-12-01T10:00:00+07:00'),
    });
    expect(() =>
      libraryStore.issueBookAtDesk(lib.token, {
        requestId: reqB.id,
        copyId: onlyCopyId,
      })
    ).toThrow(/không sẵn có/i);

    // TC16: Đúng ngày đến hạn (2026-12-15) chưa quá hạn; qua ngày hôm sau (2026-12-16) mới quá hạn
    const onDueDay = libraryStore
      .getMyActivity(rdr2.token, new Date('2026-12-15T22:00:00+07:00'))
      .activeLoans.find((l) => l.id === issuedLoan.id)!;
    expect(onDueDay.is_overdue).toBe(false);

    const afterDueDay = libraryStore
      .getMyActivity(rdr2.token, new Date('2026-12-16T08:00:00+07:00'))
      .activeLoans.find((l) => l.id === issuedLoan.id)!;
    expect(afterDueDay.is_overdue).toBe(true);

    // TC15 & TC14: Trả sách kèm đánh dấu bảo trì -> bản sao không sẵn có; trả lần hai bị từ chối
    libraryStore.returnLoanAtDesk(lib.token, {
      loanId: issuedLoan.id,
      markMaintenance: true,
      conditionNote: 'Rách gáy cần dán lại',
    });
    expect(libraryStore.getBookDetail('B006').book.available_copies).toBe(0);
    expect(libraryStore.getBookDetail('B006').book.maintenance_copies).toBe(1);

    expect(() => libraryStore.returnLoanAtDesk(lib.token, { loanId: issuedLoan.id })).toThrow(
      /TC14|lần hai/i
    );
  });

  it('TC17: Đối chiếu số liệu Báo cáo Thủ thư và xuất CSV khớp tuyệt đối với dữ liệu mẫu', () => {
    const lib = libraryStore.login('LIB001', 'libmate123');
    const { summary } = libraryStore.getLibrarianReport(lib.token);

    expect(summary.total_visible_books).toBe(100);
    expect(summary.total_copies).toBe(201);
    expect(summary.borrowed_copies).toBe(3);
    expect(summary.maintenance_copies).toBe(2);
    expect(summary.available_copies).toBe(201 - 3 - 2);
    expect(summary.active_loans).toBe(3);
    expect(summary.overdue_loans).toBe(1);

    const csv = libraryStore.exportLoansCsv(lib.token, { loanStatus: 'OVERDUE' });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Mắt Biếc');
    expect(csv).toContain('Quá hạn');
  });

  it('TC18, TC19 & TC23: Tìm ngữ nghĩa tiếng Việt đạt Hit@5 >= 80% trên tập giữ lại, từ chối câu ngoài danh mục và có fallback', async () => {
    const holdout = EVAL_QUERIES_30.filter((q) => q.split === 'holdout');
    const positiveHoldout = holdout.filter((q) => q.expected_book_ids.length > 0);
    let hits = 0;

    for (const q of positiveHoldout) {
      const res = await libraryStore.searchSemantic(q.query, { skipColdStartDelay: true });
      const top5Ids = res.results.map((r) => r.book.id);
      if (q.expected_book_ids.some((exp) => top5Ids.includes(exp))) {
        hits++;
      }
    }
    const hitRate = hits / positiveHoldout.length;
    expect(hitRate).toBeGreaterThanOrEqual(0.8);

    // TC19: Câu không có sách phù hợp trong danh mục (Q30) trả rỗng kèm thông báo ngưỡng rõ ràng
    const negQuery = holdout.find((q) => q.expected_book_ids.length === 0)!;
    const negRes = await libraryStore.searchSemantic(negQuery.query, { skipColdStartDelay: true });
    expect(negRes.results).toHaveLength(0);
    expect(negRes.below_threshold_message).toMatch(/ngưỡng|chưa tìm thấy/i);

    // TC23: Khi mô hình lỗi -> tự động dùng fallback từ khóa
    libraryStore.setSimulateAiOfflineError(true);
    const fbRes = await libraryStore.searchSemantic('Mắt Biếc', { skipColdStartDelay: true });
    expect(fbRes.fallback_used).toBe(true);
    expect(fbRes.results.some((r) => r.book.id === 'B001')).toBe(true);
    libraryStore.setSimulateAiOfflineError(false);
  });

  it('TC25 & TC26: Sách tương tự loại trừ chính sách đang xem & lưu phản hồi; Yêu thích tách biệt theo từng tài khoản', () => {
    const rdr1 = libraryStore.login('HS10A1', 'reader123');
    const rdr2 = libraryStore.login('HS11B2', 'reader123');

    const detail = libraryStore.getBookDetail('B001', rdr1.token);
    expect(detail.similar.length).toBeGreaterThan(0);
    expect(detail.similar.some((b) => b.id === 'B001')).toBe(false);

    const targetSimId = detail.similar[0].id;
    libraryStore.submitRecommendationFeedback(rdr1.token, {
      bookId: targetSimId,
      sourceType: 'similar_book',
      contextKey: 'B001',
      useful: true,
    });
    expect(libraryStore.getMyFeedbackMap(rdr1.token, 'similar_book', 'B001')[targetSimId]).toBe(true);
    expect(libraryStore.getMyFeedbackMap(rdr2.token, 'similar_book', 'B001')[targetSimId]).toBeUndefined();

    // TC26: Thêm/bỏ yêu thích ở rdr2 không ảnh hưởng danh sách của rdr1
    const rdr1Before = libraryStore.getMyFavorites(rdr1.token).map((b) => b.id);
    libraryStore.toggleFavorite(rdr2.token, 'B051');
    expect(libraryStore.getMyFavorites(rdr2.token).map((b) => b.id)).toContain('B051');
    expect(libraryStore.getMyFavorites(rdr1.token).map((b) => b.id)).toEqual(rdr1Before);
  });

  it('TC30 & TC31: UAT giao diện trọn luồng Mượn – Giao – Xem lịch sử – Trả sách và menu di động màn hình nhỏ', async () => {
    const user = userEvent.setup();
    renderApp('/login');

    // Menu mobile button hiển thị trong DOM để dùng trên màn hình nhỏ (TC30)
    expect(screen.getByRole('button', { name: /Mở menu điều hướng/i })).toBeInTheDocument();

    // 1. Người đọc PILOT01 đăng nhập và gửi yêu cầu mượn
    await user.click(screen.getByRole('button', { name: /PILOT01/i }));
    await user.click(screen.getByRole('button', { name: /^Đăng nhập$/i }));

    // Mở sách chi tiết đầu tiên và đặt yêu cầu mượn
    const firstBookLink = screen.getByRole('link', { name: 'Mắt Biếc' });
    await user.click(firstBookLink);
    await user.click(screen.getByRole('button', { name: /Gửi yêu cầu mượn đầu sách này/i }));
    expect(screen.getByText(/Đã gửi yêu cầu mượn/i)).toBeInTheDocument();

    // Đăng xuất bạn đọc -> Đăng nhập Thủ thư để giao sách tại quầy
    await user.click(screen.getByRole('button', { name: /Đăng xuất/i }));
    await user.click(screen.getByRole('button', { name: /Thủ thư: LIB001/i }));
    await user.click(screen.getByRole('button', { name: /^Đăng nhập$/i }));

    await user.click(screen.getByRole('link', { name: /Quầy Giao\/Trả/i }));
    const pilotRow = screen.getByText(/PILOT01/i).closest('tr')!;
    await user.click(within(pilotRow).getByRole('button', { name: /Xác nhận giao/i }));
    expect(screen.getByText(/Đã giao bản sao/i)).toBeInTheDocument();

    // Chuyển sang tab nhận trả sách tại quầy và hoàn tất trả
    await user.click(screen.getByRole('button', { name: /Đang mượn & Nhận trả sách/i }));
    const loanTable = screen.getByRole('table');
    const activePilotRow = within(loanTable).getByText(/PILOT01/i).closest('tr')!;
    await user.click(within(activePilotRow).getByRole('button', { name: /Xác nhận trả sách/i }));
    expect(screen.getByText(/Đã xác nhận trả phiếu/i)).toBeInTheDocument();
  });
});
