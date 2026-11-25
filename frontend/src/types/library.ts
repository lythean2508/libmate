export type UserRole = 'reader' | 'librarian';
export type AccountStatus = 'active' | 'locked';

export interface User {
  id: string;
  reader_code: string;
  name: string;
  role: UserRole;
  status: AccountStatus;
  grade_or_dept?: string;
}

export interface StoredUser extends User {
  password_hash: string;
}

export interface AuthSession {
  token: string;
  user: User;
  expires_at: string;
}

export interface Book {
  id: string;
  code: string;
  title: string;
  author: string;
  category: string;
  shelf: string;
  description: string;
  word_count: number;
  missing_description: boolean;
  metadata_source: string;
  license_verified: boolean;
  visible: boolean;
  created_at: string;
  updated_at: string;
}

export type CopyStatus = 'available' | 'borrowed' | 'maintenance';

export interface BookCopy {
  id: string;
  book_id: string;
  copy_code: string;
  status: CopyStatus;
  condition_note?: string;
}

export interface BookWithAvailability extends Book {
  total_copies: number;
  available_copies: number;
  borrowed_copies: number;
  maintenance_copies: number;
  index_status: 'ready' | 'pending';
}

export type BorrowRequestStatus = 'pending' | 'fulfilled' | 'rejected' | 'cancelled';

export interface BorrowRequest {
  id: string;
  user_id: string;
  book_id: string;
  status: BorrowRequestStatus;
  created_at: string;
  resolved_at?: string;
  rejection_reason?: string;
  handled_by?: string;
}

export interface BorrowRequestView extends BorrowRequest {
  book_title: string;
  book_author: string;
  book_shelf: string;
  available_copies: number;
  reader_name: string;
  reader_code: string;
  reader_active_loans: number;
}

export interface Loan {
  id: string;
  user_id: string;
  copy_id: string;
  book_id: string;
  request_id?: string;
  issued_by: string;
  issued_at: string;
  due_at: string;
  returned_at: string | null;
  return_note?: string;
}

export interface LoanView extends Loan {
  book_title: string;
  book_author: string;
  copy_code: string;
  copy_status: CopyStatus;
  reader_name: string;
  reader_code: string;
  is_overdue: boolean;
  days_remaining: number;
}

export interface SemanticMatchReason {
  matched_fields: Array<'title' | 'category' | 'description' | 'author'>;
  matched_terms: string[];
  excerpt: string; // Verbatim snippet from original metadata description (AI05 / T26)
}

export interface SemanticSearchResultItem {
  book: BookWithAvailability;
  score: number;
  suggestion_tier: 'Phù hợp cao' | 'Gợi ý tham khảo';
  reason: SemanticMatchReason;
}

export interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResultItem[];
  fallback_used: boolean;
  fallback_reason?: string;
  model_name: string;
  model_cold_start_ms?: number;
  below_threshold_message?: string;
}

export interface RecommendationFeedback {
  id: string;
  user_id: string;
  book_id: string;
  source_type: 'semantic_search' | 'similar_book';
  context_key: string; // query string or source book_id
  useful: boolean;
  created_at: string;
}

export interface FavoriteItem {
  user_id: string;
  book_id: string;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: 'book' | 'copy' | 'request' | 'loan';
  entity_id: string;
  detail: string;
  timestamp: string;
}

export interface BookEmbeddingRecord {
  book_id: string;
  content_hash: string;
  model_revision: string;
  status: 'ready' | 'pending';
  updated_at: string;
}

export interface ReportSummary {
  total_visible_books: number;
  total_hidden_books: number;
  total_copies: number;
  available_copies: number;
  borrowed_copies: number;
  maintenance_copies: number;
  active_loans: number;
  overdue_loans: number;
  pending_requests: number;
}

export interface EvalQueryItem {
  id: string;
  split: 'calibration' | 'holdout';
  query_type: 'nhu_cau_tu_nhien' | 'dong_nghia' | 'loi_go_khong_dau' | 'khong_co_sach';
  query: string;
  expected_book_ids: string[];
  notes: string;
}
