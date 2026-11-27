import type {
  AuditLogEntry,
  AuthSession,
  BookCopy,
  BookWithAvailability,
  BorrowRequest,
  BorrowRequestView,
  CopyStatus,
  LoanView,
  RecommendationFeedback,
  ReportSummary,
  SemanticSearchResponse,
  User,
} from '../types/library';
import { libraryStore } from './libraryStore';

export const API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  'http://localhost:8000';

export type ApiMode = 'auto' | 'api' | 'mock';

export const DEFAULT_API_MODE: ApiMode =
  ((import.meta.env?.VITE_API_MODE as ApiMode | undefined) || 'auto');

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly detail?: unknown;

  constructor(message: string, status = 400, detail?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.detail = detail;
  }
}

export interface CatalogListResponse {
  items: BookWithAvailability[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BookDetailResponse {
  book: BookWithAvailability;
  copies: BookCopy[];
  similar: BookWithAvailability[];
}

export interface MyActivityResponse {
  activeLoans: LoanView[];
  loanHistory: LoanView[];
  requests: BorrowRequestView[];
}

export interface LibrarianReportResponse {
  summary: ReportSummary;
  loans: LoanView[];
  auditLogs: AuditLogEntry[];
}

/**
 * Clean typed HTTP client bridge to the FastAPI backend (`VITE_API_BASE_URL`,
 * defaulting to `http://localhost:8000`) with automatic fallback to `libraryStore`
 * in mock/offline mode.
 */
export class LibMateApiClient {
  private baseUrl: string;
  private mode: ApiMode;
  private activeToken: string | null = null;

  constructor(options?: { baseUrl?: string; mode?: ApiMode }) {
    this.baseUrl = (options?.baseUrl ?? API_BASE_URL).replace(/\/+$/, '');
    this.mode = options?.mode ?? DEFAULT_API_MODE;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public getMode(): ApiMode {
    return this.mode;
  }

  public setMode(mode: ApiMode): void {
    this.mode = mode;
  }

  public setToken(token: string | null): void {
    this.activeToken = token;
  }

  public getToken(): string | null {
    return this.activeToken ?? libraryStore.getCurrentSession()?.token ?? null;
  }

  private buildHeaders(token?: string | null, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    const resolvedToken = token !== undefined ? token : this.getToken();
    if (resolvedToken) {
      headers.Authorization = `Bearer ${resolvedToken}`;
    }
    return headers;
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    fallbackFn: () => T | Promise<T>
  ): Promise<T> {
    if (this.mode === 'mock') {
      return await fallbackFn();
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, init);
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        let detailPayload: unknown;
        try {
          const errJson = (await response.json()) as { detail?: unknown; message?: string };
          detailPayload = errJson.detail ?? errJson;
          if (typeof errJson.detail === 'string') {
            errorMessage = errJson.detail;
          } else if (typeof errJson.message === 'string') {
            errorMessage = errJson.message;
          } else if (errJson.detail) {
            errorMessage = JSON.stringify(errJson.detail);
          }
        } catch {
          const text = await response.text().catch(() => '');
          if (text) errorMessage = text;
        }
        throw new ApiClientError(errorMessage, response.status, detailPayload);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      if (this.mode === 'api') {
        throw error;
      }
      // Automatic fallback to local libraryStore in 'auto' (offline/mock) mode
      return await fallbackFn();
    }
  }

  private async requestText(
    path: string,
    init: RequestInit,
    fallbackFn: () => string | Promise<string>
  ): Promise<string> {
    if (this.mode === 'mock') {
      return await fallbackFn();
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, init);
      if (!response.ok) {
        throw new ApiClientError(`HTTP ${response.status}`, response.status);
      }
      return await response.text();
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      if (this.mode === 'api') {
        throw error;
      }
      return await fallbackFn();
    }
  }

  // ==================== AUTHENTICATION ====================

  public async login(readerCode: string, password: string): Promise<AuthSession> {
    const session = await this.requestJson<AuthSession>(
      '/auth/login',
      {
        method: 'POST',
        headers: this.buildHeaders(null),
        body: JSON.stringify({ reader_code: readerCode, password }),
      },
      () => libraryStore.login(readerCode, password)
    );
    this.activeToken = session.token;
    return session;
  }

  public async registerReader(input: {
    reader_code: string;
    name: string;
    password: string;
    grade_or_dept?: string;
    role?: string;
  }): Promise<User> {
    return this.requestJson<User>(
      '/auth/register',
      {
        method: 'POST',
        headers: this.buildHeaders(null),
        body: JSON.stringify(input),
      },
      () => libraryStore.registerReader(input)
    );
  }

  public async logout(token?: string | null): Promise<{ status: string }> {
    const resolved = token !== undefined ? token : this.getToken();
    const res = await this.requestJson<{ status: string }>(
      '/auth/logout',
      {
        method: 'POST',
        headers: this.buildHeaders(resolved),
      },
      () => {
        libraryStore.logout(resolved);
        return { status: 'logged_out' };
      }
    );
    if (!token || token === this.activeToken) {
      this.activeToken = null;
    }
    return res;
  }

  public async getMe(token?: string | null): Promise<User> {
    const resolved = token !== undefined ? token : this.getToken();
    return this.requestJson<User>(
      '/auth/me',
      {
        method: 'GET',
        headers: this.buildHeaders(resolved),
      },
      () => libraryStore.verifySession(resolved)
    );
  }

  // ==================== CATALOG & BOOKS ====================

  public async listBooks(params?: {
    query?: string;
    category?: string;
    onlyAvailable?: boolean;
    page?: number;
    pageSize?: number;
    token?: string | null;
  }): Promise<CatalogListResponse> {
    const qs = new URLSearchParams();
    if (params?.query) qs.set('query', params.query);
    if (params?.category && params.category !== 'ALL') qs.set('category', params.category);
    if (params?.onlyAvailable) qs.set('only_available', 'true');
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('page_size', String(params.pageSize));
    const queryStr = qs.toString() ? `?${qs.toString()}` : '';

    return this.requestJson<CatalogListResponse>(
      `/books${queryStr}`,
      {
        method: 'GET',
        headers: this.buildHeaders(params?.token),
      },
      () =>
        libraryStore.listCatalogBooks({
          query: params?.query,
          category: params?.category,
          onlyAvailable: params?.onlyAvailable,
          page: params?.page,
          pageSize: params?.pageSize,
          includeHiddenForLibrarianToken: params?.token,
        })
    );
  }

  public async getBookDetail(bookId: string, token?: string | null): Promise<BookDetailResponse> {
    return this.requestJson<BookDetailResponse>(
      `/books/${encodeURIComponent(bookId)}`,
      {
        method: 'GET',
        headers: this.buildHeaders(token),
      },
      () => libraryStore.getBookDetail(bookId, token)
    );
  }

  public async createBook(
    token: string | null | undefined,
    payload: {
      title: string;
      author: string;
      category: string;
      shelf: string;
      description: string;
      metadata_source?: string;
      visible?: boolean;
    }
  ): Promise<BookWithAvailability> {
    return this.requestJson<BookWithAvailability>(
      '/books',
      {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify(payload),
      },
      () => libraryStore.createOrUpdateBook(token, payload)
    );
  }

  public async updateBook(
    token: string | null | undefined,
    bookId: string,
    payload: {
      title: string;
      author: string;
      category: string;
      shelf: string;
      description: string;
      metadata_source?: string;
      visible?: boolean;
    }
  ): Promise<BookWithAvailability> {
    return this.requestJson<BookWithAvailability>(
      `/books/${encodeURIComponent(bookId)}`,
      {
        method: 'PATCH',
        headers: this.buildHeaders(token),
        body: JSON.stringify(payload),
      },
      () => libraryStore.createOrUpdateBook(token, { ...payload, id: bookId })
    );
  }

  public async addCopy(
    token: string | null | undefined,
    payload: {
      book_id: string;
      copy_code: string;
      status?: CopyStatus;
      condition_note?: string;
    }
  ): Promise<BookCopy> {
    return this.requestJson<BookCopy>(
      '/copies',
      {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify(payload),
      },
      () => libraryStore.addBookCopy(token, payload)
    );
  }

  public async updateCopyStatus(
    token: string | null | undefined,
    copyId: string,
    status: 'available' | 'maintenance',
    conditionNote?: string
  ): Promise<BookCopy> {
    return this.requestJson<BookCopy>(
      `/copies/${encodeURIComponent(copyId)}`,
      {
        method: 'PATCH',
        headers: this.buildHeaders(token),
        body: JSON.stringify({ status, condition_note: conditionNote }),
      },
      () => libraryStore.updateCopyStatus(token, copyId, status, conditionNote)
    );
  }

  // ==================== BORROW REQUESTS & LOANS ====================

  public async submitBorrowRequest(
    token: string | null | undefined,
    bookId: string
  ): Promise<BorrowRequest> {
    return this.requestJson<BorrowRequest>(
      '/borrow-requests',
      {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify({ book_id: bookId }),
      },
      () => libraryStore.submitBorrowRequest(token, bookId)
    );
  }

  public async cancelBorrowRequest(
    token: string | null | undefined,
    requestId: string
  ): Promise<BorrowRequest> {
    return this.requestJson<BorrowRequest>(
      `/borrow-requests/${encodeURIComponent(requestId)}/cancel`,
      {
        method: 'POST',
        headers: this.buildHeaders(token),
      },
      () => libraryStore.cancelBorrowRequest(token, requestId)
    );
  }

  public async issueLoan(
    token: string | null | undefined,
    payload: {
      requestId: string;
      copyId: string;
      simulateFailure?: boolean;
    }
  ): Promise<LoanView> {
    return this.requestJson<LoanView>(
      '/loans/issue',
      {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          request_id: payload.requestId,
          copy_id: payload.copyId,
          simulate_failure: payload.simulateFailure ?? false,
        }),
      },
      () =>
        libraryStore.issueBookAtDesk(token, {
          requestId: payload.requestId,
          copyId: payload.copyId,
          simulateMidTransactionFailure: payload.simulateFailure,
        })
    );
  }

  public async returnLoan(
    token: string | null | undefined,
    loanId: string,
    options?: { markMaintenance?: boolean; conditionNote?: string }
  ): Promise<LoanView> {
    return this.requestJson<LoanView>(
      `/loans/${encodeURIComponent(loanId)}/return`,
      {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          mark_maintenance: options?.markMaintenance ?? false,
          condition_note: options?.conditionNote,
        }),
      },
      () =>
        libraryStore.returnLoanAtDesk(token, {
          loanId,
          markMaintenance: options?.markMaintenance,
          conditionNote: options?.conditionNote,
        })
    );
  }

  // ==================== PERSONAL / ME ENDPOINTS ====================

  public async getMyLoans(token?: string | null): Promise<LoanView[]> {
    const resolved = token !== undefined ? token : this.getToken();
    return this.requestJson<LoanView[]>(
      '/me/loans',
      {
        method: 'GET',
        headers: this.buildHeaders(resolved),
      },
      () => {
        const act = libraryStore.getMyActivity(resolved);
        return [...act.activeLoans, ...act.loanHistory];
      }
    );
  }

  public async getMyRequests(token?: string | null): Promise<BorrowRequestView[]> {
    const resolved = token !== undefined ? token : this.getToken();
    return this.requestJson<BorrowRequestView[]>(
      '/me/requests',
      {
        method: 'GET',
        headers: this.buildHeaders(resolved),
      },
      () => libraryStore.getMyActivity(resolved).requests
    );
  }

  public async getMyFavorites(token?: string | null): Promise<BookWithAvailability[]> {
    const resolved = token !== undefined ? token : this.getToken();
    return this.requestJson<BookWithAvailability[]>(
      '/me/favorites',
      {
        method: 'GET',
        headers: this.buildHeaders(resolved),
      },
      () => libraryStore.getMyFavorites(resolved)
    );
  }

  public async toggleFavorite(
    token: string | null | undefined,
    bookId: string
  ): Promise<{ favorited: boolean }> {
    return this.requestJson<{ favorited: boolean }>(
      `/me/favorites/${encodeURIComponent(bookId)}`,
      {
        method: 'POST',
        headers: this.buildHeaders(token),
      },
      () => libraryStore.toggleFavorite(token, bookId)
    );
  }

  // ==================== AI SEMANTIC SEARCH & RECOMMENDATIONS ====================

  public async searchSemantic(
    query: string,
    options?: { onlyAvailable?: boolean; skipColdStartDelay?: boolean }
  ): Promise<SemanticSearchResponse> {
    const qs = new URLSearchParams({ q: query });
    if (options?.onlyAvailable) qs.set('only_available', 'true');

    return this.requestJson<SemanticSearchResponse>(
      `/search/semantic?${qs.toString()}`,
      {
        method: 'GET',
        headers: this.buildHeaders(null),
      },
      () => libraryStore.searchSemantic(query, options)
    );
  }

  public async getSimilarBooks(bookId: string): Promise<BookWithAvailability[]> {
    return this.requestJson<BookWithAvailability[]>(
      `/books/${encodeURIComponent(bookId)}/similar`,
      {
        method: 'GET',
        headers: this.buildHeaders(null),
      },
      () => libraryStore.getBookDetail(bookId).similar
    );
  }

  public async submitFeedback(
    token: string | null | undefined,
    payload: {
      bookId: string;
      sourceType: 'semantic_search' | 'similar_book';
      contextKey: string;
      useful: boolean;
    }
  ): Promise<RecommendationFeedback> {
    return this.requestJson<RecommendationFeedback>(
      '/feedback',
      {
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          book_id: payload.bookId,
          source_type: payload.sourceType,
          context_key: payload.contextKey,
          useful: payload.useful,
        }),
      },
      () => libraryStore.submitRecommendationFeedback(token, payload)
    );
  }

  // ==================== REPORTS & CSV EXPORTS ====================

  public async getReportsSummary(token?: string | null): Promise<LibrarianReportResponse> {
    const resolved = token !== undefined ? token : this.getToken();
    return this.requestJson<LibrarianReportResponse>(
      '/reports/summary',
      {
        method: 'GET',
        headers: this.buildHeaders(resolved),
      },
      () => libraryStore.getLibrarianReport(resolved)
    );
  }

  public async exportLoansCsv(
    token?: string | null,
    filters?: { loanStatus?: 'ALL' | 'ACTIVE' | 'OVERDUE' | 'RETURNED'; category?: string }
  ): Promise<string> {
    const resolved = token !== undefined ? token : this.getToken();
    const qs = new URLSearchParams();
    if (filters?.loanStatus) qs.set('loan_status', filters.loanStatus);
    if (filters?.category) qs.set('category', filters.category);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';

    return this.requestText(
      `/exports/loans.csv${suffix}`,
      {
        method: 'GET',
        headers: this.buildHeaders(resolved),
      },
      () => libraryStore.exportLoansCsv(resolved, filters)
    );
  }

  public async exportInventoryCsv(token?: string | null): Promise<string> {
    const resolved = token !== undefined ? token : this.getToken();
    return this.requestText(
      '/exports/inventory.csv',
      {
        method: 'GET',
        headers: this.buildHeaders(resolved),
      },
      () => libraryStore.exportInventoryCsv(resolved)
    );
  }
}

export const apiClient = new LibMateApiClient();
