import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SEED_BOOKS } from '../data/seedCatalog';
import { BookCover, BookSourceLink } from '../components/BookMedia';
import { migrateCatalog } from '../services/catalogMigration';
import { computeBookContentHash, MODEL_REVISION } from '../services/semanticEngine';
import legacyBook from './fixtures/legacy-book.json';
import type { Book, BookEmbeddingRecord } from '../types/library';

describe('Danh mục sách thật', () => {
  it('đủ 100 sách có nguồn riêng và bìa đúng file đã đối chiếu', () => {
    const sources = JSON.parse(fs.readFileSync(path.resolve('..', 'data', 'book_sources_100.json'), 'utf8'));
    expect(SEED_BOOKS).toHaveLength(100);
    expect(sources).toHaveLength(100);
    expect(new Set(SEED_BOOKS.map(book => book.source_url)).size).toBe(100);
    for (const book of SEED_BOOKS) {
      const source = sources.find((row: { id: string }) => row.id === book.id);
      expect(book.cover_title).toBe(book.title);
      expect(book.source_url).toMatch(/^https:\/\//);
      expect(book.author.length).toBeGreaterThanOrEqual(2);
      expect(book.author.length).toBeLessThan(180);
      expect(source.title).toBe(book.title);
      expect(source.source_url).toBe(book.source_url);
      const bytes = fs.readFileSync(path.resolve('public', `.${book.cover_image}`));
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
      expect(source.image_http_status).toBe(200);
      expect(bytes.length).toBeGreaterThan(1500);
      expect(book.description.split(/\s+/).length).toBe(book.word_count);
    }
  });

  it('hiển thị ảnh thật, liên kết ngoài an toàn và dự phòng nếu ảnh lỗi', () => {
    const book = SEED_BOOKS[0];
    render(<><BookCover book={book} /><BookSourceLink book={book} /></>);
    const cover = screen.getByRole('img', { name: `Bìa sách ${book.title}` });
    expect(cover).toHaveAttribute('src', book.cover_image);
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link')).toHaveAttribute('href', book.source_url);
    fireEvent.error(cover);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Chưa có bìa')).toBeInTheDocument();
  });

  it('ẩn ảnh và nguồn cũ khi thủ thư đổi tên sách', () => {
    render(<><BookCover book={{ ...SEED_BOOKS[0], title: 'Tác phẩm mới' }} /><BookSourceLink book={{ ...SEED_BOOKS[0], title: 'Tác phẩm mới' }} /></>);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('không hiển thị đường dẫn script hoặc ảnh ngoài danh mục', () => {
    render(<><BookCover book={{ ...SEED_BOOKS[0], cover_image: 'https://example.test/fake.jpg' }} /><BookSourceLink book={{ ...SEED_BOOKS[0], source_url: 'javascript:alert(1)' }} /></>);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

function oldState() {
  const book: Book = { ...legacyBook, shelf: 'KỆ-RIÊNG', visible: false };
  const embedding: BookEmbeddingRecord = { book_id: book.id, content_hash: computeBookContentHash(book), model_revision: MODEL_REVISION, status: 'ready', updated_at: book.updated_at };
  return { books: [book], embeddings: [embedding], loans: [{ id: 'loan-kept', book_id: book.id }], favorites: [{ book_id: book.id }], users: [{ id: 'reader-kept' }], copies: [{ book_id: book.id, status: 'borrowed' }], requests: [{ id: 'request-kept' }] };
}

describe('Cập nhật danh mục cũ', () => {
  it('cập nhật metadata và chỉ mục, giữ mã, kệ, trạng thái ẩn và dữ liệu người đọc', () => {
    const before = oldState();
    const after = migrateCatalog(before);
    expect(after.books[0].cover_image).toBe(SEED_BOOKS[0].cover_image);
    expect(after.books[0].code).toBe(before.books[0].code);
    expect(after.books[0].shelf).toBe('KỆ-RIÊNG');
    expect(after.books[0].visible).toBe(false);
    expect(after.embeddings[0].content_hash).toBe(computeBookContentHash(after.books[0]));
    for (const field of ['loans', 'favorites', 'users', 'copies', 'requests'] as const) expect(after[field]).toBe(before[field]);
    expect(migrateCatalog(after)).toBe(after);
  });

  it('giữ nguyên sách người dùng đã sửa và sách tự thêm', () => {
    const before = oldState();
    before.books[0].description = 'Nội dung do thủ thư tự biên tập.';
    before.books.push({ ...before.books[0], id: 'CUSTOM-01' });
    expect(migrateCatalog(before)).toBe(before);
  });

  it('không tự bật chỉ mục đang chờ xử lý', () => {
    const before = oldState();
    before.embeddings[0].status = 'pending';
    expect(migrateCatalog(before).embeddings[0].status).toBe('pending');
  });

  it('cập nhật bản metadata đầu tiên đã lưu trong khi đối chiếu ấn bản', () => {
    const book = SEED_BOOKS.find(item => item.id === 'B054')!;
    const before = { books: [{ ...book, author: 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein', catalog_revision: 'real-books-2026-11-27' }], embeddings: [] };
    const after = migrateCatalog(before);
    expect(after.books[0].author).toBe(book.author);
    expect(after.books[0].catalog_revision).toBe(book.catalog_revision);
  });
});
