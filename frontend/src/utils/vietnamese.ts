/**
 * Tiện ích chuẩn hóa tiếng Việt (hỗ trợ tìm kiếm có dấu / không dấu - TC05),
 * tính ngày quá hạn theo múi giờ máy chủ Việt Nam (TC16) và xuất CSV UTF-8 BOM (T31).
 */

export function stripVietnameseAccents(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeSearchText(input: string): string {
  return stripVietnameseAccents(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Chuyển một mốc thời gian ISO sang chuỗi ngày YYYY-MM-DD theo múi giờ máy chủ (Asia/Ho_Chi_Minh).
 * Đảm bảo TC16: Đúng ngày đến hạn chưa gắn quá hạn; qua ngày theo múi giờ máy chủ mới quá hạn.
 */
export function toServerDateKey(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // YYYY-MM-DD
}

export function computeDaysRemaining(dueAtIso: string, now: Date = new Date()): number {
  const dueKey = toServerDateKey(dueAtIso);
  const nowKey = toServerDateKey(now);
  const dueMidnight = new Date(`${dueKey}T00:00:00Z`).getTime();
  const nowMidnight = new Date(`${nowKey}T00:00:00Z`).getTime();
  return Math.round((dueMidnight - nowMidnight) / (1000 * 60 * 60 * 24));
}

export function isLoanOverdue(dueAtIso: string, returnedAtIso: string | null, now: Date = new Date()): boolean {
  if (returnedAtIso) return false;
  return computeDaysRemaining(dueAtIso, now) < 0;
}

export function addDaysIso(startIso: string, days: number): string {
  const date = new Date(startIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function formatDateVi(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function simpleContentHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildCsvUtf8Bom<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<{ key: keyof T; label: string }>
): string {
  const escapeCell = (val: unknown): string => {
    const str = val === null || val === undefined ? '' : String(val);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(','));
  return '\uFEFF' + [header, ...lines].join('\n') + '\n';
}
