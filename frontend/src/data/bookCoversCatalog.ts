import { SEED_BOOKS, SEED_COPIES } from './seedCatalog';
import type { Book, BookWithAvailability } from '../types/library';

function stripAccentsVi(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export type SheetId = 'covers' | 'spines' | 'fix' | 'fix2';

export type VasariFilmId =
  | 'valley'
  | 'bluehour'
  | 'river'
  | 'summer'
  | 'green'
  | 'noon'
  | 'observer'
  | 'birds'
  | 'storm'
  | 'tide'
  | 'war'
  | 'door';

export type VasariDecade = '1950s' | '1960s' | '1970s' | '1980s';

export type CropKey = `spine-${VasariFilmId}` | `cover-${VasariFilmId}`;

export type SheetTuple = [string, number, number] & {
  readonly url: string;
  readonly W: number;
  readonly H: number;
  readonly width: number;
  readonly height: number;
};

export type CropTuple = [SheetId, number, number, number, number] & {
  readonly sheet: SheetId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

function makeSheetTuple(url: string, W: number, H: number): SheetTuple {
  const tuple = [url, W, H] as unknown as SheetTuple;
  Object.defineProperties(tuple, {
    url: { get: () => url },
    W: { get: () => W },
    H: { get: () => H },
    width: { get: () => W },
    height: { get: () => H },
  });
  return tuple;
}

function makeCropTuple(sheet: SheetId, x: number, y: number, w: number, h: number): CropTuple {
  const tuple = [sheet, x, y, w, h] as unknown as CropTuple;
  Object.defineProperties(tuple, {
    sheet: { get: () => sheet },
    x: { get: () => x },
    y: { get: () => y },
    w: { get: () => w },
    h: { get: () => h },
  });
  return tuple;
}

export const SHEET: Record<SheetId, SheetTuple> = {
  covers: makeSheetTuple(
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_010644_837e04ca-2418-45c1-b8e0-0233265c4cd5.png&w=1744&q=85',
    1744,
    2336
  ),
  spines: makeSheetTuple(
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_010738_a3e47ead-18f2-4974-9468-06d16a25edc5.png&w=2688&q=85',
    2688,
    1152
  ),
  fix: makeSheetTuple(
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_010831_3ebb874b-93dc-433e-87ed-6299aba720f0.png&w=1520&q=85',
    1520,
    2688
  ),
  fix2: makeSheetTuple(
    'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_092020_f96bc094-db7b-46de-9298-074a24e0a3b8.png&w=1520&q=85',
    1520,
    2688
  ),
};

export const FILM_IDS: readonly VasariFilmId[] = [
  'valley',
  'bluehour',
  'river',
  'summer',
  'green',
  'noon',
  'observer',
  'birds',
  'storm',
  'tide',
  'war',
  'door',
] as const;

export const CROP: Record<CropKey, CropTuple> = {
  'spine-valley': makeCropTuple('spines', 266, 31, 189, 1089),
  'cover-valley': makeCropTuple('covers', 497, 72, 344, 659),

  'spine-bluehour': makeCropTuple('spines', 492, 31, 189, 1089),
  'cover-bluehour': makeCropTuple('covers', 914, 72, 342, 659),

  'spine-river': makeCropTuple('fix', 197, 54, 324, 2566),
  'cover-river': makeCropTuple('covers', 1332, 72, 344, 659),

  'spine-summer': makeCropTuple('spines', 937, 31, 188, 1089),
  'cover-summer': makeCropTuple('covers', 74, 813, 344, 676),

  'spine-green': makeCropTuple('spines', 1157, 31, 185, 1090),
  'cover-green': makeCropTuple('covers', 497, 815, 344, 674),

  'spine-noon': makeCropTuple('spines', 44, 32, 184, 1088),
  'cover-noon': makeCropTuple('covers', 74, 72, 347, 659),

  'spine-observer': makeCropTuple('fix2', 371, 15, 349, 2655),
  'cover-observer': makeCropTuple('covers', 915, 815, 342, 675),

  'spine-birds': makeCropTuple('spines', 1573, 31, 183, 1089),
  'cover-birds': makeCropTuple('covers', 1331, 815, 345, 675),

  'spine-storm': makeCropTuple('fix2', 808, 15, 347, 2656),
  'cover-storm': makeCropTuple('covers', 74, 1571, 345, 681),

  'spine-tide': makeCropTuple('spines', 2012, 31, 188, 1089),
  'cover-tide': makeCropTuple('covers', 496, 1577, 343, 678),

  'spine-war': makeCropTuple('spines', 2236, 31, 189, 1089),
  'cover-war': makeCropTuple('covers', 913, 1579, 343, 676),

  'spine-door': makeCropTuple('spines', 2462, 31, 188, 1089),
  'cover-door': makeCropTuple('covers', 1331, 1579, 344, 677),
};

export interface VasariFilmSpec {
  index: number;
  id: VasariFilmId;
  title: string;
  romaji: string;
  kanji: string;
  hanNom: string;
  year: number;
  decade: VasariDecade;
  genre: string;
  minutes: number;
  synopsis: string;
}

export const VASARI_FILMS: readonly VasariFilmSpec[] = [
  {
    index: 0,
    id: 'valley',
    title: 'The Silent Valley',
    romaji: 'SHIZUKANA TANI',
    kanji: '静かな谷',
    hanNom: '碧眼 · 静かな谷',
    year: 1958,
    decade: '1950s',
    genre: 'Drama',
    minutes: 104,
    synopsis:
      'A schoolteacher returns to the mountain village that exiled her father, and finds the valley has kept every one of its secrets.',
  },
  {
    index: 1,
    id: 'bluehour',
    title: 'The Blue Hour',
    romaji: 'AO NO TOKI',
    kanji: '青の刻',
    hanNom: '童年之票 · 青の刻',
    year: 1962,
    decade: '1960s',
    genre: 'Romance',
    minutes: 97,
    synopsis:
      'Over one long evening in a harbour town, a widow and a stranger trade small lies until the light runs out.',
  },
  {
    index: 2,
    id: 'river',
    title: 'River of Salt',
    romaji: 'SHIO NO KAWA',
    kanji: '塩の川',
    hanNom: '蟋蟀漂流記 · 塩の川',
    year: 1964,
    decade: '1960s',
    genre: 'Drama',
    minutes: 121,
    synopsis:
      'Two brothers drag a salt barge downriver to a city that no longer wants anything they carry.',
  },
  {
    index: 3,
    id: 'summer',
    title: 'The Last Summer',
    romaji: 'SAIGO NO NATSU',
    kanji: '最後の夏',
    hanNom: '南方森林地 · 最後の夏',
    year: 1966,
    decade: '1960s',
    genre: 'Drama',
    minutes: 109,
    synopsis:
      'The summer before the dam floods their village, three friends set fire to everything they cannot take with them.',
  },
  {
    index: 4,
    id: 'green',
    title: 'The Green Road',
    romaji: 'MIDORI NO MICHI',
    kanji: '緑の道',
    hanNom: '紅運 · 緑の道',
    year: 1969,
    decade: '1960s',
    genre: 'Mystery',
    minutes: 101,
    synopsis:
      'A surveyor mapping a forest road keeps finding the same footprints, always one day ahead of him.',
  },
  {
    index: 5,
    id: 'noon',
    title: 'Noon in Ashes',
    romaji: 'HAI NO SHOGO',
    kanji: '灰の正午',
    hanNom: '熄燈 · 灰の正午',
    year: 1971,
    decade: '1970s',
    genre: 'Western',
    minutes: 112,
    synopsis:
      'A rider crosses a white desert to settle an old debt, and learns too late who sent him.',
  },
  {
    index: 6,
    id: 'observer',
    title: 'The Observer',
    romaji: 'KANSATSUSHA',
    kanji: '観察者',
    hanNom: '一時之影 · 観察者',
    year: 1973,
    decade: '1970s',
    genre: 'Thriller',
    minutes: 96,
    synopsis:
      'A night watchman begins to suspect that the building he guards has started watching him back.',
  },
  {
    index: 7,
    id: 'birds',
    title: 'The Fallen Birds',
    romaji: 'OCHITA TORI',
    kanji: '落ちた鳥',
    hanNom: '静寂沙壩 · 落ちた鳥',
    year: 1975,
    decade: '1970s',
    genre: 'Drama',
    minutes: 118,
    synopsis:
      "When the birds stop singing over a frontier town, the mayor's daughter is the only one who goes looking for the reason.",
  },
  {
    index: 8,
    id: 'storm',
    title: 'Light in the Storm',
    romaji: 'ARASHI NO HI',
    kanji: '嵐の灯',
    hanNom: '遠方之舟 · 嵐の灯',
    year: 1978,
    decade: '1970s',
    genre: 'Drama',
    minutes: 127,
    synopsis:
      'A lighthouse keeper and his son wait out a three-day storm with a shipwrecked sailor who will not give his name.',
  },
  {
    index: 9,
    id: 'tide',
    title: 'The Long Tide',
    romaji: 'NAGAI SHIO',
    kanji: '長い潮',
    hanNom: '激烈童年 · 長い潮',
    year: 1981,
    decade: '1980s',
    genre: 'Drama',
    minutes: 99,
    synopsis:
      "A fisherman's wife counts the tides on the harbour wall while her husband's boat fails to come home.",
  },
  {
    index: 10,
    id: 'war',
    title: 'A Quiet War',
    romaji: 'SHIZUKANA SENSO',
    kanji: '静かな戦争',
    hanNom: '無盡之野 · 静かな戦争',
    year: 1985,
    decade: '1980s',
    genre: 'Comedy',
    minutes: 103,
    synopsis:
      'Two neighbours fight a silent war over a garden wall for thirty years, and neither will say how it began.',
  },
  {
    index: 11,
    id: 'door',
    title: 'Red Door',
    romaji: 'AKAI TOBIRA',
    kanji: '赤い扉',
    hanNom: '開窗閉目 · 赤い扉',
    year: 1989,
    decade: '1980s',
    genre: 'Thriller',
    minutes: 114,
    synopsis:
      'A projectionist follows a reel of unknown film through the corridors of a cinema on its final night.',
  },
] as const;

export const DECADE_TABS = [
  { id: 'ALL', label: 'All', decade: null, firstSlotIndex: 0 },
  { id: '1950s', label: '1950s', decade: '1950s' as VasariDecade, firstSlotIndex: 0 },
  { id: '1960s', label: '1960s', decade: '1960s' as VasariDecade, firstSlotIndex: 1 },
  { id: '1970s', label: '1970s', decade: '1970s' as VasariDecade, firstSlotIndex: 5 },
  { id: '1980s', label: '1980s', decade: '1980s' as VasariDecade, firstSlotIndex: 9 },
] as const;

export const INK_BLOBS: ReadonlyArray<{ cx: number; cy: number; delay: number }> = [
  { cx: 150, cy: 330, delay: 0 },
  { cx: 340, cy: 600, delay: 120 },
  { cx: 250, cy: 120, delay: 220 },
  { cx: 90, cy: 760, delay: 300 },
  { cx: 400, cy: 250, delay: 360 },
  { cx: 260, cy: 860, delay: 420 },
  { cx: 230, cy: 470, delay: 180 },
] as const;

function resolveCropArgs(
  sheetOrCropKey: SheetId | CropKey,
  xArg?: number,
  yArg?: number,
  wArg?: number,
  hArg?: number
): [SheetId, number, number, number, number] {
  if (sheetOrCropKey in CROP && xArg === undefined) {
    const [sheet, x, y, w, h] = CROP[sheetOrCropKey as CropKey];
    return [sheet, x, y, w, h];
  }
  return [
    sheetOrCropKey as SheetId,
    xArg ?? 0,
    yArg ?? 0,
    wArg ?? 1,
    hArg ?? 1,
  ];
}

export function computeSpriteCropStyle(
  sheetOrCropKey: SheetId | CropKey,
  xArg?: number,
  yArg?: number,
  wArg?: number,
  hArg?: number
): {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
} {
  const [sheetId, x, y, w, h] = resolveCropArgs(sheetOrCropKey, xArg, yArg, wArg, hArg);
  const [url, W, H] = SHEET[sheetId];
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${(W / w) * 100}% ${(H / h) * 100}%`,
    backgroundPosition: `${(x / (W - w)) * 100}% ${(y / (H - h)) * 100}%`,
  };
}

export function computeSvgPosterRect(
  sheetOrCropKey: SheetId | CropKey,
  xArg?: number,
  yArg?: number,
  wArg?: number,
  hArg?: number
): {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const [sheetId, x, y, w, h] = resolveCropArgs(sheetOrCropKey, xArg, yArg, wArg, hArg);
  const [url, W, H] = SHEET[sheetId];
  return {
    href: url,
    x: (-x * 474) / w,
    y: (-y * 900) / h,
    width: (W * 474) / w,
    height: (H * 900) / h,
  };
}

export function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

export function B(r: number): number {
  if (Math.abs(r) < 1) {
    return (r + Math.sin(Math.PI * r) / Math.PI) / 2;
  }
  return Math.sign(r) * 0.5;
}

export const smoothStepB = B;

export function F(r: number, ws: number, d: number, gap: number): number {
  return r * (ws + gap) + (d - ws + 1.6 * gap) * B(r);
}

export const computeHorizontalX = F;

export function computeRelativeIndex(v: number, s: number, total = 36): number {
  let r = (v - s) % total;
  if (r > total / 2) r -= total;
  if (r < -total / 2) r += total;
  return r;
}

export function computeOpenness(r: number): number {
  return smoothstep(Math.max(0, 1 - Math.abs(r)));
}

export function computeShelfDimensions(H: number): {
  H: number;
  ws: number;
  d: number;
  gap: number;
} {
  return {
    H,
    ws: (H * 142) / 840,
    d: (H * 474) / 900,
    gap: H * 0.03,
  };
}

export function computeTapeTransform(
  r: number,
  H: number,
  ws: number,
  d: number,
  gap: number,
  tiltX = 0,
  tiltY = 0,
  lift = 0
): {
  x: number;
  y: number;
  z: number;
  o: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  zIndex: number;
  spineShade: number;
  coverShade: number;
  transform: string;
} {
  const o = computeOpenness(r);
  const x = F(r, ws, d, gap);
  const y = -o * 0.025 * H - lift * 0.045 * H;
  const z = o * 0.2 * H;
  const rotateZ = -4.5 * o;
  const rotateX = tiltX * o;
  const rotateY = -90 * o + tiltY * o;
  const zIndex = Math.round(100 - Math.abs(r) * 4);
  const spineShade = o * 0.55;
  const coverShade = (1 - o) * 0.5;

  return {
    x,
    y,
    z,
    o,
    rotateX,
    rotateY,
    rotateZ,
    zIndex,
    spineShade,
    coverShade,
    transform: `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rotateZ}deg) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
  };
}

export function computePlayRingScale(T: number, s: number): number {
  return smoothstep(Math.max(0, 1 - Math.abs(T - s) * 3));
}

export function computeShortestLoopTarget(currentT: number, targetSlotIndex: number, count = 12): number {
  const base = Math.round(currentT);
  const currentSlot = ((base % count) + count) % count;
  let diff = targetSlotIndex - currentSlot;
  if (diff > count / 2) diff -= count;
  if (diff < -count / 2) diff += count;
  return base + diff;
}

export function buildSeedBooksWithAvailability(): BookWithAvailability[] {
  return SEED_BOOKS.map((book) => {
    const bookCopies = SEED_COPIES.filter((c) => c.book_id === book.id);
    const available = bookCopies.filter((c) => c.status === 'available').length;
    const borrowed = bookCopies.filter((c) => c.status === 'borrowed').length;
    const maintenance = bookCopies.filter((c) => c.status === 'maintenance').length;
    return {
      ...book,
      total_copies: bookCopies.length,
      available_copies: available,
      borrowed_copies: borrowed,
      maintenance_copies: maintenance,
      index_status: 'ready' as const,
    };
  });
}

export const SEED_BOOKS_WITH_AVAILABILITY: BookWithAvailability[] = buildSeedBooksWithAvailability();

function toBookWithAvailability(book: Book | BookWithAvailability): BookWithAvailability {
  if ('available_copies' in book && typeof book.available_copies === 'number') {
    return book;
  }
  const found = SEED_BOOKS_WITH_AVAILABILITY.find((b) => b.id === book.id);
  if (found) {
    return { ...found, ...book };
  }
  return {
    ...book,
    total_copies: 2,
    available_copies: 2,
    borrowed_copies: 0,
    maintenance_copies: 0,
    index_status: 'ready',
  };
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function splitTitleLines(title: string, maxCharsPerLine = 20): [string, string] {
  const words = title.trim().split(/\s+/);
  let line1 = '';
  let line2 = '';
  for (const w of words) {
    if (!line2 && (line1 ? `${line1} ${w}` : w).length <= maxCharsPerLine) {
      line1 = line1 ? `${line1} ${w}` : w;
    } else {
      line2 = line2 ? `${line2} ${w}` : w;
    }
  }
  if (line2.length > maxCharsPerLine + 4) {
    line2 = `${line2.slice(0, maxCharsPerLine + 2)}…`;
  }
  return [line1, line2];
}

function buildCoverJacketSvgDataUri(book: BookWithAvailability): string {
  const [line1, line2] = splitTitleLines(book.title, 18);
  const titleFontSize = line2 ? 32 : 38;
  const line1Y = line2 ? 136 : 158;
  const authorY = line2 ? 232 : 216;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 474 900">
    <rect x="0" y="0" width="474" height="312" fill="#EDEBE6"/>
    <line x1="26" y1="312" x2="448" y2="312" stroke="#141414" stroke-opacity="0.28" stroke-width="1"/>
    <text x="237" y="64" text-anchor="middle" fill="#6D6A63" font-family="Inter Tight, sans-serif" font-size="11" font-weight="600" letter-spacing="2.2">${escapeXml(book.category.toUpperCase())}</text>
    <text x="237" y="${line1Y}" text-anchor="middle" fill="#141414" font-family="Newsreader, Georgia, serif" font-size="${titleFontSize}" font-weight="400">${escapeXml(line1)}</text>
    ${
      line2
        ? `<text x="237" y="178" text-anchor="middle" fill="#141414" font-family="Newsreader, Georgia, serif" font-size="${titleFontSize}" font-weight="400">${escapeXml(line2)}</text>`
        : ''
    }
    <text x="237" y="${authorY}" text-anchor="middle" fill="#1F3FB0" font-family="Inter Tight, sans-serif" font-size="12.5" font-weight="600" letter-spacing="1.6">${escapeXml(book.author.toUpperCase())}</text>

    <rect x="0" y="794" width="474" height="106" fill="#EDEBE6"/>
    <line x1="26" y1="794" x2="448" y2="794" stroke="#141414" stroke-opacity="0.28" stroke-width="1"/>
    <text x="32" y="848" fill="#6D6A63" font-family="Inter Tight, sans-serif" font-size="11" font-weight="600" letter-spacing="1.5">KỆ ${escapeXml(book.shelf)} · ${escapeXml(book.code)}</text>
    <text x="442" y="848" text-anchor="end" fill="#141414" font-family="Inter Tight, sans-serif" font-size="11" font-weight="600" letter-spacing="1.2">CÒN ${book.available_copies}/${book.total_copies} BẢN</text>
    <rect x="12" y="12" width="450" height="876" fill="none" stroke="#141414" stroke-opacity="0.22" stroke-width="1"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildSpineJacketSvgDataUri(book: BookWithAvailability): string {
  const trimmed = book.title.trim();
  const shortTitle = trimmed.length > 34 ? `${trimmed.slice(0, 32)}…` : trimmed;
  const spineFontSize = shortTitle.length > 26 ? 15.5 : shortTitle.length > 18 ? 17.5 : 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 142 840">
    <rect x="10" y="158" width="122" height="670" fill="#EDEBE6" stroke="#141414" stroke-opacity="0.22" stroke-width="1"/>
    <text x="71" y="192" text-anchor="middle" fill="#1F3FB0" font-family="Inter Tight, sans-serif" font-size="10.5" font-weight="600" letter-spacing="1.4">${escapeXml(book.shelf)}</text>
    <line x1="28" y1="208" x2="114" y2="208" stroke="#141414" stroke-opacity="0.2" stroke-width="1"/>
    <g transform="translate(76, 485) rotate(-90)">
      <text x="0" y="0" text-anchor="middle" fill="#141414" font-family="Newsreader, Georgia, serif" font-size="${spineFontSize}" font-weight="400" letter-spacing="0.4">${escapeXml(shortTitle)}</text>
    </g>
    <line x1="28" y1="766" x2="114" y2="766" stroke="#141414" stroke-opacity="0.2" stroke-width="1"/>
    <text x="71" y="798" text-anchor="middle" fill="#6D6A63" font-family="Inter Tight, sans-serif" font-size="10" font-weight="600" letter-spacing="1">${escapeXml(book.id)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface VasariShelfBook extends BookWithAvailability {
  slotIndex: number;
  filmId: VasariFilmId;
  filmTitle: string;
  romaji: string;
  kanji: string;
  hanNom: string;
  subtitle: string;
  year: number;
  decade: VasariDecade;
  genre: string;
  minutes: number;
  spineCropKey: CropKey;
  coverCropKey: CropKey;
  spineCrop: CropTuple;
  coverCrop: CropTuple;
  spineStyle: {
    backgroundImage: string;
    backgroundSize: string;
    backgroundPosition: string;
  };
  coverStyle: {
    backgroundImage: string;
    backgroundSize: string;
    backgroundPosition: string;
  };
  posterRect: {
    href: string;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  coverJacketDataUri: string;
  spineJacketDataUri: string;
}

export function getShelfBooksForLocalDb(
  inputBooks?: ReadonlyArray<Book | BookWithAvailability>
): VasariShelfBook[] {
  const sourceList =
    inputBooks && inputBooks.length > 0
      ? inputBooks.map(toBookWithAvailability)
      : SEED_BOOKS_WITH_AVAILABILITY;

  const selected12: BookWithAvailability[] = [];
  for (let i = 0; i < 12; i++) {
    if (i < sourceList.length) {
      selected12.push(sourceList[i]);
    } else {
      const fallback =
        SEED_BOOKS_WITH_AVAILABILITY.find((b) => !selected12.some((s) => s.id === b.id)) ??
        sourceList[i % sourceList.length];
      selected12.push(fallback);
    }
  }

  return VASARI_FILMS.map((film, slotIndex) => {
    const book = selected12[slotIndex];
    const spineCropKey: CropKey = `spine-${film.id}`;
    const coverCropKey: CropKey = `cover-${film.id}`;
    const spineCrop = CROP[spineCropKey];
    const coverCrop = CROP[coverCropKey];
    const spineStyle = computeSpriteCropStyle(spineCropKey);
    const coverStyle = computeSpriteCropStyle(coverCropKey);
    const posterRect = computeSvgPosterRect(coverCropKey);

    const romajiVi = stripAccentsVi(book.title)
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');
    const combinedRomaji = `${romajiVi} • ${film.romaji}`;
    const subtitle = `${book.author} · ${book.category} · Kệ ${book.shelf} · Còn ${book.available_copies}/${book.total_copies} bản`;

    return {
      ...book,
      slotIndex,
      filmId: film.id,
      filmTitle: film.title,
      romaji: combinedRomaji,
      kanji: film.kanji,
      hanNom: film.hanNom,
      subtitle,
      year: film.year,
      decade: film.decade,
      genre: film.genre,
      minutes: film.minutes,
      spineCropKey,
      coverCropKey,
      spineCrop,
      coverCrop,
      spineStyle,
      coverStyle,
      posterRect,
      coverJacketDataUri: buildCoverJacketSvgDataUri(book),
      spineJacketDataUri: buildSpineJacketSvgDataUri(book),
    };
  });
}

export function preloadVasariSheets(): HTMLImageElement[] {
  if (typeof Image === 'undefined') return [];
  return (Object.keys(SHEET) as SheetId[]).map((id) => {
    const img = new Image();
    img.src = SHEET[id][0];
    return img;
  });
}
