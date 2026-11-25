import type {
  BookWithAvailability,
  BookEmbeddingRecord,
  SemanticMatchReason,
  SemanticSearchResponse,
  SemanticSearchResultItem,
} from '../types/library';
import { normalizeSearchText, simpleContentHash } from '../utils/vietnamese';

/**
 * Mô hình mục tiêu khi kết nối FastAPI (Phạm Hiển): intfloat/multilingual-e5-small (MIT).
 * Tại tầng Frontend / Local Offline Simulation (Lý Thế An):
 * - Chuẩn bị đúng tiền xử lý passage:/query:, content_hash + model_revision (AI02, AI03, T28, T30).
 * - Tính tương tự ngữ nghĩa tiếng Việt (TF-IDF cụm từ + mở rộng khái niệm đồng nghĩa học đường + L2 cosine).
 * - Trích xuất lý do khớp CHỈ TỪ METADATA GỐC (AI05 / T26 — không sinh lời giải thích ngoài dữ liệu).
 * - Kiểm tra ngưỡng từ chối với truy vấn ngoài phạm vi thư viện (AI06 / TC19).
 * - Hỗ trợ chế độ fallback từ khóa khi AI lỗi hoặc chưa nạp xong (T30 / TC23).
 */
export const MODEL_REVISION = 'intfloat/multilingual-e5-small@local-vi-v1';
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.14;

const VIETNAMESE_STOPWORDS = new Set([
  'va', 'cua', 'cho', 'trong', 'cac', 'nhung', 'mot', 'nhu', 'the', 'nao', 'la', 'co', 'khong',
  'duoc', 'voi', 'khi', 'tu', 'den', 've', 'hay', 'em', 'muon', 'tim', 'sach', 'cuon', 'tai',
  'lieu', 'giup', 'cach', 'lam', 'sao', 'de', 'bi', 'rat', 'nhieu', 'nay', 'do', 'o', 'tren',
  'duoi', 'qua', 'ra', 'vao', 'theo', 'cung', 'phan', 'ban', 'hoc', 'sinh', 'truong', 'pho',
  'thong', 'lop', 'nguoi', 'doc', 'can', 'hoi', 've', 'mot', 'so', 'loai', 'quyen', 'tap'
]);

/**
 * Các cụm khái niệm đồng nghĩa tiếng Việt tổng quát trong bối cảnh thư viện trường học
 * (xử lý đồng nghĩa, diễn đạt tự nhiên và không dấu — T33 / AI07).
 */
const CONCEPT_CLUSTERS: Array<{ id: string; terms: string[] }> = [
  {
    id: 'concept_exam_stress_psych',
    terms: [
      'cang thang', 'lo lang', 'lo au', 'ap luc thi cu', 'mua thi', 'mat binh tinh',
      'tam ly hoc duong', 'tuoi day thi', 'cam xuc', 'tu ti', 'hoi tho', 'giam ap luc', 'stress'
    ],
  },
  {
    id: 'concept_habits_procrastination',
    terms: [
      'tri hoan', 'nuoc den chan moi nhay', 'thoi quen', 'atomic habits', 'ky luat',
      'tu giac', 'cai thien nho', 'mot phan tram', 'muc tieu', 'kien tri'
    ],
  },
  {
    id: 'concept_focus_distraction',
    terms: [
      'mat tap trung', 'xao nhang', 'dien thoai', 'mang xa hoi', 'tap trung sau',
      'deep work', 'pomodoro', 'quan ly thoi gian', 'ban hoc'
    ],
  },
  {
    id: 'concept_memory_note_mindmap',
    terms: [
      'ghi nho', 'nho lau', 'so do tu duy', 'mindmap', 'ghi chep', 'cornell',
      'tom tat', 'active recall', 'spaced repetition', 'on tap', 'hoc tu'
    ],
  },
  {
    id: 'concept_sleep_brain',
    terms: [
      'giac ngu', 'thuc khuya', 'thuc trang dem', 'ngu du', 'bo nao', 'tri nho dai han', 'rem'
    ],
  },
  {
    id: 'concept_astronomy_cosmos',
    terms: [
      'lo den', 'vu tru', 'big bang', 'thien van', 'chom sao', 'bau troi dem',
      'khong gian thoi gian', 'kinh thien van', 'hanh tinh', 'luoc su thoi gian'
    ],
  },
  {
    id: 'concept_diy_stem_physics',
    terms: [
      'thi nghiem', 'vat lieu tai che', 'chai nhua', 'ten lua nuoc', 'stem',
      'vat ly vui', 'dong co mini', 'nam cham', 'mach dien', 'arduino', 'robotics', 'robot do duong', 'tuoi cay tu dong', 'cam bien'
    ],
  },
  {
    id: 'concept_python_coding',
    terms: [
      'lap trinh', 'viet code', 'python', 'thuat toan', 'cau truc du lieu',
      'vong lap', 'de quy', 'quy hoach dong', 'nhap mon lap trinh'
    ],
  },
  {
    id: 'concept_ai_ethics',
    terms: [
      'tri tue nhan tao', 'hoc may', 'mang no ron', 'vector ngu nghia', 'dao duc ai',
      'dao van', 'ban quyen so', 'ao giac ai', 'quyen rieng tu'
    ],
  },
  {
    id: 'concept_cybersecurity',
    terms: [
      'an toan thong tin', 'mat khau', 'xac thuc hai lop', 'lua dao', 'phishing',
      'duong link la', 'tin gia', 'khong gian mang', 'bao mat tai khoan'
    ],
  },
  {
    id: 'concept_git_teamwork',
    terms: [
      'git', 'github', 'chia nhanh', 'quan ly ma nguon', 'pull request', 'merge', 'xung dot code', 'nhom phan mem'
    ],
  },
  {
    id: 'concept_career_guidance',
    terms: [
      'huong nghiep', 'chon nganh', 'chon nghe', 'dai hoc', 'holland', 'so thich nang luc', 'thi truong lao dong'
    ],
  },
  {
    id: 'concept_personal_finance',
    terms: [
      'tai chinh ca nhan', 'tien tieu vat', 'tiet kiem', 'chi tieu', 'so chi tieu', 'vay tien qua ung dung'
    ],
  },
  {
    id: 'concept_public_speaking',
    terms: [
      'thuyet trinh', 'tranh bien', 'truoc dam dong', 'run giong', 'ngon ngu co the', 'slide', 'lap luan'
    ],
  },
  {
    id: 'concept_first_aid_safety',
    terms: [
      'so cuu', 'bong', 'chay mau cam', 'bong gan', 'hoc di vat', 'duoi nuoc', 'thoat hiem', 'tai nan thuong tich'
    ],
  },
  {
    id: 'concept_environment_plastic',
    terms: [
      'bien doi khi hau', 'hieu ung nha kinh', 'rac thai nhua', 'vi nhua', 'dai duong',
      'phan loai rac', 'moi truong xanh', 'san ho'
    ],
  },
  {
    id: 'concept_kitchen_chemistry',
    terms: [
      'phan ung hoa hoc', 'nha bep', 'baking soda', 'banh no', 'xa phong', 'tay rua', 'len men sua chua', 'gi set'
    ],
  },
  {
    id: 'concept_geometry_math',
    terms: [
      'hinh hoc khong gian', 'thiet dien', 'toa do oxyz', 'goc khoang cach', 'duong thang mat phang', 'giai mot bai toan'
    ],
  },
  {
    id: 'concept_sea_sovereignty',
    terms: [
      'bien dao', 'hoang sa', 'truong sa', 'chu quyen', 'luat bien', 'chau ban'
    ],
  },
  {
    id: 'concept_english_exam',
    terms: [
      'ngu phap tieng anh', 'muoi hai thi', 'cau dieu kien', 'menh de quan he', 'cau bi dong', 'doc hieu tieng anh', 'tu vung tieng anh'
    ],
  },
  {
    id: 'concept_lit_rural_tax',
    terms: [
      'suu thue', 'ban con ban cho', 'nguoi nong dan truoc cach mang', 'tat den', 'chi dau'
    ],
  },
  {
    id: 'concept_lit_school_love_village',
    terms: [
      'tinh cam hoc tro', 'don phuong', 'lang do do', 'mat biec', 'ngan', 'ha lan'
    ],
  },
  {
    id: 'concept_lit_orphan_circus',
    terms: [
      'cau be mo coi', 'ganh xiec rong', 'chu cho capi', 'cu vitalis', 'khong gia dinh', 'remi'
    ],
  },
  {
    id: 'concept_lit_cricket_adventure',
    terms: [
      'chu de', 'de choat', 'de trui', 'bai hoc duong doi dau tien', 'de men phieu luu ky'
    ],
  },
];

export function buildPassageText(book: Pick<BookWithAvailability, 'title' | 'author' | 'category' | 'description'>): string {
  return `passage: Tên sách: ${book.title}. Tác giả: ${book.author}. Chủ đề: ${book.category}. Mô tả: ${book.description}`;
}

export function computeBookContentHash(book: Pick<BookWithAvailability, 'title' | 'author' | 'category' | 'description'>): string {
  return simpleContentHash(`${MODEL_REVISION}|${buildPassageText(book)}`);
}

function extractTokensAndConcepts(rawText: string, isTitleWeight = false): Map<string, number> {
  const norm = normalizeSearchText(rawText);
  const words = norm.split(' ').filter((w) => w.length >= 2 && !VIETNAMESE_STOPWORDS.has(w));
  const weights = new Map<string, number>();
  const mult = isTitleWeight ? 2.2 : 1.0;

  for (const w of words) {
    weights.set(w, (weights.get(w) ?? 0) + 1.0 * mult);
  }
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`;
    weights.set(bigram, (weights.get(bigram) ?? 0) + 1.75 * mult);
  }
  for (const cluster of CONCEPT_CLUSTERS) {
    let matchedCount = 0;
    for (const phrase of cluster.terms) {
      if (norm.includes(phrase)) {
        matchedCount++;
      }
    }
    if (matchedCount > 0) {
      weights.set(cluster.id, (weights.get(cluster.id) ?? 0) + (2.6 + Math.min(matchedCount, 3) * 0.9) * mult);
    }
  }
  return weights;
}

function normalizeL2(vec: Map<string, number>): Map<string, number> {
  let sumSq = 0;
  for (const val of vec.values()) sumSq += val * val;
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Map<string, number>();
  for (const [k, v] of vec.entries()) out.set(k, v / norm);
  return out;
}

function cosineMap(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of smaller.entries()) {
    const bv = larger.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  return dot;
}

function buildBookVector(
  book: BookWithAvailability,
  idfMap: Map<string, number>
): Map<string, number> {
  const combined = new Map<string, number>();
  const titleFeatures = extractTokensAndConcepts(`${book.title} ${book.category}`, true);
  const bodyFeatures = extractTokensAndConcepts(`${book.author} ${book.description}`, false);

  for (const [k, v] of titleFeatures.entries()) {
    combined.set(k, (combined.get(k) ?? 0) + v);
  }
  for (const [k, v] of bodyFeatures.entries()) {
    combined.set(k, (combined.get(k) ?? 0) + v);
  }
  for (const [k, tf] of combined.entries()) {
    const idf = idfMap.get(k) ?? 1.2;
    combined.set(k, (1 + Math.log(tf)) * idf);
  }
  return normalizeL2(combined);
}

function computeCorpusIdf(books: BookWithAvailability[]): Map<string, number> {
  const df = new Map<string, number>();
  const n = Math.max(books.length, 1);
  for (const b of books) {
    const feats = extractTokensAndConcepts(`${b.title} ${b.author} ${b.category} ${b.description}`, false);
    for (const k of feats.keys()) {
      df.set(k, (df.get(k) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [k, count] of df.entries()) {
    idf.set(k, Math.log((n + 1) / (count + 1)) + 1.0);
  }
  return idf;
}

/**
 * Trích xuất bằng chứng khớp hoàn toàn từ dữ liệu gốc (AI05 / T26):
 * Chỉ dùng tên sách, chủ đề, tác giả và câu trích nguyên văn từ description.
 */
function buildMetadataReason(query: string, book: BookWithAvailability): SemanticMatchReason {
  const qNorm = normalizeSearchText(query);
  const qWords = qNorm.split(' ').filter((w) => w.length >= 3 && !VIETNAMESE_STOPWORDS.has(w));

  const matchedFields: Array<'title' | 'category' | 'description' | 'author'> = [];
  const titleNorm = normalizeSearchText(book.title);
  const catNorm = normalizeSearchText(book.category);
  const authorNorm = normalizeSearchText(book.author);
  const descNorm = normalizeSearchText(book.description);

  const matchedTermsSet = new Set<string>();
  for (const w of qWords) {
    if (titleNorm.includes(w)) {
      if (!matchedFields.includes('title')) matchedFields.push('title');
      matchedTermsSet.add(w);
    }
    if (catNorm.includes(w)) {
      if (!matchedFields.includes('category')) matchedFields.push('category');
      matchedTermsSet.add(w);
    }
    if (authorNorm.includes(w)) {
      if (!matchedFields.includes('author')) matchedFields.push('author');
      matchedTermsSet.add(w);
    }
    if (descNorm.includes(w)) {
      if (!matchedFields.includes('description')) matchedFields.push('description');
      matchedTermsSet.add(w);
    }
  }

  if (matchedFields.length === 0) {
    matchedFields.push('category', 'description');
  }

  // Chọn câu nguyên văn trong mô tả gốc có nhiều từ liên quan nhất (không tự chế câu mới!)
  const sentences = book.description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let bestSentence = sentences[0] ?? book.description;
  let bestHits = -1;
  for (const s of sentences) {
    const sNorm = normalizeSearchText(s);
    let hits = 0;
    for (const w of qWords) {
      if (sNorm.includes(w)) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestSentence = s;
    }
  }

  return {
    matched_fields: matchedFields,
    matched_terms: Array.from(matchedTermsSet).slice(0, 6),
    excerpt: bestSentence,
  };
}

/**
 * Tìm kiếm từ khóa cơ sở (Baseline Keyword Search — dùng cho F04, fallback T30 và đối chiếu T34).
 */
export function runKeywordSearch(
  query: string,
  books: BookWithAvailability[],
  options?: { category?: string; onlyAvailable?: boolean }
): BookWithAvailability[] {
  const visibleBooks = books.filter((b) => {
    if (!b.visible) return false;
    if (options?.category && options.category !== 'ALL' && b.category !== options.category) return false;
    if (options?.onlyAvailable && b.available_copies <= 0) return false;
    return true;
  });

  const qNorm = normalizeSearchText(query);
  if (!qNorm) return visibleBooks;

  const qTokens = qNorm.split(' ').filter((w) => w.length >= 2 && !VIETNAMESE_STOPWORDS.has(w));
  const searchTokens = qTokens.length > 0 ? qTokens : qNorm.split(' ').filter(Boolean);

  const scored: Array<{ book: BookWithAvailability; score: number }> = [];

  for (const book of visibleBooks) {
    const titleNorm = normalizeSearchText(book.title);
    const authorNorm = normalizeSearchText(book.author);
    const catNorm = normalizeSearchText(book.category);
    const descNorm = normalizeSearchText(book.description);

    let score = 0;
    if (titleNorm.includes(qNorm)) score += 12;
    if (authorNorm.includes(qNorm)) score += 10;

    let matchedTokenCount = 0;
    for (const tok of searchTokens) {
      let hit = false;
      if (titleNorm.includes(tok)) {
        score += 3.5;
        hit = true;
      }
      if (authorNorm.includes(tok)) {
        score += 3.0;
        hit = true;
      }
      if (catNorm.includes(tok)) {
        score += 1.5;
        hit = true;
      }
      if (descNorm.includes(tok)) {
        score += 1.0;
        hit = true;
      }
      if (hit) matchedTokenCount++;
    }

    const minRequiredHits = searchTokens.length <= 2 ? searchTokens.length : Math.ceil(searchTokens.length * 0.5);
    if (matchedTokenCount >= minRequiredHits && score > 0) {
      scored.push({ book, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title, 'vi'));
  return scored.map((s) => s.book);
}

/**
 * Tìm kiếm ngữ nghĩa AI Local (F10 / T25 / T26 / T28 / T29 / T30).
 * - Lọc sách ẩn (`visible = false`) và sách có chỉ mục chưa đồng bộ nếu không hợp lệ (`T30`, `TC20`).
 * - Xếp hạng cosine, áp ngưỡng `SEMANTIC_SIMILARITY_THRESHOLD` và lấy tối đa Top 5 (`F10`, `AI04`, `AI06`).
 * - Hỗ trợ mô phỏng lỗi AI -> tự động chuyển sang fallback từ khóa (`TC23`).
 */
export function runLocalSemanticSearch(
  query: string,
  books: BookWithAvailability[],
  embeddingRecords: Map<string, BookEmbeddingRecord>,
  options?: {
    onlyAvailable?: boolean;
    simulateAiFailure?: boolean;
    coldStartMs?: number;
  }
): SemanticSearchResponse {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      query: trimmed,
      results: [],
      fallback_used: false,
      model_name: MODEL_REVISION,
      below_threshold_message: 'Vui lòng nhập mô tả nhu cầu đọc sách bằng tiếng Việt.',
    };
  }

  // Fallback khi AI chưa sẵn sàng hoặc lỗi mô hình (T30 / TC23)
  if (options?.simulateAiFailure) {
    const fallbackBooks = runKeywordSearch(trimmed, books, { onlyAvailable: options.onlyAvailable }).slice(0, 5);
    return {
      query: trimmed,
      results: fallbackBooks.map((book) => ({
        book,
        score: 0,
        suggestion_tier: 'Gợi ý tham khảo',
        reason: buildMetadataReason(trimmed, book),
      })),
      fallback_used: true,
      fallback_reason: 'Mô hình AI local đang tạm ngưng hoặc chưa tải xong — hệ thống tự động dùng tìm kiếm từ khóa dự phòng.',
      model_name: 'fallback/keyword-vi',
      below_threshold_message:
        fallbackBooks.length === 0
          ? 'Không tìm thấy sách khớp từ khóa trong danh mục hiện tại. Hãy thử từ khóa ngắn gọn hơn.'
          : undefined,
    };
  }

  // Lọc sách đang hiển thị & chỉ dùng vector có hash hợp lệ (không dùng vector cũ âm thầm - T30 / TC20)
  const activeBooks = books.filter((b) => {
    if (!b.visible) return false;
    if (options?.onlyAvailable && b.available_copies <= 0) return false;
    const rec = embeddingRecords.get(b.id);
    if (!rec) return true;
    const currentHash = computeBookContentHash(b);
    return rec.status === 'ready' && rec.content_hash === currentHash;
  });

  const idfMap = computeCorpusIdf(activeBooks);
  const rawQueryFeats = extractTokensAndConcepts(trimmed, false);
  const filteredQueryFeats = new Map<string, number>();

  let totalUnigrams = 0;
  let matchedCorpusUnigrams = 0;
  let hasConceptMatch = false;

  for (const [k, tf] of rawQueryFeats.entries()) {
    const isBigram = k.includes('_') && !k.startsWith('concept_');
    const isConcept = k.startsWith('concept_');

    if (!isBigram && !isConcept) {
      totalUnigrams++;
      if (idfMap.has(k)) matchedCorpusUnigrams++;
    }
    if (isConcept && idfMap.has(k)) {
      hasConceptMatch = true;
    }

    const idf = idfMap.get(k);
    if (idf !== undefined) {
      filteredQueryFeats.set(k, (1 + Math.log(tf)) * idf);
    } else if (!isBigram && !isConcept) {
      // Giữ trọng số nhẹ cho từ đơn ngoài kho ngữ liệu để phạt câu hoàn toàn lạc đề (TC19)
      filteredQueryFeats.set(k, 1.35);
    }
  }

  const coverageBoost = hasConceptMatch
    ? 1.0
    : totalUnigrams > 0
      ? Math.min(1.0, (matchedCorpusUnigrams / totalUnigrams) * 1.65)
      : 0;

  const qVec = normalizeL2(filteredQueryFeats);

  const scored: SemanticSearchResultItem[] = [];
  for (const book of activeBooks) {
    const bVec = buildBookVector(book, idfMap);
    const score = cosineMap(qVec, bVec) * coverageBoost;
    if (score >= SEMANTIC_SIMILARITY_THRESHOLD) {
      scored.push({
        book,
        score: Number(score.toFixed(4)),
        suggestion_tier: score >= 0.26 ? 'Phù hợp cao' : 'Gợi ý tham khảo',
        reason: buildMetadataReason(trimmed, book),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.book.available_copies - a.book.available_copies);
  const top5 = scored.slice(0, 5);

  return {
    query: trimmed,
    results: top5,
    fallback_used: false,
    model_name: MODEL_REVISION,
    model_cold_start_ms: options?.coldStartMs,
    below_threshold_message:
      top5.length === 0
        ? 'Chưa tìm thấy đầu sách nào trong danh mục 100 sách đạt ngưỡng phù hợp với nhu cầu này. Bạn có thể diễn đạt theo chủ đề môn học hoặc chuyển sang Tìm từ khóa.'
        : undefined,
  };
}

/**
 * Gợi ý sách tương tự trên trang Chi tiết sách (F11 / T27 / TC25):
 * Loại trừ chính cuốn đang xem và mọi sách ẩn (`visible = false`).
 */
export function getSimilarBooksFromCatalog(
  targetBook: BookWithAvailability,
  allBooks: BookWithAvailability[],
  limit = 4
): BookWithAvailability[] {
  const candidates = allBooks.filter((b) => b.visible && b.id !== targetBook.id);
  const idfMap = computeCorpusIdf([targetBook, ...candidates]);
  const targetVec = buildBookVector(targetBook, idfMap);

  const scored = candidates.map((cand) => {
    let sim = cosineMap(targetVec, buildBookVector(cand, idfMap));
    if (cand.category === targetBook.category) sim += 0.12;
    if (cand.author === targetBook.author) sim += 0.08;
    return { book: cand, sim };
  });

  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, limit).map((s) => s.book);
}
