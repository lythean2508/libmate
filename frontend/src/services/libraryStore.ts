import { SEED_BOOKS, SEED_COPIES } from '../data/seedCatalog';
import { migrateCatalog } from './catalogMigration';
import type {
  AuditLogEntry,
  AuthSession,
  Book,
  BookCopy,
  BookEmbeddingRecord,
  BookWithAvailability,
  BorrowRequest,
  BorrowRequestView,
  CopyStatus,
  FavoriteItem,
  Loan,
  LoanView,
  RecommendationFeedback,
  ReportSummary,
  SemanticSearchResponse,
  StoredUser,
  User,
} from '../types/library';
import {
  addDaysIso,
  buildCsvUtf8Bom,
  computeDaysRemaining,
  countWords,
  formatDateVi,
  isLoanOverdue,
  simpleContentHash,
} from '../utils/vietnamese';
import {
  MODEL_REVISION,
  computeBookContentHash,
  getSimilarBooksFromCatalog,
  runKeywordSearch,
  runLocalSemanticSearch,
} from './semanticEngine';

export const MAX_ACTIVE_LOANS = Number(import.meta.env?.VITE_BORROW_LIMIT ?? 3);
export const DEFAULT_LOAN_DAYS = Number(import.meta.env?.VITE_LOAN_DAYS ?? 14);
const STORAGE_KEY = 'libmate_store_v1';
const SESSION_KEY = 'libmate_session_v1';

interface DatabaseState {
  users: StoredUser[];
  books: Book[];
  copies: BookCopy[];
  requests: BorrowRequest[];
  loans: Loan[];
  favorites: FavoriteItem[];
  feedbacks: RecommendationFeedback[];
  embeddings: BookEmbeddingRecord[];
  auditLogs: AuditLogEntry[];
  aiModelWarm: boolean;
  simulateAiOfflineError: boolean;
}

function hashPassword(rawPassword: string): string {
  return `pbkdf2_mock$${simpleContentHash(`libmate-salt:${rawPassword}`)}`;
}

function buildInitialUsers(): StoredUser[] {
  const baseUsers: StoredUser[] = [
    {
      id: 'U-LIB-01',
      reader_code: 'LIB001',
      name: 'Lý Thế An (Thủ thư)',
      role: 'librarian',
      status: 'active',
      grade_or_dept: 'Phòng Thư viện',
      password_hash: hashPassword('libmate123'),
    },
    {
      id: 'U-RDR-01',
      reader_code: 'HS10A1',
      name: 'Nguyễn Minh Anh',
      role: 'reader',
      status: 'active',
      grade_or_dept: 'Lớp 10A1',
      password_hash: hashPassword('reader123'),
    },
    {
      id: 'U-RDR-02',
      reader_code: 'HS11B2',
      name: 'Trần Quốc Bảo',
      role: 'reader',
      status: 'active',
      grade_or_dept: 'Lớp 11B2',
      password_hash: hashPassword('reader123'),
    },
    {
      id: 'U-RDR-03',
      reader_code: 'HS12C3',
      name: 'Lê Hoàng Nam',
      role: 'reader',
      status: 'active',
      grade_or_dept: 'Lớp 12C3',
      password_hash: hashPassword('reader123'),
    },
    {
      id: 'U-LCK-01',
      reader_code: 'HSKHOA',
      name: 'Phạm Thảo Vy (Tài khoản khóa)',
      role: 'reader',
      status: 'locked',
      grade_or_dept: 'Lớp 10A2',
      password_hash: hashPassword('reader123'),
    },
  ];

  // 10 tài khoản thử nghiệm Pilot (T37: "Ít nhất 10 người được hướng dẫn và ghi tác vụ tìm sách, gửi yêu cầu. Dùng tài khoản thử.")
  for (let i = 1; i <= 10; i++) {
    const code = `PILOT${String(i).padStart(2, '0')}`;
    baseUsers.push({
      id: `U-${code}`,
      reader_code: code,
      name: `Người dùng thử Pilot #${String(i).padStart(2, '0')}`,
      role: 'reader',
      status: 'active',
      grade_or_dept: `Nhóm Pilot Tuần 7`,
      password_hash: hashPassword('pilot123'),
    });
  }

  return baseUsers;
}

function buildInitialState(now: Date = new Date()): DatabaseState {
  const books: Book[] = structuredClone(SEED_BOOKS);
  const copies: BookCopy[] = structuredClone(SEED_COPIES);
  const users = buildInitialUsers();

  const nowIso = now.toISOString();
  const twentyDaysAgo = addDaysIso(nowIso, -20);
  const sixDaysAgo = addDaysIso(nowIso, -6);
  const twelveDaysAgo = addDaysIso(nowIso, -12);

  // Đồng bộ với 3 bản sao trạng thái 'borrowed' trong SEED_COPIES: B001-A, B002-A, B061-A
  const loans: Loan[] = [
    {
      id: 'LN-0001',
      user_id: 'U-RDR-01',
      copy_id: 'CP-B001-A',
      book_id: 'B001',
      request_id: 'REQ-0001',
      issued_by: 'U-LIB-01',
      issued_at: twentyDaysAgo,
      due_at: addDaysIso(twentyDaysAgo, DEFAULT_LOAN_DAYS), // Quá hạn 6 ngày
      returned_at: null,
    },
    {
      id: 'LN-0002',
      user_id: 'U-RDR-01',
      copy_id: 'CP-B002-A',
      book_id: 'B002',
      request_id: 'REQ-0002',
      issued_by: 'U-LIB-01',
      issued_at: sixDaysAgo,
      due_at: addDaysIso(sixDaysAgo, DEFAULT_LOAN_DAYS), // Còn 8 ngày
      returned_at: null,
    },
    {
      id: 'LN-0003',
      user_id: 'U-RDR-02',
      copy_id: 'CP-B061-A',
      book_id: 'B061',
      request_id: 'REQ-0003',
      issued_by: 'U-LIB-01',
      issued_at: twelveDaysAgo,
      due_at: addDaysIso(twelveDaysAgo, DEFAULT_LOAN_DAYS), // Sắp đến hạn (còn 2 ngày)
      returned_at: null,
    },
    {
      id: 'LN-0004',
      user_id: 'U-RDR-01',
      copy_id: 'CP-B021-A',
      book_id: 'B021',
      issued_by: 'U-LIB-01',
      issued_at: addDaysIso(nowIso, -30),
      due_at: addDaysIso(nowIso, -16),
      returned_at: addDaysIso(nowIso, -18),
      return_note: 'Trả đúng hạn, sách nguyên vẹn',
    },
  ];

  const requests: BorrowRequest[] = [
    {
      id: 'REQ-0001',
      user_id: 'U-RDR-01',
      book_id: 'B001',
      status: 'fulfilled',
      created_at: twentyDaysAgo,
      resolved_at: twentyDaysAgo,
      handled_by: 'U-LIB-01',
    },
    {
      id: 'REQ-0002',
      user_id: 'U-RDR-01',
      book_id: 'B002',
      status: 'fulfilled',
      created_at: sixDaysAgo,
      resolved_at: sixDaysAgo,
      handled_by: 'U-LIB-01',
    },
    {
      id: 'REQ-0003',
      user_id: 'U-RDR-02',
      book_id: 'B061',
      status: 'fulfilled',
      created_at: twelveDaysAgo,
      resolved_at: twelveDaysAgo,
      handled_by: 'U-LIB-01',
    },
    {
      id: 'REQ-0004',
      user_id: 'U-RDR-01',
      book_id: 'B071',
      status: 'pending',
      created_at: addDaysIso(nowIso, -1),
    },
    {
      id: 'REQ-0005',
      user_id: 'U-RDR-02',
      book_id: 'B031',
      status: 'pending',
      created_at: nowIso,
    },
  ];

  const favorites: FavoriteItem[] = [
    { user_id: 'U-RDR-01', book_id: 'B071', created_at: nowIso },
    { user_id: 'U-RDR-01', book_id: 'B031', created_at: nowIso },
  ];

  const embeddings: BookEmbeddingRecord[] = books.map((b) => ({
    book_id: b.id,
    content_hash: computeBookContentHash(b as unknown as BookWithAvailability),
    model_revision: MODEL_REVISION,
    status: 'ready',
    updated_at: nowIso,
  }));

  const auditLogs: AuditLogEntry[] = [
    {
      id: 'AUD-0001',
      actor_id: 'U-LIB-01',
      actor_name: 'Lý Thế An (Thủ thư)',
      action: 'INIT_SEED',
      entity_type: 'book',
      entity_id: 'CATALOG-100',
      detail: 'Khởi tạo danh mục 100 đầu sách và 201 bản sao thử nghiệm',
      timestamp: nowIso,
    },
  ];

  return {
    users,
    books,
    copies,
    requests,
    loans,
    favorites,
    feedbacks: [],
    embeddings,
    auditLogs,
    aiModelWarm: false,
    simulateAiOfflineError: false,
  };
}

function toPublicUser(u: StoredUser): User {
  return {
    id: u.id,
    reader_code: u.reader_code,
    name: u.name,
    role: u.role,
    status: u.status,
    grade_or_dept: u.grade_or_dept,
  };
}

class LibraryService {
  private state: DatabaseState;
  private activeTokens = new Map<string, AuthSession>();
  private issueLock = false;

  constructor() {
    this.state = this.loadState();
    this.restoreSession();
  }

  private loadState(): DatabaseState {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const previous = JSON.parse(raw) as DatabaseState;
          const migrated = migrateCatalog(previous);
          if (migrated !== previous) this.saveState(migrated);
          return migrated;
        }
      }
    } catch {
      // Ignore storage error and use clean seed
    }
    const fresh = buildInitialState();
    this.saveState(fresh);
    return fresh;
  }

  private saveState(nextState: DatabaseState = this.state): void {
    this.state = nextState;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      }
    } catch {
      // Ignore quota errors in test env
    }
  }

  private restoreSession(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          const session = JSON.parse(raw) as AuthSession;
          if (new Date(session.expires_at).getTime() > Date.now()) {
            this.activeTokens.set(session.token, session);
          } else {
            localStorage.removeItem(SESSION_KEY);
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  public resetToSeed(now: Date = new Date()): void {
    this.activeTokens.clear();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
    this.saveState(buildInitialState(now));
  }

  // ==================== AUTH & PHÂN QUYỀN (F03, T07, TC01, TC02, TC03, TC04) ====================

  public login(readerCode: string, password: string): AuthSession {
    const normalizedCode = readerCode.trim().toUpperCase();
    const found = this.state.users.find((u) => u.reader_code.toUpperCase() === normalizedCode);
    if (!found || found.password_hash !== hashPassword(password)) {
      throw new Error('Mã người đọc hoặc mật khẩu không đúng.');
    }
    if (found.status === 'locked') {
      throw new Error('Tài khoản này đang bị tạm khóa. Vui lòng liên hệ thủ thư tại quầy.');
    }

    const session: AuthSession = {
      token: `tok_${simpleContentHash(`${found.id}:${Date.now()}:${Math.random()}`)}`,
      user: toPublicUser(found),
      expires_at: addDaysIso(new Date().toISOString(), 1),
    };

    this.activeTokens.set(session.token, session);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
    return session;
  }

  public logout(token?: string | null): void {
    if (token) {
      this.activeTokens.delete(token);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  public getCurrentSession(): AuthSession | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthSession;
      if (!this.activeTokens.has(parsed.token)) return null;
      if (new Date(parsed.expires_at).getTime() <= Date.now()) {
        this.logout(parsed.token);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  public verifySession(token?: string | null): User {
    if (!token || !this.activeTokens.has(token)) {
      throw new Error('Phiên đăng nhập không hợp lệ hoặc đã đăng xuất.');
    }
    const session = this.activeTokens.get(token)!;
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      this.logout(token);
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }
    return session.user;
  }

  private requireLibrarian(token?: string | null): User {
    const user = this.verifySession(token);
    if (user.role !== 'librarian') {
      throw new Error('Từ chối truy cập: Thao tác này chỉ dành cho Thủ thư.');
    }
    return user;
  }

  /**
   * Tự đăng ký tài khoản công khai (T10 / TC02):
   * Dù đầu vào cố tình truyền `role: 'librarian'`, hệ thống luôn ép cứng `role = 'reader'`.
   */
  public registerReader(input: {
    reader_code: string;
    name: string;
    password: string;
    grade_or_dept?: string;
    role?: string; // Bị bỏ qua theo TC02
  }): User {
    const code = input.reader_code.trim().toUpperCase();
    const name = input.name.trim();
    if (!code || code.length < 4) {
      throw new Error('Mã người đọc phải có ít nhất 4 ký tự.');
    }
    if (!name) {
      throw new Error('Họ và tên không được để trống.');
    }
    if (!input.password || input.password.length < 6) {
      throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
    }
    if (this.state.users.some((u) => u.reader_code.toUpperCase() === code)) {
      throw new Error(`Mã người đọc "${code}" đã tồn tại trong hệ thống.`);
    }

    const newUser: StoredUser = {
      id: `U-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      reader_code: code,
      name,
      role: 'reader', // Khóa cứng vai trò người đọc (TC02)
      status: 'active',
      grade_or_dept: input.grade_or_dept?.trim() || 'Học sinh',
      password_hash: hashPassword(input.password),
    };

    this.state.users.push(newUser);
    this.saveState();
    return toPublicUser(newUser);
  }

  // ==================== DANH MỤC & KHO SÁCH (F04, F05, T08, T09, TC05..TC08, TC20, TC21) ====================

  private enrichBook(book: Book): BookWithAvailability {
    const bookCopies = this.state.copies.filter((c) => c.book_id === book.id);
    const available = bookCopies.filter((c) => c.status === 'available').length;
    const borrowed = bookCopies.filter((c) => c.status === 'borrowed').length;
    const maintenance = bookCopies.filter((c) => c.status === 'maintenance').length;
    const emb = this.state.embeddings.find((e) => e.book_id === book.id);
    const currentHash = computeBookContentHash(book as unknown as BookWithAvailability);
    const indexReady = emb && emb.status === 'ready' && emb.content_hash === currentHash;

    return {
      ...book,
      total_copies: bookCopies.length,
      available_copies: available,
      borrowed_copies: borrowed,
      maintenance_copies: maintenance,
      index_status: indexReady ? 'ready' : 'pending',
    };
  }

  public getCategories(): string[] {
    const set = new Set<string>();
    for (const b of this.state.books) {
      if (b.visible) set.add(b.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }

  public listCatalogBooks(params?: {
    query?: string;
    category?: string;
    onlyAvailable?: boolean;
    page?: number;
    pageSize?: number;
    includeHiddenForLibrarianToken?: string | null;
  }): {
    items: BookWithAvailability[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let canSeeHidden = false;
    if (params?.includeHiddenForLibrarianToken) {
      const u = this.requireLibrarian(params.includeHiddenForLibrarianToken);
      canSeeHidden = u.role === 'librarian';
    }

    const enriched = this.state.books.map((b) => this.enrichBook(b));
    let filtered: BookWithAvailability[];

    if (params?.query && params.query.trim()) {
      const pool = canSeeHidden ? enriched.map((b) => ({ ...b, visible: true })) : enriched;
      const matchedIds = new Set(
        runKeywordSearch(params.query, pool, {
          category: params.category,
          onlyAvailable: params.onlyAvailable,
        }).map((m) => m.id)
      );
      filtered = enriched.filter((b) => (canSeeHidden || b.visible) && matchedIds.has(b.id));
    } else {
      filtered = enriched.filter((b) => {
        if (!canSeeHidden && !b.visible) return false;
        if (params?.category && params.category !== 'ALL' && b.category !== params.category) return false;
        if (params?.onlyAvailable && b.available_copies <= 0) return false;
        return true;
      });
    }

    const pageSize = Math.max(params?.pageSize ?? 12, 1);
    const total = filtered.length;
    const totalPages = Math.max(Math.ceil(total / pageSize), 1);
    const page = Math.min(Math.max(params?.page ?? 1, 1), totalPages);
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public getBookDetail(bookId: string, token?: string | null): {
    book: BookWithAvailability;
    copies: BookCopy[];
    similar: BookWithAvailability[];
  } {
    const found = this.state.books.find((b) => b.id === bookId);
    if (!found) {
      throw new Error('Không tìm thấy đầu sách này.');
    }
    let isLibrarian = false;
    if (token) {
      try {
        isLibrarian = this.verifySession(token).role === 'librarian';
      } catch {
        isLibrarian = false;
      }
    }
    if (!found.visible && !isLibrarian) {
      throw new Error('Đầu sách này hiện đang tạm ẩn khỏi danh mục bạn đọc.');
    }

    const enrichedAll = this.state.books.map((b) => this.enrichBook(b));
    const enrichedTarget = enrichedAll.find((b) => b.id === bookId)!;
    const copies = this.state.copies.filter((c) => c.book_id === bookId);
    const similar = getSimilarBooksFromCatalog(enrichedTarget, enrichedAll, 4);

    return { book: enrichedTarget, copies, similar };
  }

  public createOrUpdateBook(
    token: string | null | undefined,
    payload: {
      id?: string;
      title: string;
      author: string;
      category: string;
      shelf: string;
      description: string;
      metadata_source?: string;
      visible?: boolean;
      autoReindex?: boolean;
    }
  ): BookWithAvailability {
    const librarian = this.requireLibrarian(token);
    const title = payload.title.trim();
    const author = payload.author.trim();
    const category = payload.category.trim();
    const shelf = payload.shelf.trim();
    const description = payload.description.trim();

    if (!title || !author || !category || !shelf) {
      throw new Error('Vui lòng nhập đầy đủ Tên sách, Tác giả, Chủ đề và Kệ sách.');
    }
    if (/<script\b/i.test(`${title} ${author} ${description}`)) {
      throw new Error('Dữ liệu đầu vào chứa thẻ kịch bản không hợp lệ (chặn XSS - TC27).');
    }

    const nowIso = new Date().toISOString();
    const wc = countWords(description);
    const shouldAutoReindex = payload.autoReindex ?? true;

    let targetBook: Book;
    if (payload.id) {
      const existing = this.state.books.find((b) => b.id === payload.id);
      if (!existing) throw new Error('Không tìm thấy đầu sách cần cập nhật.');
      existing.title = title;
      existing.author = author;
      existing.category = category;
      existing.shelf = shelf;
      existing.description = description;
      existing.word_count = wc;
      existing.missing_description = wc < 80;
      if (payload.metadata_source !== undefined) {
        existing.metadata_source = payload.metadata_source.trim() || existing.metadata_source;
      }
      if (payload.visible !== undefined) {
        existing.visible = payload.visible;
      }
      existing.updated_at = nowIso;
      targetBook = existing;

      // Đánh dấu chỉ mục AI pending trước khi cập nhật vector mới (T30 / TC20)
      const emb = this.state.embeddings.find((e) => e.book_id === existing.id);
      const nextHash = computeBookContentHash(existing as unknown as BookWithAvailability);
      if (emb) {
        emb.status = shouldAutoReindex ? 'ready' : 'pending';
        emb.content_hash = shouldAutoReindex ? nextHash : emb.content_hash;
        emb.updated_at = nowIso;
      }

      this.logAudit(librarian, 'UPDATE_BOOK', 'book', existing.id, `Cập nhật đầu sách "${existing.title}" (visible=${existing.visible})`);
    } else {
      const nextNum = this.state.books.length + 1;
      const id = `B${String(nextNum).padStart(3, '0')}`;
      targetBook = {
        id,
        code: `LIB-${String(nextNum).padStart(3, '0')}`,
        title,
        author,
        category,
        shelf,
        description,
        word_count: wc,
        missing_description: wc < 80,
        metadata_source:
          payload.metadata_source?.trim() ||
          'Thủ thư biên tập nội bộ tại trường (metadata được phép sử dụng)',
        license_verified: true,
        visible: payload.visible ?? true,
        created_at: nowIso,
        updated_at: nowIso,
      };
      this.state.books.unshift(targetBook);
      this.state.embeddings.push({
        book_id: id,
        content_hash: computeBookContentHash(targetBook as unknown as BookWithAvailability),
        model_revision: MODEL_REVISION,
        status: shouldAutoReindex ? 'ready' : 'pending',
        updated_at: nowIso,
      });
      this.logAudit(librarian, 'CREATE_BOOK', 'book', id, `Thêm đầu sách mới "${title}"`);
    }

    this.saveState();
    return this.enrichBook(targetBook);
  }

  public rebuildEmbeddingForBook(token: string | null | undefined, bookId: string): BookWithAvailability {
    const librarian = this.requireLibrarian(token);
    const book = this.state.books.find((b) => b.id === bookId);
    if (!book) throw new Error('Không tìm thấy đầu sách.');
    const nextHash = computeBookContentHash(book as unknown as BookWithAvailability);
    const nowIso = new Date().toISOString();
    const existing = this.state.embeddings.find((e) => e.book_id === bookId);
    if (existing) {
      existing.content_hash = nextHash;
      existing.model_revision = MODEL_REVISION;
      existing.status = 'ready';
      existing.updated_at = nowIso;
    } else {
      this.state.embeddings.push({
        book_id: bookId,
        content_hash: nextHash,
        model_revision: MODEL_REVISION,
        status: 'ready',
        updated_at: nowIso,
      });
    }
    this.logAudit(librarian, 'REINDEX_BOOK', 'book', bookId, `Cập nhật vector AI cho "${book.title}"`);
    this.saveState();
    return this.enrichBook(book);
  }

  public addBookCopy(
    token: string | null | undefined,
    payload: { book_id: string; copy_code: string; status?: CopyStatus; condition_note?: string }
  ): BookCopy {
    const librarian = this.requireLibrarian(token);
    const book = this.state.books.find((b) => b.id === payload.book_id);
    if (!book) throw new Error('Đầu sách không tồn tại.');

    const cleanCode = payload.copy_code.trim().toUpperCase();
    if (!cleanCode) {
      throw new Error('Trường lỗi [copy_code]: Mã bản sao không được để trống.');
    }
    if (this.state.copies.some((c) => c.copy_code.toUpperCase() === cleanCode)) {
      throw new Error(`Trường lỗi [copy_code]: Mã bản sao "${cleanCode}" đã tồn tại. Mỗi bản sao vật lý phải có mã duy nhất.`);
    }

    const status: CopyStatus = payload.status === 'maintenance' ? 'maintenance' : 'available';
    const newCopy: BookCopy = {
      id: `CP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      book_id: book.id,
      copy_code: cleanCode,
      status,
      condition_note: payload.condition_note?.trim() || 'Tốt',
    };

    this.state.copies.push(newCopy);
    this.logAudit(librarian, 'ADD_COPY', 'copy', newCopy.id, `Thêm bản sao ${cleanCode} cho sách "${book.title}"`);
    this.saveState();
    return newCopy;
  }

  public updateCopyStatus(
    token: string | null | undefined,
    copyId: string,
    nextStatus: 'available' | 'maintenance',
    conditionNote?: string
  ): BookCopy {
    const librarian = this.requireLibrarian(token);
    const copy = this.state.copies.find((c) => c.id === copyId);
    if (!copy) throw new Error('Không tìm thấy bản sao.');
    if (copy.status === 'borrowed') {
      throw new Error('Bản sao đang được mượn — vui lòng thực hiện xác nhận trả sách tại Quầy trước khi đổi trạng thái.');
    }
    copy.status = nextStatus;
    if (conditionNote !== undefined) {
      copy.condition_note = conditionNote.trim() || copy.condition_note;
    }
    this.logAudit(librarian, 'UPDATE_COPY', 'copy', copy.id, `Đổi trạng thái ${copy.copy_code} -> ${nextStatus}`);
    this.saveState();
    return copy;
  }

  // ==================== YÊU CẦU MƯỢN & GIAO / TRẢ SÁCH (F06, F07, F08, T13..T20, TC09..TC16) ====================

  public submitBorrowRequest(token: string | null | undefined, bookId: string): BorrowRequest {
    const user = this.verifySession(token);
    const storedUser = this.state.users.find((u) => u.id === user.id);
    if (!storedUser || storedUser.status === 'locked') {
      throw new Error('Tài khoản đang bị khóa, không thể gửi yêu cầu mượn.');
    }

    const book = this.state.books.find((b) => b.id === bookId && b.visible);
    if (!book) {
      throw new Error('Đầu sách không khả dụng để đặt yêu cầu.');
    }

    // Chặn trùng yêu cầu đang chờ cùng đầu sách (TC09)
    const duplicatePending = this.state.requests.find(
      (r) => r.user_id === user.id && r.book_id === bookId && r.status === 'pending'
    );
    if (duplicatePending) {
      throw new Error('Bạn đã có một yêu cầu đang chờ xử lý cho đầu sách này.');
    }

    const activeLoansCount = this.state.loans.filter(
      (l) => l.user_id === user.id && l.returned_at === null
    ).length;
    if (activeLoansCount >= MAX_ACTIVE_LOANS) {
      throw new Error(`Bạn đang mượn ${activeLoansCount}/${MAX_ACTIVE_LOANS} cuốn tối đa. Vui lòng trả sách trước khi mượn thêm.`);
    }

    const enriched = this.enrichBook(book);
    if (enriched.available_copies <= 0) {
      throw new Error('Hiện không còn bản sao sẵn có trên kệ cho đầu sách này.');
    }

    const req: BorrowRequest = {
      id: `REQ-${String(this.state.requests.length + 1).padStart(4, '0')}`,
      user_id: user.id,
      book_id: bookId,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    this.state.requests.unshift(req);
    this.saveState();
    return req;
  }

  public cancelBorrowRequest(token: string | null | undefined, requestId: string): BorrowRequest {
    const user = this.verifySession(token);
    const req = this.state.requests.find((r) => r.id === requestId);
    if (!req) throw new Error('Không tìm thấy yêu cầu mượn.');
    if (req.user_id !== user.id) {
      throw new Error('Bạn không có quyền hủy yêu cầu của người đọc khác (TC04).');
    }
    if (req.status !== 'pending') {
      throw new Error('Chỉ được hủy yêu cầu đang ở trạng thái Đang chờ (pending). Yêu cầu đã giao không thể hủy tại đây (TC10).');
    }

    req.status = 'cancelled';
    req.resolved_at = new Date().toISOString();
    this.saveState();
    return req;
  }

  /**
   * Giao sách tại quầy trong một giao dịch nguyên tử (F07 / T14 / T17 / TC11 / TC12 / TC13):
   * - Kiểm tra bản sao thuộc đúng đầu sách và còn `available` (chống giao trùng bản cuối TC11).
   * - Kiểm tra lại giới hạn mượn `<= MAX_ACTIVE_LOANS` ngay tại thời điểm giao (TC12).
   * - Nếu có bất kỳ lỗi nào thì rollback toàn bộ, không tạo phiếu mồ côi (TC13).
   */
  public issueBookAtDesk(
    token: string | null | undefined,
    payload: { requestId: string; copyId: string; now?: Date; simulateMidTransactionFailure?: boolean }
  ): LoanView {
    const librarian = this.requireLibrarian(token);
    if (this.issueLock) {
      throw new Error('Hệ thống đang xử lý một giao dịch giao sách khác, vui lòng thử lại.');
    }

    this.issueLock = true;
    const snapshot = structuredClone(this.state);
    try {
      const req = this.state.requests.find((r) => r.id === payload.requestId);
      if (!req) throw new Error('Không tìm thấy yêu cầu mượn.');
      if (req.status !== 'pending') {
        throw new Error(`Yêu cầu ${req.id} không còn ở trạng thái chờ (hiện tại: ${req.status}).`);
      }

      const reader = this.state.users.find((u) => u.id === req.user_id);
      if (!reader || reader.status === 'locked') {
        throw new Error('Tài khoản người đọc đang bị khóa, không thể giao sách.');
      }

      // Kiểm tra lại số sách đang mượn ngay lúc giao (TC12)
      const activeLoans = this.state.loans.filter(
        (l) => l.user_id === reader.id && l.returned_at === null
      ).length;
      if (activeLoans >= MAX_ACTIVE_LOANS) {
        throw new Error(
          `Người đọc đã đạt giới hạn mượn tối đa (${activeLoans}/${MAX_ACTIVE_LOANS} cuốn đang mượn) tại thời điểm giao sách.`
        );
      }

      const copy = this.state.copies.find((c) => c.id === payload.copyId);
      if (!copy || copy.book_id !== req.book_id) {
        throw new Error('Bản sao được chọn không thuộc đầu sách của yêu cầu này.');
      }
      if (copy.status !== 'available') {
        throw new Error(
          `Bản sao ${copy.copy_code} hiện không sẵn có (trạng thái: ${copy.status}) — có thể vừa được giao cho phiếu khác hoặc đang bảo trì.`
        );
      }

      const activeLoanOnCopy = this.state.loans.find(
        (l) => l.copy_id === copy.id && l.returned_at === null
      );
      if (activeLoanOnCopy) {
        throw new Error(`Bản sao ${copy.copy_code} đang gắn với phiếu mượn chưa trả ${activeLoanOnCopy.id}.`);
      }

      const issuedDate = payload.now ?? new Date();
      const issuedIso = issuedDate.toISOString();
      const dueIso = addDaysIso(issuedIso, DEFAULT_LOAN_DAYS);

      const newLoan: Loan = {
        id: `LN-${String(this.state.loans.length + 1).padStart(4, '0')}`,
        user_id: reader.id,
        copy_id: copy.id,
        book_id: req.book_id,
        request_id: req.id,
        issued_by: librarian.id,
        issued_at: issuedIso,
        due_at: dueIso,
        returned_at: null,
      };

      copy.status = 'borrowed';
      req.status = 'fulfilled';
      req.resolved_at = issuedIso;
      req.handled_by = librarian.id;
      this.state.loans.unshift(newLoan);

      if (payload.simulateMidTransactionFailure) {
        throw new Error('Lỗi mô phỏng giữa giao dịch — thực hiện rollback toàn bộ (TC13).');
      }

      this.logAudit(
        librarian,
        'ISSUE_LOAN',
        'loan',
        newLoan.id,
        `Giao bản sao ${copy.copy_code} cho ${reader.reader_code} (hạn trả ${formatDateVi(dueIso)})`
      );
      this.saveState();
      return this.toLoanView(newLoan, issuedDate);
    } catch (err) {
      // Rollback toàn bộ trạng thái về snapshot trước giao dịch (TC13)
      this.saveState(snapshot);
      throw err;
    } finally {
      this.issueLock = false;
    }
  }

  public rejectBorrowRequest(
    token: string | null | undefined,
    payload: { requestId: string; reason: string }
  ): BorrowRequest {
    const librarian = this.requireLibrarian(token);
    const reason = payload.reason.trim();
    if (!reason) {
      throw new Error('Vui lòng nhập lý do từ chối yêu cầu để người đọc nắm rõ.');
    }
    const req = this.state.requests.find((r) => r.id === payload.requestId);
    if (!req) throw new Error('Không tìm thấy yêu cầu mượn.');
    if (req.status !== 'pending') {
      throw new Error('Chỉ có thể từ chối yêu cầu đang chờ xử lý.');
    }

    req.status = 'rejected';
    req.rejection_reason = reason;
    req.resolved_at = new Date().toISOString();
    req.handled_by = librarian.id;

    this.logAudit(librarian, 'REJECT_REQUEST', 'request', req.id, `Từ chối yêu cầu ${req.id}: ${reason}`);
    this.saveState();
    return req;
  }

  /**
   * Xác nhận trả sách tại quầy (F08 / T20 / T22 / TC14 / TC15):
   * - Chống trả sách hai lần làm tăng tồn kho sai (TC14).
   * - Hỗ trợ gắn cờ `maintenance` nếu sách hư hỏng để không cho mượn nhầm (TC15).
   */
  public returnLoanAtDesk(
    token: string | null | undefined,
    payload: { loanId: string; markMaintenance?: boolean; conditionNote?: string; now?: Date }
  ): LoanView {
    const librarian = this.requireLibrarian(token);
    const loan = this.state.loans.find((l) => l.id === payload.loanId);
    if (!loan) throw new Error('Không tìm thấy phiếu mượn.');
    if (loan.returned_at !== null) {
      throw new Error(`Phiếu mượn ${loan.id} đã được ghi nhận trả trước đó — không thể trả lặp lần hai (TC14).`);
    }

    const copy = this.state.copies.find((c) => c.id === loan.copy_id);
    if (!copy) throw new Error('Không tìm thấy bản sao liên kết với phiếu mượn.');

    const now = payload.now ?? new Date();
    const returnedIso = now.toISOString();
    loan.returned_at = returnedIso;
    loan.return_note =
      payload.conditionNote?.trim() ||
      (payload.markMaintenance ? 'Chuyển sang bảo trì sau khi trả' : 'Trả sách bình thường');

    copy.status = payload.markMaintenance ? 'maintenance' : 'available';
    if (payload.conditionNote?.trim()) {
      copy.condition_note = payload.conditionNote.trim();
    } else if (payload.markMaintenance) {
      copy.condition_note = 'Cần kiểm tra / bảo trì trước khi đưa lại lên kệ';
    }

    this.logAudit(
      librarian,
      'RETURN_LOAN',
      'loan',
      loan.id,
      `Nhận trả bản sao ${copy.copy_code} -> trạng thái mới: ${copy.status}`
    );
    this.saveState();
    return this.toLoanView(loan, now);
  }

  // ==================== TRUY VẤN CÁ NHÂN & THỦ THƯ (TC04, T19, T31, T32) ====================

  private toLoanView(loan: Loan, now: Date = new Date()): LoanView {
    const book = this.state.books.find((b) => b.id === loan.book_id);
    const copy = this.state.copies.find((c) => c.id === loan.copy_id);
    const reader = this.state.users.find((u) => u.id === loan.user_id);

    return {
      ...loan,
      book_title: book?.title ?? loan.book_id,
      book_author: book?.author ?? '',
      copy_code: copy?.copy_code ?? loan.copy_id,
      copy_status: copy?.status ?? 'available',
      reader_name: reader?.name ?? loan.user_id,
      reader_code: reader?.reader_code ?? '',
      is_overdue: isLoanOverdue(loan.due_at, loan.returned_at, now),
      days_remaining: computeDaysRemaining(loan.due_at, now),
    };
  }

  private toRequestView(req: BorrowRequest): BorrowRequestView {
    const book = this.state.books.find((b) => b.id === req.book_id);
    const enriched = book ? this.enrichBook(book) : null;
    const reader = this.state.users.find((u) => u.id === req.user_id);
    const readerActiveLoans = this.state.loans.filter(
      (l) => l.user_id === req.user_id && l.returned_at === null
    ).length;

    return {
      ...req,
      book_title: book?.title ?? req.book_id,
      book_author: book?.author ?? '',
      book_shelf: book?.shelf ?? '',
      available_copies: enriched?.available_copies ?? 0,
      reader_name: reader?.name ?? req.user_id,
      reader_code: reader?.reader_code ?? '',
      reader_active_loans: readerActiveLoans,
    };
  }

  /**
   * Lịch sử mượn & yêu cầu của chính người đọc đang đăng nhập (T19 / TC04: không lộ dữ liệu người khác).
   */
  public getMyActivity(token: string | null | undefined, now: Date = new Date()): {
    activeLoans: LoanView[];
    loanHistory: LoanView[];
    requests: BorrowRequestView[];
  } {
    const user = this.verifySession(token);
    const myLoans = this.state.loans
      .filter((l) => l.user_id === user.id)
      .map((l) => this.toLoanView(l, now));

    return {
      activeLoans: myLoans.filter((l) => l.returned_at === null),
      loanHistory: myLoans.filter((l) => l.returned_at !== null),
      requests: this.state.requests
        .filter((r) => r.user_id === user.id)
        .map((r) => this.toRequestView(r)),
    };
  }

  public getLibrarianDeskData(token: string | null | undefined, now: Date = new Date()): {
    pendingRequests: BorrowRequestView[];
    recentRequests: BorrowRequestView[];
    activeLoans: LoanView[];
    availableCopiesByBook: Record<string, BookCopy[]>;
  } {
    this.requireLibrarian(token);
    const pendingRequests = this.state.requests
      .filter((r) => r.status === 'pending')
      .map((r) => this.toRequestView(r));
    const recentRequests = this.state.requests
      .filter((r) => r.status !== 'pending')
      .slice(0, 15)
      .map((r) => this.toRequestView(r));
    const activeLoans = this.state.loans
      .filter((l) => l.returned_at === null)
      .map((l) => this.toLoanView(l, now));

    const availableCopiesByBook: Record<string, BookCopy[]> = {};
    for (const c of this.state.copies) {
      if (c.status === 'available') {
        if (!availableCopiesByBook[c.book_id]) availableCopiesByBook[c.book_id] = [];
        availableCopiesByBook[c.book_id].push(c);
      }
    }

    return { pendingRequests, recentRequests, activeLoans, availableCopiesByBook };
  }

  // ==================== TÌM KIẾM AI LOCAL, PHẢN HỒI & YÊU THÍCH (F10, F11, F12, T25..T32) ====================

  public setSimulateAiOfflineError(flag: boolean): void {
    this.state.simulateAiOfflineError = flag;
    this.saveState();
  }

  public getAiRuntimeState(): { warm: boolean; simulateError: boolean; modelName: string } {
    return {
      warm: this.state.aiModelWarm,
      simulateError: this.state.simulateAiOfflineError,
      modelName: MODEL_REVISION,
    };
  }

  public async searchSemantic(
    query: string,
    options?: { onlyAvailable?: boolean; skipColdStartDelay?: boolean }
  ): Promise<SemanticSearchResponse> {
    let coldStartMs: number | undefined;
    if (!this.state.aiModelWarm && !this.state.simulateAiOfflineError) {
      const start = Date.now();
      if (!options?.skipColdStartDelay) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      coldStartMs = Math.max(Date.now() - start, 120);
      this.state.aiModelWarm = true;
      this.saveState();
    }

    const enrichedBooks = this.state.books.map((b) => this.enrichBook(b));
    const embMap = new Map<string, BookEmbeddingRecord>(
      this.state.embeddings.map((e) => [e.book_id, e])
    );

    return runLocalSemanticSearch(query, enrichedBooks, embMap, {
      onlyAvailable: options?.onlyAvailable,
      simulateAiFailure: this.state.simulateAiOfflineError,
      coldStartMs,
    });
  }

  public submitRecommendationFeedback(
    token: string | null | undefined,
    payload: {
      bookId: string;
      sourceType: 'semantic_search' | 'similar_book';
      contextKey: string;
      useful: boolean;
    }
  ): RecommendationFeedback {
    const user = this.verifySession(token);
    const existing = this.state.feedbacks.find(
      (f) =>
        f.user_id === user.id &&
        f.book_id === payload.bookId &&
        f.source_type === payload.sourceType &&
        f.context_key === payload.contextKey
    );

    if (existing) {
      existing.useful = payload.useful;
      existing.created_at = new Date().toISOString();
      this.saveState();
      return existing;
    }

    const item: RecommendationFeedback = {
      id: `FB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user_id: user.id,
      book_id: payload.bookId,
      source_type: payload.sourceType,
      context_key: payload.contextKey,
      useful: payload.useful,
      created_at: new Date().toISOString(),
    };
    this.state.feedbacks.push(item);
    this.saveState();
    return item;
  }

  public getMyFeedbackMap(
    token: string | null | undefined,
    sourceType: 'semantic_search' | 'similar_book',
    contextKey: string
  ): Record<string, boolean> {
    if (!token) return {};
    try {
      const user = this.verifySession(token);
      const out: Record<string, boolean> = {};
      for (const f of this.state.feedbacks) {
        if (f.user_id === user.id && f.source_type === sourceType && f.context_key === contextKey) {
          out[f.book_id] = f.useful;
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  public toggleFavorite(token: string | null | undefined, bookId: string): { favorited: boolean } {
    const user = this.verifySession(token);
    const idx = this.state.favorites.findIndex((f) => f.user_id === user.id && f.book_id === bookId);
    if (idx >= 0) {
      this.state.favorites.splice(idx, 1);
      this.saveState();
      return { favorited: false };
    }
    const book = this.state.books.find((b) => b.id === bookId && b.visible);
    if (!book) throw new Error('Không tìm thấy sách để thêm vào yêu thích.');
    this.state.favorites.push({
      user_id: user.id,
      book_id: bookId,
      created_at: new Date().toISOString(),
    });
    this.saveState();
    return { favorited: true };
  }

  public getMyFavorites(token: string | null | undefined): BookWithAvailability[] {
    const user = this.verifySession(token);
    const bookIds = new Set(
      this.state.favorites.filter((f) => f.user_id === user.id).map((f) => f.book_id)
    );
    return this.state.books
      .filter((b) => b.visible && bookIds.has(b.id))
      .map((b) => this.enrichBook(b));
  }

  // ==================== BÁO CÁO THỦ THƯ & XUẤT CSV (F09, T31, TC03, TC17) ====================

  public getLibrarianReport(
    token: string | null | undefined,
    filters?: { loanStatus?: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'RETURNED'; category?: string; now?: Date }
  ): {
    summary: ReportSummary;
    loans: LoanView[];
    auditLogs: AuditLogEntry[];
  } {
    this.requireLibrarian(token);
    const now = filters?.now ?? new Date();

    const visibleBooks = this.state.books.filter((b) => b.visible).length;
    const hiddenBooks = this.state.books.filter((b) => !b.visible).length;
    const availableCopies = this.state.copies.filter((c) => c.status === 'available').length;
    const borrowedCopies = this.state.copies.filter((c) => c.status === 'borrowed').length;
    const maintenanceCopies = this.state.copies.filter((c) => c.status === 'maintenance').length;

    const allLoanViews = this.state.loans.map((l) => this.toLoanView(l, now));
    const activeLoans = allLoanViews.filter((l) => l.returned_at === null);
    const overdueLoans = activeLoans.filter((l) => l.is_overdue);
    const pendingRequests = this.state.requests.filter((r) => r.status === 'pending').length;

    const filteredLoans = allLoanViews.filter((lv) => {
      if (filters?.category && filters.category !== 'ALL') {
        const book = this.state.books.find((b) => b.id === lv.book_id);
        if (book?.category !== filters.category) return false;
      }
      if (filters?.loanStatus === 'ACTIVE') return lv.returned_at === null;
      if (filters?.loanStatus === 'OVERDUE') return lv.is_overdue;
      if (filters?.loanStatus === 'RETURNED') return lv.returned_at !== null;
      return true;
    });

    return {
      summary: {
        total_visible_books: visibleBooks,
        total_hidden_books: hiddenBooks,
        total_copies: this.state.copies.length,
        available_copies: availableCopies,
        borrowed_copies: borrowedCopies,
        maintenance_copies: maintenanceCopies,
        active_loans: activeLoans.length,
        overdue_loans: overdueLoans.length,
        pending_requests: pendingRequests,
      },
      loans: filteredLoans,
      auditLogs: this.state.auditLogs.slice(0, 25),
    };
  }

  public exportLoansCsv(
    token: string | null | undefined,
    filters?: { loanStatus?: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'RETURNED'; category?: string; now?: Date }
  ): string {
    const { loans } = this.getLibrarianReport(token, filters);
    const rows = loans.map((l) => ({
      loan_id: l.id,
      reader_code: l.reader_code,
      reader_name: l.reader_name,
      book_title: l.book_title,
      copy_code: l.copy_code,
      issued_at: formatDateVi(l.issued_at),
      due_at: formatDateVi(l.due_at),
      returned_at: l.returned_at ? formatDateVi(l.returned_at) : 'Chưa trả',
      overdue_status: l.is_overdue ? 'Quá hạn' : l.returned_at ? 'Đã hoàn tất' : 'Đúng hạn',
    }));

    return buildCsvUtf8Bom(rows, [
      { key: 'loan_id', label: 'Mã phiếu' },
      { key: 'reader_code', label: 'Mã bạn đọc' },
      { key: 'reader_name', label: 'Họ tên bạn đọc' },
      { key: 'book_title', label: 'Tên đầu sách' },
      { key: 'copy_code', label: 'Mã bản sao' },
      { key: 'issued_at', label: 'Ngày mượn' },
      { key: 'due_at', label: 'Hạn trả' },
      { key: 'returned_at', label: 'Ngày trả thực tế' },
      { key: 'overdue_status', label: 'Tình trạng hạn' },
    ]);
  }

  public exportInventoryCsv(token: string | null | undefined): string {
    this.requireLibrarian(token);
    const rows = this.state.books.map((b) => {
      const en = this.enrichBook(b);
      return {
        id: en.id,
        title: en.title,
        author: en.author,
        category: en.category,
        shelf: en.shelf,
        visible: en.visible ? 'Hiển thị' : 'Đang ẩn',
        total_copies: en.total_copies,
        available_copies: en.available_copies,
        borrowed_copies: en.borrowed_copies,
        maintenance_copies: en.maintenance_copies,
      };
    });

    return buildCsvUtf8Bom(rows, [
      { key: 'id', label: 'Mã đầu sách' },
      { key: 'title', label: 'Tên sách' },
      { key: 'author', label: 'Tác giả' },
      { key: 'category', label: 'Chủ đề' },
      { key: 'shelf', label: 'Kệ sách' },
      { key: 'visible', label: 'Hiển thị' },
      { key: 'total_copies', label: 'Tổng bản sao' },
      { key: 'available_copies', label: 'Sẵn có' },
      { key: 'borrowed_copies', label: 'Đang mượn' },
      { key: 'maintenance_copies', label: 'Bảo trì' },
    ]);
  }

  private logAudit(
    actor: User,
    action: string,
    entityType: AuditLogEntry['entity_type'],
    entityId: string,
    detail: string
  ): void {
    this.state.auditLogs.unshift({
      id: `AUD-${String(this.state.auditLogs.length + 1).padStart(4, '0')}`,
      actor_id: actor.id,
      actor_name: actor.name,
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail,
      timestamp: new Date().toISOString(),
    });
  }
}

export const libraryStore = new LibraryService();
