import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { VasariShelfHero } from '../components/VasariShelfHero';
import {
  B,
  CROP,
  DECADE_TABS,
  F,
  FILM_IDS,
  INK_BLOBS,
  SEED_BOOKS_WITH_AVAILABILITY,
  SHEET,
  VASARI_FILMS,
  computeOpenness,
  computePlayRingScale,
  computeRelativeIndex,
  computeShelfDimensions,
  computeShortestLoopTarget,
  computeSpriteCropStyle,
  computeSvgPosterRect,
  computeTapeTransform,
  getShelfBooksForLocalDb,
  smoothstep,
  type CropKey,
  type SheetId,
  type VasariFilmId,
} from '../data/bookCoversCatalog';
import { API_BASE_URL, ApiClientError, LibMateApiClient, apiClient } from '../services/apiClient';
import { libraryStore } from '../services/libraryStore';

function renderShelf(books = SEED_BOOKS_WITH_AVAILABILITY) {
  return render(
    <MemoryRouter
      initialEntries={['/']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <VasariShelfHero books={books} />
    </MemoryRouter>
  );
}

describe('Leon Vasari 3D Book Shelf Hero & Local DB Book Cover Integration', () => {
  describe('1. Unit Tests — Sprite Sheets, Crop Coordinates & 3D Shelf Math', () => {
    it('verifies SHEET has exact 4 Higgsfield WebP sheets with dimensions (covers, spines, fix, fix2)', () => {
      expect(Object.keys(SHEET)).toEqual(['covers', 'spines', 'fix', 'fix2']);

      expect(SHEET.covers[0]).toBe(
        'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_010644_837e04ca-2418-45c1-b8e0-0233265c4cd5.png&w=1744&q=85'
      );
      expect([SHEET.covers[1], SHEET.covers[2]]).toEqual([1744, 2336]);

      expect(SHEET.spines[0]).toBe(
        'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_010738_a3e47ead-18f2-4974-9468-06d16a25edc5.png&w=2688&q=85'
      );
      expect([SHEET.spines[1], SHEET.spines[2]]).toEqual([2688, 1152]);

      expect(SHEET.fix[0]).toBe(
        'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_010831_3ebb874b-93dc-433e-87ed-6299aba720f0.png&w=1520&q=85'
      );
      expect([SHEET.fix[1], SHEET.fix[2]]).toEqual([1520, 2688]);

      expect(SHEET.fix2[0]).toBe(
        'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261029_092020_f96bc094-db7b-46de-9298-074a24e0a3b8.png&w=1520&q=85'
      );
      expect([SHEET.fix2[1], SHEET.fix2[2]]).toEqual([1520, 2688]);
    });

    it('verifies CROP has exact pixel coordinates for all 12 spine-* and cover-* slots', () => {
      const expectedIds: VasariFilmId[] = [
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
      ];
      expect(FILM_IDS).toEqual(expectedIds);

      const expectedCrops: Record<CropKey, [SheetId, number, number, number, number]> = {
        'spine-valley': ['spines', 266, 31, 189, 1089],
        'cover-valley': ['covers', 497, 72, 344, 659],
        'spine-bluehour': ['spines', 492, 31, 189, 1089],
        'cover-bluehour': ['covers', 914, 72, 342, 659],
        'spine-river': ['fix', 197, 54, 324, 2566],
        'cover-river': ['covers', 1332, 72, 344, 659],
        'spine-summer': ['spines', 937, 31, 188, 1089],
        'cover-summer': ['covers', 74, 813, 344, 676],
        'spine-green': ['spines', 1157, 31, 185, 1090],
        'cover-green': ['covers', 497, 815, 344, 674],
        'spine-noon': ['spines', 44, 32, 184, 1088],
        'cover-noon': ['covers', 74, 72, 347, 659],
        'spine-observer': ['fix2', 371, 15, 349, 2655],
        'cover-observer': ['covers', 915, 815, 342, 675],
        'spine-birds': ['spines', 1573, 31, 183, 1089],
        'cover-birds': ['covers', 1331, 815, 345, 675],
        'spine-storm': ['fix2', 808, 15, 347, 2656],
        'cover-storm': ['covers', 74, 1571, 345, 681],
        'spine-tide': ['spines', 2012, 31, 188, 1089],
        'cover-tide': ['covers', 496, 1577, 343, 678],
        'spine-war': ['spines', 2236, 31, 189, 1089],
        'cover-war': ['covers', 913, 1579, 343, 676],
        'spine-door': ['spines', 2462, 31, 188, 1089],
        'cover-door': ['covers', 1331, 1579, 344, 677],
      };

      for (const [key, expected] of Object.entries(expectedCrops) as Array<
        [CropKey, [SheetId, number, number, number, number]]
      >) {
        const actual = CROP[key];
        expect([actual[0], actual[1], actual[2], actual[3], actual[4]]).toEqual(expected);
      }
    });

    it('verifies computeSpriteCropStyle produces exact background-size and background-position percentages', () => {
      // Test with explicit (sheetId, x, y, w, h) for cover-noon: covers (1744x2336), x=74, y=72, w=347, h=659
      const styleExplicit = computeSpriteCropStyle('covers', 74, 72, 347, 659);
      const styleByKey = computeSpriteCropStyle('cover-noon');

      const expectedSize = `${(1744 / 347) * 100}% ${(2336 / 659) * 100}%`;
      const expectedPos = `${(74 / (1744 - 347)) * 100}% ${(72 / (2336 - 659)) * 100}%`;

      expect(styleExplicit.backgroundImage).toBe(`url(${SHEET.covers[0]})`);
      expect(styleExplicit.backgroundSize).toBe(expectedSize);
      expect(styleExplicit.backgroundPosition).toBe(expectedPos);
      expect(styleByKey).toEqual(styleExplicit);

      // Test spine-river on fix sheet (1520x2688), x=197, y=54, w=324, h=2566
      const spineRiver = computeSpriteCropStyle('spine-river');
      expect(spineRiver.backgroundImage).toBe(`url(${SHEET.fix[0]})`);
      expect(spineRiver.backgroundSize).toBe(`${(1520 / 324) * 100}% ${(2688 / 2566) * 100}%`);
      expect(spineRiver.backgroundPosition).toBe(
        `${(197 / (1520 - 324)) * 100}% ${(54 / (2688 - 2566)) * 100}%`
      );
    });

    it('verifies computeSvgPosterRect produces exact x = -x*474/w, y = -y*900/h, width = W*474/w, height = H*900/h', () => {
      // cover-valley: covers (W=1744, H=2336), x=497, y=72, w=344, h=659
      const rectByKey = computeSvgPosterRect('cover-valley');
      const rectExplicit = computeSvgPosterRect('covers', 497, 72, 344, 659);

      expect(rectByKey).toEqual(rectExplicit);
      expect(rectByKey.href).toBe(SHEET.covers[0]);
      expect(rectByKey.x).toBeCloseTo((-497 * 474) / 344, 8);
      expect(rectByKey.y).toBeCloseTo((-72 * 900) / 659, 8);
      expect(rectByKey.width).toBeCloseTo((1744 * 474) / 344, 8);
      expect(rectByKey.height).toBeCloseTo((2336 * 900) / 659, 8);
    });

    it('verifies smoothstep(x), B(r) continuous step function, F(r) horizontal placement, and 3D rotation formulas', () => {
      // smoothstep(x) = x^2 * (3 - 2x) clamped to [0, 1]
      expect(smoothstep(-0.5)).toBe(0);
      expect(smoothstep(0)).toBe(0);
      expect(smoothstep(0.5)).toBe(0.5);
      expect(smoothstep(1)).toBe(1);
      expect(smoothstep(1.5)).toBe(1);
      expect(smoothstep(0.25)).toBeCloseTo(0.25 * 0.25 * 2.5, 8);

      // B(r) continuous step function: (r + sin(pi*r)/pi)/2 for |r| < 1, else sign(r)*0.5
      expect(B(0)).toBe(0);
      expect(B(1)).toBe(0.5);
      expect(B(2.5)).toBe(0.5);
      expect(B(-1)).toBe(-0.5);
      expect(B(-3)).toBe(-0.5);
      expect(B(0.5)).toBeCloseTo((0.5 + Math.sin(Math.PI * 0.5) / Math.PI) / 2, 8);
      expect(B(-0.5)).toBeCloseTo(-B(0.5), 8);

      // Shelf dimensions from H = 380
      const H = 380;
      const { ws, d, gap } = computeShelfDimensions(H);
      expect(ws).toBeCloseTo((380 * 142) / 840, 8);
      expect(d).toBeCloseTo((380 * 474) / 900, 8);
      expect(gap).toBeCloseTo(380 * 0.03, 8);

      // F(r) horizontal placement: r*(ws + gap) + (d - ws + 1.6*gap)*B(r)
      expect(F(0, ws, d, gap)).toBe(0);
      expect(F(1, ws, d, gap)).toBeCloseTo(1 * (ws + gap) + (d - ws + 1.6 * gap) * 0.5, 8);
      expect(F(-1, ws, d, gap)).toBeCloseTo(-F(1, ws, d, gap), 8);

      // 3D rotation & translation at active book (r = 0 -> o = 1)
      const activeTf = computeTapeTransform(0, H, ws, d, gap, 2, -3, 0);
      expect(activeTf.o).toBe(1);
      expect(activeTf.x).toBe(0);
      expect(activeTf.y).toBeCloseTo(-0.025 * H, 8);
      expect(activeTf.z).toBeCloseTo(0.2 * H, 8);
      expect(activeTf.rotateZ).toBeCloseTo(-4.5, 8);
      expect(activeTf.rotateX).toBeCloseTo(2, 8);
      expect(activeTf.rotateY).toBeCloseTo(-90 + -3, 8);
      expect(activeTf.zIndex).toBe(100);
      expect(activeTf.spineShade).toBeCloseTo(0.55, 8);
      expect(activeTf.coverShade).toBeCloseTo(0, 8);

      // Closed spine (r = 2 -> o = 0) with hover lift = 1
      const spineTf = computeTapeTransform(2, H, ws, d, gap, 4, 5, 1);
      expect(spineTf.o).toBe(0);
      expect(spineTf.z).toBe(0);
      expect(spineTf.y).toBeCloseTo(-0.045 * H, 8);
      expect(spineTf.rotateZ).toBeCloseTo(0, 8);
      expect(spineTf.rotateY).toBeCloseTo(0, 8);
      expect(spineTf.zIndex).toBe(92);
      expect(spineTf.spineShade).toBe(0);
      expect(spineTf.coverShade).toBeCloseTo(0.5, 8);

      // Play ring scale formula: smoothstep(max(0, 1 - |T - s| * 3))
      expect(computePlayRingScale(17, 17)).toBe(1);
      expect(computePlayRingScale(17, 17.4)).toBe(0);

      // Shortest loop target wrapping mod 12
      expect(computeShortestLoopTarget(17, 5, 12)).toBe(17);
      expect(computeShortestLoopTarget(17, 0, 12)).toBe(12);
      expect(computeShortestLoopTarget(17, 9, 12)).toBe(21);
      expect(computeRelativeIndex(17, 17, 36)).toBe(0);
    });

    it('verifies getShelfBooksForLocalDb maps LibMate local DB books with authentic Vietnamese titles, shelf codes, availability counts, and sprite crops', () => {
      const shelfBooks = getShelfBooksForLocalDb(SEED_BOOKS_WITH_AVAILABILITY);
      expect(shelfBooks).toHaveLength(12);

      // Verify first 3 books from seedCatalog: Mắt Biếc, Cho Tôi Xin Một Vé Đi Tuổi Thơ, Dế Mèn Phiêu Lưu Ký
      expect(shelfBooks[0].id).toBe('B001');
      expect(shelfBooks[0].title).toBe('Mắt Biếc');
      expect(shelfBooks[0].filmId).toBe('valley');
      expect(shelfBooks[0].decade).toBe('1950s');

      expect(shelfBooks[1].id).toBe('B002');
      expect(shelfBooks[1].title).toBe('Cho Tôi Xin Một Vé Đi Tuổi Thơ');
      expect(shelfBooks[1].filmId).toBe('bluehour');

      expect(shelfBooks[2].id).toBe('B003');
      expect(shelfBooks[2].title).toBe('Dế Mèn Phiêu Lưu Ký');
      expect(shelfBooks[2].filmId).toBe('river');

      // Default active slot index 5 -> Tắt Đèn (B006, filmId: noon, 1970s)
      expect(shelfBooks[5].id).toBe('B006');
      expect(shelfBooks[5].title).toBe('Tắt Đèn');
      expect(shelfBooks[5].filmId).toBe('noon');
      expect(shelfBooks[5].decade).toBe('1970s');

      shelfBooks.forEach((book, idx) => {
        expect(book.slotIndex).toBe(idx);
        expect(book.filmId).toBe(VASARI_FILMS[idx].id);
        expect(book.shelf).toBeTruthy();
        expect(book.code).toBeTruthy();
        expect(typeof book.available_copies).toBe('number');
        expect(typeof book.total_copies).toBe('number');
        expect(book.spineStyle.backgroundImage).toContain('https://images.higgs.ai/');
        expect(book.coverStyle.backgroundImage).toContain('https://images.higgs.ai/');
        expect(book.coverJacketDataUri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
        expect(book.spineJacketDataUri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
      });
    });
  });

  describe('2. Integration Tests — VasariShelfHero Component & Interactive Flows', () => {
    it('renders <nav aria-label="Decades"> with 5 decade/category buttons and sliding cobalt indicator', () => {
      renderShelf();

      const nav = screen.getByRole('navigation', { name: 'Decades' });
      expect(nav).toBeInTheDocument();

      const buttons = within(nav).getAllByRole('button');
      expect(buttons).toHaveLength(5);
      expect(buttons.map((b) => b.textContent)).toEqual(DECADE_TABS.map((t) => t.label));

      const indicator = screen.getByTestId('vasari-tab-indicator');
      expect(indicator).toBeInTheDocument();

      // Default active book is at slot 5 (1970s), so 1970s tab is highlighted and ALL is never highlighted
      const allBtn = buttons[0];
      const tab1970s = buttons[3];
      expect(allBtn).toHaveAttribute('data-active', 'false');
      expect(tab1970s).toHaveAttribute('data-active', 'true');
    });

    it('renders <section aria-label="Filmography shelf"> with 36 endless 3D book/tape elements and default active book at center (index 5, s = 17)', () => {
      renderShelf();

      const shelfSection = screen.getByRole('region', { name: 'Filmography shelf' });
      expect(shelfSection).toBeInTheDocument();
      expect(shelfSection).toHaveAttribute('data-scroll', '17');
      expect(shelfSection).toHaveAttribute('data-target', '17');
      expect(shelfSection).toHaveAttribute('data-active-slot', '5');

      const tapes = shelfSection.querySelectorAll('.tape');
      expect(tapes).toHaveLength(36);

      // Virtual index 17 (middle copy 1 * 12 + slot 5) is the active center book
      const centerTape = shelfSection.querySelector('.tape[data-virtual-index="17"]')!;
      expect(centerTape).toHaveAttribute('data-active', 'true');
      expect(centerTape).toHaveAttribute('data-slot-index', '5');
      expect(centerTape).toHaveAttribute('data-film-id', 'noon');
      expect(centerTape.querySelector('.face.sp')).toBeInTheDocument();
      expect(centerTape.querySelector('.face.cv')).toBeInTheDocument();
    });

    it('updates target scroll position, active caption (aria-live="polite"), and decade tab highlight on arrow clicks, spine click, and decade tab click', async () => {
      const user = userEvent.setup();
      renderShelf();

      const shelfSection = screen.getByRole('region', { name: 'Filmography shelf' });
      const caption = screen.getByTestId('vasari-caption');
      expect(caption).toHaveAttribute('aria-live', 'polite');

      const shelfBooks = getShelfBooksForLocalDb(SEED_BOOKS_WITH_AVAILABILITY);
      // Initially at slot 5 (s = 17) -> B006 Tắt Đèn (1970s)
      expect(caption).toHaveTextContent(shelfBooks[5].title);

      // Click Next film -> T becomes 18 (slot 6 -> B007 Vang Bóng Một Thời)
      const nextBtn = screen.getByRole('button', { name: 'Next film' });
      await user.click(nextBtn);
      expect(shelfSection).toHaveAttribute('data-target', '18');
      expect(shelfSection).toHaveAttribute('data-active-slot', '6');
      expect(caption).toHaveTextContent(shelfBooks[6].title);

      // Click Previous film twice -> T becomes 16 (slot 4 -> B005 Số Đỏ, 1960s)
      const prevBtn = screen.getByRole('button', { name: 'Previous film' });
      await user.click(prevBtn);
      await user.click(prevBtn);
      expect(shelfSection).toHaveAttribute('data-target', '16');
      expect(shelfSection).toHaveAttribute('data-active-slot', '4');
      expect(caption).toHaveTextContent(shelfBooks[4].title);

      const nav = screen.getByRole('navigation', { name: 'Decades' });
      const tab1960s = within(nav).getByRole('button', { name: /1960s/i });
      expect(tab1960s).toHaveAttribute('data-active', 'true');

      // Click a non-active spine (virtual index 12 -> slot 0 -> B001 Mắt Biếc, 1950s)
      const spine12 = shelfSection.querySelector<HTMLElement>('.tape[data-virtual-index="12"]')!;
      await user.click(spine12);
      expect(shelfSection).toHaveAttribute('data-target', '12');
      expect(shelfSection).toHaveAttribute('data-active-slot', '0');
      expect(caption).toHaveTextContent('Mắt Biếc');

      const tab1950s = within(nav).getByRole('button', { name: /1950s/i });
      expect(tab1950s).toHaveAttribute('data-active', 'true');

      // Click decade tab "1980s • Hiện đại" -> jumps to slot 9 (filmId: tide)
      const tab1980s = within(nav).getByRole('button', { name: /1980s/i });
      await user.click(tab1980s);
      expect(shelfSection).toHaveAttribute('data-active-slot', '9');
      expect(caption).toHaveTextContent(shelfBooks[9].title);
      expect(tab1980s).toHaveAttribute('data-active', 'true');

      // Click "ALL / すべて" -> jumps to slot 0, and "ALL" itself is never highlighted
      const tabAll = within(nav).getByRole('button', { name: /ALL/i });
      await user.click(tabAll);
      expect(shelfSection).toHaveAttribute('data-active-slot', '0');
      expect(tabAll).toHaveAttribute('data-active', 'false');
      expect(tab1950s).toHaveAttribute('data-active', 'true');
    });

    it('transitions custom cursor ring between default, .spine, .btn, and .open ("OPEN / 開く") states', () => {
      renderShelf();

      const cursor = screen.getByTestId('vasari-cursor');
      expect(cursor).toHaveAttribute('data-cursor-mode', 'default');
      expect(cursor.textContent).toContain('OPEN');
      expect(cursor.textContent).toContain('開く');

      const shelfSection = screen.getByRole('region', { name: 'Filmography shelf' });

      // Hover over a closed spine (virtual index 14, r = -3) -> .spine state
      const closedSpine = shelfSection.querySelector<HTMLElement>('.tape[data-virtual-index="14"]')!;
      fireEvent.mouseEnter(closedSpine);
      expect(cursor).toHaveAttribute('data-cursor-mode', 'spine');
      expect(cursor).toHaveClass('spine');

      fireEvent.mouseLeave(closedSpine);
      expect(cursor).toHaveAttribute('data-cursor-mode', 'default');

      // Hover over active cover (virtual index 17, r = 0) -> .open state
      const activeTape = shelfSection.querySelector<HTMLElement>('.tape[data-virtual-index="17"]')!;
      fireEvent.mouseEnter(activeTape);
      expect(cursor).toHaveAttribute('data-cursor-mode', 'open');
      expect(cursor).toHaveClass('open');

      fireEvent.mouseLeave(activeTape);
      expect(cursor).toHaveAttribute('data-cursor-mode', 'default');

      // Hover over arrow or decade button -> .btn state
      const nextBtn = screen.getByRole('button', { name: 'Next film' });
      fireEvent.mouseEnter(nextBtn);
      expect(cursor).toHaveAttribute('data-cursor-mode', 'btn');
      expect(cursor).toHaveClass('btn');

      fireEvent.mouseLeave(nextBtn);
      expect(cursor).toHaveAttribute('data-cursor-mode', 'default');
    });

    it('opens the full-screen detail dialog with 7-blob feTurbulence + feDisplacementMap SVG ink mask and verbatim local DB book metadata, and closes via button or Escape', async () => {
      const user = userEvent.setup();
      renderShelf();

      const shelfBooks = getShelfBooksForLocalDb(SEED_BOOKS_WITH_AVAILABILITY);
      const activeBook = shelfBooks[5]; // Tắt Đèn (B006)

      // 1. Open by clicking Play ring ("Open film")
      const openBtn = screen.getByRole('button', { name: 'Open film' });
      await user.click(openBtn);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      // Verify verbatim local DB book description & title inside dialog
      expect(within(dialog).getByRole('heading', { name: activeBook.title })).toBeInTheDocument();
      expect(dialog).toHaveTextContent(activeBook.description);
      expect(dialog).toHaveTextContent(activeBook.author);

      // Verify 7-blob feTurbulence + feDisplacementMap SVG ink mask
      const posterSvg = screen.getByTestId('vasari-poster-svg');
      expect(posterSvg).toHaveAttribute('viewBox', '0 0 474 900');

      const turbulence = posterSvg.querySelector('feTurbulence');
      expect(turbulence).not.toBeNull();
      expect(turbulence).toHaveAttribute('baseFrequency', '.011');
      expect(turbulence).toHaveAttribute('numOctaves', '3');
      expect(turbulence).toHaveAttribute('seed', '7');

      const displacement = posterSvg.querySelector('feDisplacementMap');
      expect(displacement).not.toBeNull();
      expect(displacement).toHaveAttribute('scale', '120');

      const maskCircles = posterSvg.querySelectorAll('mask#vasari-ink-mask circle');
      expect(maskCircles).toHaveLength(7);
      INK_BLOBS.forEach((blob, idx) => {
        expect(maskCircles[idx]).toHaveAttribute('cx', String(blob.cx));
        expect(maskCircles[idx]).toHaveAttribute('cy', String(blob.cy));
        expect(maskCircles[idx]).toHaveAttribute('data-delay', String(blob.delay));
      });

      // 2. Close by clicking "CLOSE / 閉じる"
      const closeBtn = within(dialog).getByRole('button', { name: /CLOSE \/ 閉じる/i });
      await user.click(closeBtn);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // 3. Open by pressing Enter key, then close by pressing Escape key
      fireEvent.keyDown(window, { key: 'Enter' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders opening-screen action dock buttons (Keyword, Subjects, AI Search, Full Catalog) and opens interactive tool drawers directly on the 3D shelf', async () => {
      const user = userEvent.setup();
      const onKeywordChange = vi.fn();
      const onCategoryChange = vi.fn();
      const onRunAiSearch = vi.fn();

      render(
        <MemoryRouter
          initialEntries={['/']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <VasariShelfHero
            books={SEED_BOOKS_WITH_AVAILABILITY}
            categories={['Văn học Việt Nam', 'Khoa học - Vũ trụ']}
            onKeywordChange={onKeywordChange}
            onCategoryChange={onCategoryChange}
            onRunAiSearch={onRunAiSearch}
          />
        </MemoryRouter>
      );

      const toolbar = screen.getByRole('toolbar', {
        name: /Công cụ tra cứu nhanh trên kệ 3D/i,
      });
      expect(toolbar).toBeInTheDocument();

      // 1. Keyword search drawer on the opening screen
      const kwBtn = within(toolbar).getByRole('button', { name: /TÌM TỪ KHÓA \/ KEYWORD/i });
      await user.click(kwBtn);
      const kwDrawer = screen.getByRole('region', { name: /Bảng tìm từ khóa nhanh/i });
      expect(kwDrawer).toBeInTheDocument();
      const kwInput = within(kwDrawer).getByPlaceholderText(/Nhập tên sách hoặc tác giả/i);
      fireEvent.change(kwInput, { target: { value: 'Mắt Biếc' } });
      expect(onKeywordChange).toHaveBeenCalledWith('Mắt Biếc');

      // 2. Subject filter drawer on the opening screen
      const subjBtn = within(toolbar).getByRole('button', { name: /LỌC CHỦ ĐỀ \/ SUBJECTS/i });
      await user.click(subjBtn);
      const subjDrawer = screen.getByRole('region', { name: /Bảng lọc chủ đề trên kệ 3D/i });
      expect(subjDrawer).toBeInTheDocument();
      await user.click(within(subjDrawer).getByRole('button', { name: 'Văn học Việt Nam' }));
      expect(onCategoryChange).toHaveBeenCalledWith('Văn học Việt Nam');

      // 3. AI Local search drawer on the opening screen
      const aiBtn = within(toolbar).getByRole('button', { name: /TÌM BẰNG AI LOCAL \/ AI SEARCH/i });
      await user.click(aiBtn);
      const aiDrawer = screen.getByRole('region', { name: /Bảng tìm kiếm ngữ nghĩa AI Local/i });
      expect(aiDrawer).toBeInTheDocument();
      await user.click(
        within(aiDrawer).getByRole('button', { name: /PHÂN TÍCH & ĐƯA LÊN KỆ 3D/i })
      );
      expect(onRunAiSearch).toHaveBeenCalled();

      // 4. Full catalog anchor link
      expect(
        within(toolbar).getByRole('link', { name: /DANH MỤC 100 SÁCH \/ FULL CATALOG/i })
      ).toHaveAttribute('href', '#libmate-catalog-search');
    });
  });

  describe('3. Typed API Client Bridge & Offline Mock Fallback (apiClient.ts)', () => {
    it('defaults to http://localhost:8000 and falls back seamlessly to libraryStore in mock/offline mode', async () => {
      expect(API_BASE_URL).toBe('http://localhost:8000');

      const client = new LibMateApiClient({ mode: 'mock' });
      expect(client.getBaseUrl()).toBe('http://localhost:8000');

      // Catalog list fallback
      const catalog = await client.listBooks({ query: 'Mắt Biếc' });
      expect(catalog.items.some((b) => b.id === 'B001')).toBe(true);

      // Book detail & similar fallback
      const detail = await client.getBookDetail('B001');
      expect(detail.book.title).toBe('Mắt Biếc');
      const similar = await client.getSimilarBooks('B001');
      expect(similar.length).toBeGreaterThan(0);

      // Auth & personal endpoints fallback
      const session = await client.login('HS10A1', 'reader123');
      expect(session.user.reader_code).toBe('HS10A1');
      const me = await client.getMe();
      expect(me.id).toBe(session.user.id);

      const favRes = await client.toggleFavorite(session.token, 'B002');
      expect(typeof favRes.favorited).toBe('boolean');

      // Semantic search fallback
      const sem = await client.searchSemantic('tình cảm học trò làng Đo Đo', {
        skipColdStartDelay: true,
      });
      expect(sem.results.some((r) => r.book.id === 'B001')).toBe(true);

      // Auto mode fallback when fetch rejects (network offline)
      const autoClient = new LibMateApiClient({ baseUrl: 'http://localhost:59999', mode: 'auto' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const offlineCatalog = await autoClient.listBooks({ category: 'Văn học Việt Nam' });
      expect(offlineCatalog.total).toBe(12);
      fetchSpy.mockRestore();

      // Explicit API error propagation when HTTP returns 403/409
      const errorSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Trường lỗi [copy_code]: Đã tồn tại' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await expect(
        autoClient.addCopy(session.token, { book_id: 'B001', copy_code: 'VHVN-001-A' })
      ).rejects.toThrow(ApiClientError);
      errorSpy.mockRestore();

      await client.logout(session.token);
      expect(libraryStore.getCurrentSession()).toBeNull();
      expect(apiClient).toBeInstanceOf(LibMateApiClient);
    });
  });
});
