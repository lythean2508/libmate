import type { AIAnswer, AIHistoryMessage, AISession } from '../types/ai';
import type { SemanticSearchResultItem } from '../types/library';
import { findBooksForChat, type ChatContext, type LibraryReply } from './libraryChat';
import { libraryStore } from './libraryStore';
import { normalizeSearchText } from '../utils/vietnamese';

export class AIRequestError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}

export async function aiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', signal: init?.signal ?? AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok) throw new AIRequestError(data.message || 'Không thể kết nối dịch vụ AI.', data.code || 'UNAVAILABLE', response.status);
  return data as T;
}

export const getGoogleSession = () => aiRequest<AISession>('/api/ai/session');

export interface AIReply extends LibraryReply {
  source: 'gemini' | 'library';
  model?: string;
  providerNotice?: string;
}

export async function askGoogleAI(input: string, previous: ChatContext | undefined, options: {
  csrfToken: string;
  onlyAvailable: boolean;
  history: AIHistoryMessage[];
  signal?: AbortSignal;
}): Promise<AIReply> {
  const fallback = findBooksForChat(input, previous, { onlyAvailable: options.onlyAvailable });
  const more = /\b(khac|them|tiep)\b/.test(normalizeSearchText(input)) && /\b(sach|cuon|quyen|goi y|nua|khong)\b/.test(normalizeSearchText(input));
  const onlyAvailable = fallback.context?.onlyAvailable ?? options.onlyAvailable;
  const excludeBookIds = more ? previous?.shownBookIds ?? [] : [];
  const catalog = libraryStore.listCatalogBooks({ pageSize: 150 }).items
    .filter((book) => book.index_status === 'ready' && !excludeBookIds.includes(book.id) && (!onlyAvailable || book.available_copies > 0));
  try {
    const answer = await aiRequest<AIAnswer>('/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Libmate-CSRF': options.csrfToken }, signal: options.signal,
      // Deliberately send no library session, Google identity, email, or loan history to Gemini.
      body: JSON.stringify({ message: input, query: previous?.query ?? '', history: options.history.slice(-8).map(({ role, text }) => ({ role, text })), onlyAvailable, excludeBookIds, catalog: catalog.map(({ id, title, author, category, description, available_copies, shelf }) => ({ id, title, author, category, description, available_copies, shelf })) }),
    });
    const byId = new Map(catalog.map((book) => [book.id, book]));
    if (!answer.text || !Array.isArray(answer.bookIds) || answer.bookIds.some((id) => !byId.has(id))) throw new Error('Invalid book selection');
    const books: SemanticSearchResultItem[] = [...new Set(answer.bookIds)].slice(0, 5).map((id) => {
      const book = byId.get(id)!;
      return { book, score: 0, suggestion_tier: 'Gợi ý tham khảo', reason: { matched_fields: ['description'], matched_terms: [], excerpt: book.description.split(/(?<=[.!?])\s+/)[0] || book.description } };
    });
    return { text: answer.text, books, suggestions: answer.suggestions ?? [], source: 'gemini', model: answer.model, context: { query: answer.query || fallback.context?.query || input, onlyAvailable, shownBookIds: [...new Set([...(more ? previous?.shownBookIds ?? [] : []), ...books.map(({ book }) => book.id)])] } };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Never bypass the Google sign-in requirement with a local answer.
    if (error instanceof AIRequestError && [401, 403].includes(error.status)) throw error;
    return { ...fallback, source: 'library', providerNotice: `${error instanceof AIRequestError ? error.message : 'Không kết nối được Gemini.'} Mình dùng tìm kiếm thư viện để giúp bạn trong lúc chờ.` };
  }
}
