import React, { useEffect, useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import type { Book } from '../types/library';
import { normalizeSearchText } from '../utils/vietnamese';

type MediaBook = Pick<Book, 'title' | 'cover_image' | 'cover_title' | 'source_url' | 'source_name'>;

export function getBookSource(book: MediaBook): string | undefined {
  if (book.cover_title && normalizeSearchText(book.cover_title) !== normalizeSearchText(book.title)) return undefined;
  try {
    const url = new URL(book.source_url ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* A book without a verified source has no external link. */ }
  return undefined;
}

export const BookCover: React.FC<{ book: MediaBook; size?: 'small' | 'card' | 'detail'; eager?: boolean }> = ({ book, size = 'card', eager = false }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [book.cover_image, book.title]);
  const hasVerifiedTitle = !book.cover_title || normalizeSearchText(book.cover_title) === normalizeSearchText(book.title);
  const image = hasVerifiedTitle && /^\/covers\/B\d{3}\.(?:jpg|jpeg|png|webp)$/.test(book.cover_image ?? '') ? book.cover_image : undefined;
  return <div className={`real-book-cover ${size}`}>
    {image && !failed ? <img src={image} alt={`Bìa sách ${book.title}`} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} /> : <div className="book-cover-unavailable"><BookOpen size={size === 'small' ? 19 : 30} strokeWidth={1.4} /><span>Chưa có bìa</span></div>}
  </div>;
};

export const BookSourceLink: React.FC<{ book: MediaBook; className?: string }> = ({ book, className = '' }) => {
  const url = getBookSource(book);
  if (!url) return null;
  return <a className={`book-source-link ${className}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Trang sách tại ${book.source_name || 'nhà phát hành'}: ${book.title}`}><ExternalLink size={14} /><span>{book.source_name || 'Trang sách gốc'}</span></a>;
};

export const BookLanguage: React.FC<{ book: Pick<Book, 'language'> }> = ({ book }) => book.language && book.language !== 'Tiếng Việt'
  ? <span className="book-language">{book.language}</span> : null;
