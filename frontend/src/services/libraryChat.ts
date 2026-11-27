import type { BookWithAvailability, SemanticSearchResultItem } from '../types/library';
import { normalizeSearchText } from '../utils/vietnamese';
import { libraryStore } from './libraryStore';
import { runLocalSemanticSearch } from './semanticEngine';

export interface ChatContext {
  query: string;
  shownBookIds: string[];
  onlyAvailable: boolean;
}

export interface LibraryReply {
  text: string;
  books: SemanticSearchResultItem[];
  suggestions: string[];
  context?: ChatContext;
}

const SUBJECTS = [
  { pattern: /\b(toan|hinh hoc|dai so|dao ham|xac suat|to hop|so hoc)\b/, category: 'Toán học & Tư duy', broad: /^(mon )?toan( hoc)?$/ },
  { pattern: /\b(vat ly|thien van|vu tru)\b/, category: 'Vật lý & Thiên văn', broad: /^(mon )?vat ly$/ },
  { pattern: /\b(hoa hoc|sinh hoc|moi truong|mon hoa|mon sinh)\b|^(hoa|sinh)$/, category: 'Hóa - Sinh & Môi trường', broad: /^(mon )?(hoa( hoc)?|sinh( hoc)?)$/ },
  { pattern: /\b(tin hoc|lap trinh|python|javascript|sql|arduino)\b/, category: 'Tin học & AI', broad: /^(mon )?tin hoc$/ },
  { pattern: /\b(lich su|dia ly)\b/, category: 'Lịch sử & Địa lý', broad: /^(mon )?(lich su|dia ly)$/ },
  { pattern: /\b(tieng anh|ngu phap|phat am)\b/, category: 'Ngoại ngữ & Kỹ năng học thuật', broad: /^tieng anh$/ },
];

function cleanQuery(input: string): string {
  return normalizeSearchText(input)
    .replace(/\b(muon|can) (hoc|doc)\b/g, ' ')
    .replace(/\b(em|minh|toi|ban|cho|voi|a|nhe|nha|oi)\b/g, ' ')
    .replace(/\b(muon|can|tim|goi y|gioi thieu|giup|ve|doc|sach|cuon|quyen|duoc|khong|co|nao|hay)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function excerpt(book: BookWithAvailability): string {
  return book.description.split(/(?<=[.!?])\s+/)[0] || book.description;
}

/** Free, browser-local retrieval. Replies and evidence come from the actual catalog, not an external LLM. */
export function findBooksForChat(
  input: string,
  previous?: ChatContext,
  options: { onlyAvailable?: boolean } = {},
): LibraryReply {
  const normalized = normalizeSearchText(input);
  if (/^(xin chao|chao( ban| libmate)?|hello|hi|hey)$/.test(normalized)) {
    return { text: 'Chào bạn! Mình là LibMate, người bạn tìm sách của bạn. Bạn muốn học môn gì hoặc đang quan tâm đến chủ đề nào?', books: [], suggestions: ['Em muốn học toán', 'Em muốn học lập trình Python', 'Sách giúp em tập trung học'] };
  }
  if (/^(cam on( ban| libmate)?|thanks|thank you)$/.test(normalized)) {
    return { text: 'Rất vui được giúp bạn tìm sách. Khi cần tìm một chủ đề khác, cứ nhắn mình nhé!', books: [], suggestions: ['Em muốn học tiếng Anh', 'Em thích khám phá vũ trụ'] };
  }

  const wantsMore = /\b(khac|them|tiep)\b/.test(normalized) && /\b(sach|cuon|quyen|goi y|nua|khong)\b/.test(normalized);
  const availabilityRequested = /\b(con sach|con ban|san co|con de muon|dang co san)\b/.test(normalized);
  const refinement = /^(lop \d+( va \d+)?|co ban|de hon|nang cao|cho nguoi moi( bat dau)?|con sach nao khong|chi sach con ban|sach dang co san)$/;
  const cleaned = cleanQuery(input);
  const isFollowUp = Boolean(previous) && (wantsMore || refinement.test(cleaned) || availabilityRequested && cleaned.length < 30);
  const query = isFollowUp
    ? wantsMore || availabilityRequested ? previous!.query : `${previous!.query} ${cleaned}`
    : cleaned;
  const onlyAvailable = Boolean(options.onlyAvailable || availabilityRequested || isFollowUp && previous?.onlyAvailable);

  if (!query || /^(gi|bat dau|chu de( khac| moi)?|mot|muon hoc|de hoc|hoc gi)$/.test(query) || wantsMore && !previous) {
    return { text: 'Bạn cho mình biết môn học, tên sách, tác giả hoặc điều bạn muốn tìm hiểu nhé. Ví dụ: “em muốn học toán” hay “em cần sách hình học không gian”.', books: [], suggestions: ['Em muốn học toán', 'Em cần sách hình học không gian', 'Em muốn học tiếng Anh'] };
  }

  const subject = SUBJECTS.find((item) => item.pattern.test(query));
  const excluded = new Set(wantsMore && isFollowUp ? previous!.shownBookIds : []);
  const catalog = libraryStore.listCatalogBooks({ pageSize: Number.MAX_SAFE_INTEGER }).items
    .filter((book) => book.index_status === 'ready' && !excluded.has(book.id));
  let pool = subject ? catalog.filter((book) => book.category === subject.category) : catalog;
  // This shelf also contains Vietnamese writing and study skills; keep English requests on topic.
  if (subject?.category === 'Ngoại ngữ & Kỹ năng học thuật') {
    pool = pool.filter((book) => /\btieng anh\b/.test(normalizeSearchText(book.title)) || book.language?.includes('Anh'));
  }
  const result = runLocalSemanticSearch(query, pool, new Map(), { onlyAvailable });
  let books = result.results;
  // Short, explicit title phrases can be diluted by TF-IDF on longer descriptions.
  if (!books.length && query.length >= 4) {
    books = pool.filter(book => normalizeSearchText(book.title).includes(query) && (!onlyAvailable || book.available_copies > 0))
      .slice(0, 5).map(book => ({ book, score: 0, suggestion_tier: 'Gợi ý tham khảo', reason: { matched_fields: ['title'], matched_terms: [query], excerpt: excerpt(book) } }));
  }

  // A request for a whole school subject should browse that subject, even when cosine is low.
  const broadQuery = query.replace(/\b(de hieu|de doc|co ban|cho nguoi moi( bat dau)?|bat dau|de hon)\b/g, '').replace(/\s+/g, ' ').trim();
  const broadSubject = subject && subject.broad.test(broadQuery);
  if (broadSubject) {
    books = pool.filter((book) => !onlyAvailable || book.available_copies > 0)
      .sort((a, b) => {
        const aTitle = normalizeSearchText(a.title).includes(broadQuery) ? 1 : 0;
        const bTitle = normalizeSearchText(b.title).includes(broadQuery) ? 1 : 0;
        return bTitle - aTitle || a.id.localeCompare(b.id);
      }).slice(0, 5).map((book) => ({ book, score: 0, suggestion_tier: 'Gợi ý tham khảo', reason: { matched_fields: ['category'], matched_terms: [query], excerpt: excerpt(book) } }));
  }

  const context: ChatContext = {
    query,
    shownBookIds: [...new Set([...(isFollowUp ? previous!.shownBookIds : []), ...books.map((item) => item.book.id)])],
    onlyAvailable,
  };
  const suggestions = books.length
    ? ['Còn sách nào khác không?', ...(onlyAvailable ? [] : ['Chỉ sách còn bản']), 'Em muốn học chủ đề khác']
    : ['Em muốn học toán', 'Em muốn học lập trình Python', 'Sách rèn kỹ năng tự học'];
  if (!books.length) {
    return {
      text: wantsMore && isFollowUp
        ? 'Mình chưa tìm thấy thêm sách phù hợp ngoài những cuốn đã gợi ý. Bạn có thể nói rõ phần muốn học hoặc thử một chủ đề khác nhé.'
        : onlyAvailable
          ? 'Mình chưa tìm thấy sách phù hợp đang còn bản để mượn. Bạn có thể tắt bộ lọc “Chỉ sách còn bản” để tìm cả sách đang được mượn, hoặc thử chủ đề khác nhé.'
          : 'Mình chưa tìm thấy sách phù hợp với nhu cầu này trong danh mục hiện tại. Bạn thử nói rõ môn học, tên sách hoặc một từ khóa khác nhé.',
      books: [], suggestions, context,
    };
  }
  return {
    text: `Mình tìm được ${books.length} cuốn${wantsMore && isFollowUp ? ' khác' : ''}${subject ? ` thuộc chủ đề ${subject.category}` : ' phù hợp với nhu cầu của bạn'}${onlyAvailable ? ', đều đang còn bản để mượn' : ''}. Bạn có thể xem nội dung, vị trí kệ và đặt mượn ngay bên dưới.`,
    books, suggestions, context,
  };
}
