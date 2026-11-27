import { SEED_BOOKS } from '../data/seedCatalog';
import { LEGACY_CATALOG_FINGERPRINTS } from '../data/legacyCatalog';
import type { Book, BookEmbeddingRecord } from '../types/library';
import { simpleContentHash } from '../utils/vietnamese';
import { computeBookContentHash } from './semanticEngine';

interface CatalogState { books: Book[]; embeddings: BookEmbeddingRecord[] }

/** Upgrade untouched demo metadata without resetting accounts, copies or circulation. */
export function migrateCatalog<T extends CatalogState>(state: T): T {
  const seeds = new Map(SEED_BOOKS.map(book => [book.id, book]));
  const updated = new Map<string, Book>();
  const books = state.books.map(book => {
    const seed = seeds.get(book.id);
    if (!seed || book.catalog_revision === seed.catalog_revision) return book;
    const fingerprint = simpleContentHash(JSON.stringify([book.title, book.author, book.description]));
    if (!LEGACY_CATALOG_FINGERPRINTS[book.id]?.includes(fingerprint)) return book;
    const next = {
      ...book,
      title: seed.title, author: seed.author, description: seed.description,
      word_count: seed.word_count, missing_description: seed.missing_description,
      metadata_source: seed.metadata_source, license_verified: seed.license_verified,
      cover_image: seed.cover_image, cover_title: seed.cover_title,
      source_url: seed.source_url, source_name: seed.source_name, isbn: seed.isbn,
      language: seed.language, catalog_revision: seed.catalog_revision, updated_at: seed.updated_at,
    };
    updated.set(book.id, next);
    return next;
  });
  if (updated.size === 0) return state;
  const embeddings = state.embeddings.map(record => {
    const book = updated.get(record.book_id);
    return book ? { ...record, content_hash: computeBookContentHash(book), updated_at: book.updated_at } : record;
  });
  return { ...state, books, embeddings };
}
