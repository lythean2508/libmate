import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Book, BookWithAvailability, SemanticSearchResponse } from '../types/library';
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
  computeHorizontalX,
  computeOpenness,
  computePlayRingScale,
  computeRelativeIndex,
  computeShelfDimensions,
  computeShortestLoopTarget,
  computeSpriteCropStyle,
  computeSvgPosterRect,
  computeTapeTransform,
  getShelfBooksForLocalDb,
  preloadVasariSheets,
  smoothStepB,
  smoothstep,
  type VasariShelfBook,
} from '../data/bookCoversCatalog';

export {
  B,
  CROP,
  DECADE_TABS,
  F,
  FILM_IDS,
  INK_BLOBS,
  SEED_BOOKS_WITH_AVAILABILITY,
  SHEET,
  VASARI_FILMS,
  computeHorizontalX,
  computeOpenness,
  computePlayRingScale,
  computeRelativeIndex,
  computeShelfDimensions,
  computeShortestLoopTarget,
  computeSpriteCropStyle,
  computeSvgPosterRect,
  computeTapeTransform,
  getShelfBooksForLocalDb,
  preloadVasariSheets,
  smoothStepB,
  smoothstep,
};

export interface VasariShelfHeroProps {
  books?: ReadonlyArray<Book | BookWithAvailability>;
  onSelectBook?: (book: VasariShelfBook) => void;
  keyword?: string;
  onKeywordChange?: (value: string) => void;
  category?: string;
  categories?: string[];
  onCategoryChange?: (value: string) => void;
  onlyAvailable?: boolean;
  onOnlyAvailableChange?: (checked: boolean) => void;
  aiQuery?: string;
  onAiQueryChange?: (value: string) => void;
  onRunAiSearch?: (customQuery?: string) => void;
  aiLoading?: boolean;
  aiResponse?: SemanticSearchResponse | null;
  sampleAiQueries?: string[];
  totalMatched?: number;
}

type CursorMode = 'default' | 'spine' | 'btn' | 'open';
type DrawerTool = 'none' | 'keyword' | 'subject' | 'ai';

function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function isJsdomEnvironment(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
}

const DEFAULT_SAMPLE_QUERIES = [
  'Em hay bị căng thẳng lo lắng trước kỳ thi, có sách nào giúp giảm áp lực không?',
  'Cách bỏ tật nước đến chân mới nhảy và rèn kỷ luật tự học mỗi ngày',
  'Sách giải thích dễ hiểu về lỗ đen vũ trụ và vụ nổ Big Bang',
  'sach huong dan tu lam thi nghiem vat ly stem tu chai nhua tai che',
];

export const VasariShelfHero: React.FC<VasariShelfHeroProps> = ({
  books,
  onSelectBook,
  keyword = '',
  onKeywordChange,
  category = 'ALL',
  categories = [],
  onCategoryChange,
  onlyAvailable = false,
  onOnlyAvailableChange,
  aiQuery = '',
  onAiQueryChange,
  onRunAiSearch,
  aiLoading = false,
  aiResponse = null,
  sampleAiQueries = DEFAULT_SAMPLE_QUERIES,
}) => {
  const shelfBooks = useMemo(() => getShelfBooksForLocalDb(books), [books]);

  // Opens on index 5 in middle copy (s = 17, T = 17)
  const [scrollS, setScrollS] = useState<number>(17);
  const [targetT, setTargetT] = useState<number>(17);
  const [activeSlot, setActiveSlot] = useState<number>(5);
  const [cursorMode, setCursorMode] = useState<CursorMode>('default');
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeDrawer, setActiveDrawer] = useState<DrawerTool>('none');
  const [measuredH, setMeasuredH] = useState<number>(380);
  const [indicatorStyle, setIndicatorStyle] = useState<{ width: number; x: number }>({
    width: 64,
    x: 180,
  });
  const [blobRadii, setBlobRadii] = useState<number[]>(() => INK_BLOBS.map(() => 0));

  const sRef = useRef<number>(17);
  const tRef = useRef<number>(17);
  const activeSlotRef = useRef<number>(5);
  const hoverVRef = useRef<number>(-1);
  const liftMapRef = useRef<Float32Array>(new Float32Array(36));
  const tiltXRef = useRef<number>(0);
  const tiltYRef = useRef<number>(0);
  const mxRef = useRef<number>(-200);
  const myRef = useRef<number>(-200);
  const cxRef = useRef<number>(-200);
  const cyRef = useRef<number>(-200);
  const isDraggingRef = useRef<boolean>(false);
  const dragMovedRef = useRef<boolean>(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartTRef = useRef<number>(17);
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inkRafRef = useRef<number | null>(null);

  const probeRef = useRef<HTMLDivElement | null>(null);
  const shelfRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tapeRefs = useRef<Array<HTMLDivElement | null>>([]);
  const titleMaskRef = useRef<HTMLDivElement | null>(null);
  const subMaskRef = useRef<HTMLDivElement | null>(null);

  const activeBook = shelfBooks[activeSlot] ?? shelfBooks[5] ?? shelfBooks[0];

  // Preload 4 Higgsfield WebP sheets on mount
  useEffect(() => {
    preloadVasariSheets();
  }, []);

  // Measure --H via off-screen probe element (fallback H=380 in jsdom when offsetHeight===0)
  const updateDimensions = useCallback(() => {
    const probeH = probeRef.current?.offsetHeight ?? 0;
    const resolvedH = probeH > 0 ? probeH : 380;
    setMeasuredH(resolvedH);

    const { ws, d } = computeShelfDimensions(resolvedH);
    if (stageRef.current) {
      stageRef.current.style.setProperty('--H-px', `${resolvedH}px`);
      stageRef.current.style.setProperty('--ws', `${ws}px`);
      stageRef.current.style.setProperty('--d', `${d}px`);
    }
  }, []);

  useEffect(() => {
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [updateDimensions]);

  // Update sliding cobalt indicator behind decade tabs
  const updateDecadeIndicator = useCallback(
    (slotIdx: number) => {
      const book = shelfBooks[slotIdx] ?? shelfBooks[5] ?? shelfBooks[0];
      const tabIdx = DECADE_TABS.findIndex((t) => t.decade === book.decade);
      const activeTabIndex = tabIdx >= 0 ? tabIdx : 3;
      const btn = tabRefs.current[activeTabIndex];
      if (btn && btn.offsetWidth > 0) {
        setIndicatorStyle({
          width: btn.offsetWidth,
          x: btn.offsetLeft,
        });
      } else {
        const fallbackWidth = 64;
        setIndicatorStyle({
          width: fallbackWidth,
          x: activeTabIndex * (fallbackWidth - 1),
        });
      }
    },
    [shelfBooks]
  );

  useEffect(() => {
    updateDecadeIndicator(activeSlot);
  }, [activeSlot, updateDecadeIndicator]);

  // Swap masked 2-line caption using Web Animations API (with graceful fallback in jsdom)
  const animateCaptionMaskSwap = useCallback(
    (maskEl: HTMLDivElement | null, newText: string, dir: number) => {
      if (!maskEl) return;
      const reduced = isReducedMotionPreferred();
      const jsdom = isJsdomEnvironment();

      if (reduced || jsdom || typeof maskEl.animate !== 'function') {
        maskEl.innerHTML = '';
        const span = document.createElement('span');
        span.className = 'vasari-mask-span';
        span.textContent = newText;
        if (!reduced && typeof span.animate === 'function') {
          try {
            span.animate(
              [{ transform: `translateY(${dir * 105}%)` }, { transform: 'translateY(0%)' }],
              { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
            );
          } catch {
            // Ignore in test environments
          }
        }
        maskEl.appendChild(span);
        return;
      }

      const existingSpans = Array.from(
        maskEl.querySelectorAll<HTMLSpanElement>('.vasari-mask-span:not(.leaving)')
      );
      existingSpans.forEach((oldSpan) => {
        oldSpan.classList.add('leaving');
        try {
          const anim = oldSpan.animate(
            [{ transform: 'translateY(0%)' }, { transform: `translateY(${-dir * 105}%)` }],
            { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
          );
          anim.onfinish = () => oldSpan.remove();
        } catch {
          oldSpan.remove();
        }
      });

      const nextSpan = document.createElement('span');
      nextSpan.className = 'vasari-mask-span';
      nextSpan.textContent = newText;
      maskEl.appendChild(nextSpan);
      try {
        nextSpan.animate(
          [{ transform: `translateY(${dir * 105}%)` }, { transform: 'translateY(0%)' }],
          { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
        );
      } catch {
        // Fallback if Web Animations API throws
      }
    },
    []
  );

  const commitActiveSlot = useCallback(
    (nextSlot: number, dir: number) => {
      const normalizedSlot = ((nextSlot % 12) + 12) % 12;
      const nextBook = shelfBooks[normalizedSlot] ?? shelfBooks[0];
      const stepDir = dir >= 0 ? 1 : -1;

      activeSlotRef.current = normalizedSlot;
      setActiveSlot(normalizedSlot);

      animateCaptionMaskSwap(titleMaskRef.current, nextBook.title, stepDir);
      animateCaptionMaskSwap(subMaskRef.current, nextBook.subtitle, stepDir);
      updateDecadeIndicator(normalizedSlot);
      onSelectBook?.(nextBook);
    },
    [animateCaptionMaskSwap, onSelectBook, shelfBooks, updateDecadeIndicator]
  );

  useEffect(() => {
    const currentBook = shelfBooks[activeSlotRef.current] ?? shelfBooks[0];
    if (!currentBook) return;
    if (titleMaskRef.current) {
      const span = titleMaskRef.current.querySelector('.vasari-mask-span:not(.leaving)');
      if (span) span.textContent = currentBook.title;
    }
    if (subMaskRef.current) {
      const span = subMaskRef.current.querySelector('.vasari-mask-span:not(.leaving)');
      if (span) span.textContent = currentBook.subtitle;
    }
  }, [shelfBooks]);

  const moveTargetTo = useCallback(
    (nextT: number) => {
      const prevS = sRef.current;
      const dir = Math.sign(nextT - prevS) || 1;
      tRef.current = nextT;
      setTargetT(nextT);

      const targetSlot = ((Math.round(nextT) % 12) + 12) % 12;
      commitActiveSlot(targetSlot, dir);

      if (isReducedMotionPreferred() || isJsdomEnvironment()) {
        sRef.current = nextT;
        setScrollS(nextT);
      }
    },
    [commitActiveSlot]
  );

  // Open Detail Sheet & 7-Circle Ink-Blot Reveal
  const openDetail = useCallback(() => {
    const snapped = Math.round(tRef.current);
    tRef.current = snapped;
    sRef.current = snapped;
    setTargetT(snapped);
    setScrollS(snapped);
    const slot = ((snapped % 12) + 12) % 12;
    commitActiveSlot(slot, 1);

    const reduced = isReducedMotionPreferred();
    const jsdom = isJsdomEnvironment();

    setIsOpen(true);
    setCursorMode('default');

    if (reduced || jsdom) {
      setBlobRadii(INK_BLOBS.map(() => 720));
    } else {
      setBlobRadii(INK_BLOBS.map(() => 0));
    }

    if (inkRafRef.current !== null) {
      cancelAnimationFrame(inkRafRef.current);
    }

    const openTime =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
      (reduced ? 5000 : 0);

    const stepInk = (now: number) => {
      const elapsed = now - openTime - 520;
      const nextRadii = INK_BLOBS.map((blob) => {
        const localElapsed = elapsed - blob.delay;
        if (localElapsed <= 0) return 0;
        const p = Math.max(0, Math.min(1, localElapsed / 1250));
        const eased = 1 - Math.pow(1 - p, 3);
        return 720 * eased;
      });
      setBlobRadii(nextRadii);
      if (now - openTime < 2400 && !reduced) {
        inkRafRef.current = requestAnimationFrame(stepInk);
      }
    };

    if (!reduced && !jsdom && typeof requestAnimationFrame === 'function') {
      inkRafRef.current = requestAnimationFrame(stepInk);
    }
  }, [commitActiveSlot]);

  useEffect(() => {
    if (!isOpen || !detailRef.current) return;
    const detailEl = detailRef.current;
    const reduced = isReducedMotionPreferred();

    const activeVirtual = Math.round(sRef.current);
    const activeTapeEl =
      tapeRefs.current[((activeVirtual % 36) + 36) % 36] ?? tapeRefs.current[17];
    const coverEl = activeTapeEl?.querySelector<HTMLElement>('.cv');
    const rect = coverEl?.getBoundingClientRect();

    const vw = window.innerWidth || 1440;
    const vh = window.innerHeight || 900;
    const top = rect && rect.height > 0 ? Math.max(0, rect.top) : vh * 0.25;
    const left = rect && rect.width > 0 ? Math.max(0, rect.left) : vw * 0.42;
    const right = rect && rect.width > 0 ? Math.max(0, vw - rect.right) : vw * 0.42;
    const bottom = rect && rect.height > 0 ? Math.max(0, vh - rect.bottom) : vh * 0.25;
    const cx = rect && rect.width > 0 ? rect.left + rect.width / 2 : vw / 2;
    const cy = rect && rect.height > 0 ? rect.top + rect.height / 2 : vh / 2;

    detailEl.style.transformOrigin = `${cx}px ${cy}px`;

    if (typeof detailEl.animate === 'function') {
      try {
        detailEl.animate(
          [
            {
              clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round 3px)`,
              transform: 'rotate(-4.5deg)',
            },
            {
              clipPath: 'inset(0px 0px 0px 0px round 0px)',
              transform: 'rotate(0deg)',
            },
          ],
          {
            duration: reduced ? 1 : 1050,
            easing: 'cubic-bezier(.76,0,.18,1)',
            fill: 'both',
          }
        );
      } catch {
        // Ignore
      }
    }

    const lineEls = Array.from(detailEl.querySelectorAll<HTMLElement>('.vasari-detail-line'));
    lineEls.forEach((lineEl, index) => {
      if (typeof lineEl.animate === 'function') {
        try {
          lineEl.animate(
            [{ transform: 'translateY(110%)' }, { transform: 'translateY(0%)' }],
            {
              duration: reduced ? 1 : 900,
              delay: reduced ? 0 : 620 + index * 75,
              easing: 'cubic-bezier(.2,.8,.2,1)',
              fill: 'both',
            }
          );
        } catch {
          // Ignore
        }
      }
    });
  }, [isOpen]);

  const closeDetail = useCallback(() => {
    if (inkRafRef.current !== null) {
      cancelAnimationFrame(inkRafRef.current);
      inkRafRef.current = null;
    }

    const reduced = isReducedMotionPreferred();
    const jsdom = isJsdomEnvironment();
    const detailEl = detailRef.current;

    if (detailEl && typeof detailEl.animate === 'function') {
      const vw = window.innerWidth || 1440;
      const vh = window.innerHeight || 900;
      const top = vh * 0.25;
      const left = vw * 0.42;
      const right = vw * 0.42;
      const bottom = vh * 0.25;

      try {
        const anim = detailEl.animate(
          [
            {
              clipPath: 'inset(0px 0px 0px 0px round 0px)',
              transform: 'rotate(0deg)',
            },
            {
              clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round 3px)`,
              transform: 'rotate(-4.5deg)',
            },
          ],
          {
            duration: reduced ? 1 : 850,
            easing: 'cubic-bezier(.76,0,.18,1)',
            fill: 'both',
          }
        );
        if (!reduced && !jsdom) {
          anim.onfinish = () => setIsOpen(false);
          return;
        }
      } catch {
        // Fall through
      }
    }

    setIsOpen(false);
  }, []);

  // Main requestAnimationFrame motion engine loop
  useEffect(() => {
    if (isJsdomEnvironment()) return;
    let rafId = 0;
    let lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const tick = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.max(0.001, Math.min(0.05, rawDt));
      const reduced = isReducedMotionPreferred();

      const k = isDraggingRef.current ? 18 : 5.2;
      const factor = reduced ? 1 : 1 - Math.exp(-k * dt);
      let s = sRef.current + (tRef.current - sRef.current) * factor;
      if (Math.abs(tRef.current - s) < 1e-4) {
        s = tRef.current;
      }

      if (Math.abs(s) > 144) {
        const loops = Math.trunc(s / 36);
        s -= loops * 36;
        tRef.current -= loops * 36;
      }

      if (s !== sRef.current) {
        sRef.current = s;
        setScrollS(s);
        const roundedSlot = ((Math.round(s) % 12) + 12) % 12;
        if (roundedSlot !== activeSlotRef.current) {
          commitActiveSlot(roundedSlot, Math.sign(tRef.current - s) || 1);
        }
      }

      const liftEase = reduced ? 1 : 1 - Math.exp(-12 * dt);
      const lifts = liftMapRef.current;
      for (let v = 0; v < 36; v++) {
        const r = computeRelativeIndex(v, sRef.current, 36);
        const targetLift = hoverVRef.current === v && Math.abs(r) > 0.5 ? 1 : 0;
        lifts[v] += (targetLift - lifts[v]) * liftEase;
      }

      const cursorEase = reduced ? 1 : 1 - Math.exp(-16 * dt);
      cxRef.current += (mxRef.current - cxRef.current) * cursorEase;
      cyRef.current += (myRef.current - cyRef.current) * cursorEase;
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${cxRef.current}px, ${cyRef.current}px, 0)`;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [commitActiveSlot]);

  // Keyboard navigation: ArrowLeft, ArrowRight, Enter, Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape' && activeDrawer !== 'none') {
          setActiveDrawer('none');
        }
        return;
      }

      if (e.key === 'Escape') {
        if (isOpen) {
          e.preventDefault();
          closeDetail();
          return;
        }
        if (activeDrawer !== 'none') {
          e.preventDefault();
          setActiveDrawer('none');
          return;
        }
      }

      if (isOpen) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveTargetTo(Math.round(tRef.current) - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveTargetTo(Math.round(tRef.current) + 1);
      } else if (e.key === 'Enter') {
        if (tag !== 'button' && tag !== 'a') {
          e.preventDefault();
          openDetail();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDrawer, closeDetail, isOpen, moveTargetTo, openDetail]);

  const { ws, d, gap } = useMemo(() => computeShelfDimensions(measuredH), [measuredH]);

  const handleTapeClick = (v: number) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    const r = computeRelativeIndex(v, tRef.current, 36);
    if (Math.abs(r) < 0.5) {
      openDetail();
    } else {
      moveTargetTo(Math.round(tRef.current + r));
    }
  };

  const handleTapeHoverEnter = (v: number) => {
    if (isOpen) return;
    const r = computeRelativeIndex(v, tRef.current, 36);
    if (Math.abs(r) < 0.5) {
      hoverVRef.current = -1;
      setCursorMode('open');
    } else {
      hoverVRef.current = v;
      liftMapRef.current[v] = 1;
      setCursorMode('spine');
    }
  };

  const handleTapeHoverLeave = (v: number) => {
    if (hoverVRef.current === v) {
      hoverVRef.current = -1;
      liftMapRef.current[v] = 0;
    }
    setCursorMode('default');
  };

  const handleWheel = (e: React.WheelEvent<HTMLElement>) => {
    if (isOpen) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const nextT = tRef.current + (delta / (ws + gap)) * 0.5;
    tRef.current = nextT;
    setTargetT(nextT);
    if (isReducedMotionPreferred() || isJsdomEnvironment()) {
      sRef.current = nextT;
      setScrollS(nextT);
    }

    if (wheelTimeoutRef.current) {
      clearTimeout(wheelTimeoutRef.current);
    }
    wheelTimeoutRef.current = setTimeout(() => {
      moveTargetTo(Math.round(tRef.current));
    }, 160);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (isOpen) return;
    isDraggingRef.current = true;
    dragMovedRef.current = false;
    dragStartXRef.current = e.clientX;
    dragStartTRef.current = tRef.current;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    mxRef.current = e.clientX;
    myRef.current = e.clientY;

    if (isDraggingRef.current && !isOpen) {
      const dx = e.clientX - dragStartXRef.current;
      if (Math.abs(dx) > 5) {
        dragMovedRef.current = true;
        const nextT = dragStartTRef.current - dx / (ws + gap);
        tRef.current = nextT;
        setTargetT(nextT);
        const slot = ((Math.round(nextT) % 12) + 12) % 12;
        commitActiveSlot(slot, -Math.sign(dx) || 1);
      }
    }
  };

  const handlePointerUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (dragMovedRef.current) {
      moveTargetTo(Math.round(tRef.current));
    }
  };

  const toggleDrawer = (tool: DrawerTool) => {
    setActiveDrawer((prev) => (prev === tool ? 'none' : tool));
  };

  const playScale = isOpen ? 0 : computePlayRingScale(targetT, scrollS);

  // Build 36 endless tapes (3 copies x 12 books, virtual index v = copy * 12 + i)
  const tapes = useMemo(() => {
    const list: Array<{ v: number; copy: number; slotIndex: number; book: VasariShelfBook }> = [];
    for (let copy = 0; copy < 3; copy++) {
      for (let i = 0; i < 12; i++) {
        list.push({
          v: copy * 12 + i,
          copy,
          slotIndex: i,
          book: shelfBooks[i],
        });
      }
    }
    return list;
  }, [shelfBooks]);

  return (
    <div
      className="vasari-hero"
      data-testid="vasari-shelf-hero"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Fixed Full-Screen Paper Grain SVG Overlay */}
      <div className="vasari-grain" aria-hidden="true">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="vasari-paper-grain-filter" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency=".85"
                numOctaves="3"
                stitchTiles="stitch"
                result="noise"
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0.45  0 0 0 0 0.42  0 0 0 0 0.38  0 0 0 0.22 0"
              />
            </filter>
            <pattern
              id="vasari-grain-tile"
              width="220"
              height="220"
              patternUnits="userSpaceOnUse"
            >
              <rect width="220" height="220" filter="url(#vasari-paper-grain-filter)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#vasari-grain-tile)" />
        </svg>
      </div>

      {/* Custom 58x58px Cursor Ring */}
      <div
        ref={cursorRef}
        className={`vasari-cursor ${
          !isOpen && cursorMode !== 'default' ? cursorMode : ''
        }`.trim()}
        style={{ visibility: isOpen ? 'hidden' : 'visible' }}
        data-testid="vasari-cursor"
        data-cursor-mode={isOpen ? 'default' : cursorMode}
        aria-hidden="true"
      >
        <div className="vasari-cursor-ring" />
        <div className="vasari-cursor-dot" />
        <div className="vasari-cursor-label">{'OPEN\n開く'}</div>
      </div>

      {/* 1. Compact Decade Tabs at Top of Shelf */}
      <div className="vasari-controls-header">
        <div className="vasari-tabs-wrap">
          <nav aria-label="Decades" className="vasari-tabs">
            <div
              className="vasari-tab-indicator"
              data-testid="vasari-tab-indicator"
              style={{
                width: `${indicatorStyle.width}px`,
                transform: `translateX(${indicatorStyle.x}px)`,
              }}
            />
            {DECADE_TABS.map((tab, idx) => {
              const isTabActive = tab.decade !== null && tab.decade === activeBook.decade;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[idx] = el;
                  }}
                  type="button"
                  className={`lbl box vasari-tab ${isTabActive ? 'active' : ''}`.trim()}
                  data-decade={tab.id}
                  data-active={isTabActive ? 'true' : 'false'}
                  aria-pressed={isTabActive}
                  onClick={() => {
                    const nextTarget = computeShortestLoopTarget(
                      tRef.current,
                      tab.firstSlotIndex,
                      12
                    );
                    moveTargetTo(nextTarget);
                  }}
                  onPointerEnter={() => setCursorMode('btn')}
                  onPointerLeave={() => setCursorMode('default')}
                  onMouseEnter={() => setCursorMode('btn')}
                  onMouseLeave={() => setCursorMode('default')}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Clean Floating Command Drawer when a tool is selected */}
        {activeDrawer === 'keyword' && (
          <div className="vasari-drawer" role="region" aria-label="Bảng tìm từ khóa nhanh">
            <div className="vasari-drawer-header">
              <span className="vasari-drawer-title">Tìm theo tên sách hoặc tác giả</span>
              <button
                type="button"
                className="vasari-drawer-close"
                onClick={() => setActiveDrawer('none')}
              >
                Đóng ×
              </button>
            </div>

            <div className="vasari-drawer-input-row">
              <input
                type="text"
                className="vasari-drawer-input"
                value={keyword}
                onChange={(e) => {
                  onKeywordChange?.(e.target.value);
                  moveTargetTo(computeShortestLoopTarget(tRef.current, 0, 12));
                }}
                placeholder="Nhập tên sách hoặc tác giả (VD: Mắt Biếc, Nguyễn Nhật Ánh, Python)..."
              />
              {keyword && (
                <button
                  type="button"
                  className="vasari-dock-btn"
                  onClick={() => onKeywordChange?.('')}
                >
                  Xóa
                </button>
              )}
            </div>

            <div className="vasari-pill-list">
              {shelfBooks.slice(0, 6).map((b, idx) => (
                <button
                  key={`${b.id}-${idx}`}
                  type="button"
                  className={`vasari-pill ${activeSlot === idx ? 'active' : ''}`}
                  onClick={() => moveTargetTo(computeShortestLoopTarget(tRef.current, idx, 12))}
                >
                  {b.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeDrawer === 'subject' && (
          <div className="vasari-drawer" role="region" aria-label="Bảng lọc chủ đề trên kệ 3D">
            <div className="vasari-drawer-header">
              <span className="vasari-drawer-title">Chủ đề thư viện</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <label className="vasari-checkbox-label">
                  <input
                    type="checkbox"
                    checked={onlyAvailable}
                    onChange={(e) => onOnlyAvailableChange?.(e.target.checked)}
                  />
                  Chỉ sách còn bản sẵn có
                </label>
                <button
                  type="button"
                  className="vasari-drawer-close"
                  onClick={() => setActiveDrawer('none')}
                >
                  Đóng ×
                </button>
              </div>
            </div>

            <div className="vasari-pill-list">
              <button
                type="button"
                className={`vasari-pill ${category === 'ALL' ? 'active' : ''}`}
                onClick={() => {
                  onCategoryChange?.('ALL');
                  moveTargetTo(computeShortestLoopTarget(tRef.current, 0, 12));
                }}
              >
                Tất cả chủ đề
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`vasari-pill ${category === cat ? 'active' : ''}`}
                  onClick={() => {
                    onCategoryChange?.(cat);
                    moveTargetTo(computeShortestLoopTarget(tRef.current, 0, 12));
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeDrawer === 'ai' && (
          <div className="vasari-drawer" role="region" aria-label="Bảng tìm kiếm ngữ nghĩa AI Local">
            <div className="vasari-drawer-header">
              <span className="vasari-drawer-title">Gợi ý sách theo nhu cầu bằng AI</span>
              <button
                type="button"
                className="vasari-drawer-close"
                onClick={() => setActiveDrawer('none')}
              >
                Đóng ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                onRunAiSearch?.();
                moveTargetTo(computeShortestLoopTarget(tRef.current, 0, 12));
              }}
              className="vasari-drawer-input-row"
            >
              <input
                type="text"
                className="vasari-drawer-input"
                value={aiQuery}
                onChange={(e) => onAiQueryChange?.(e.target.value)}
                placeholder="Mô tả nhu cầu đọc của bạn (VD: Sách giúp giảm áp lực trước kỳ thi)..."
              />
              <button
                type="submit"
                className="vasari-dock-btn active"
                aria-label="Tìm gợi ý / PHÂN TÍCH & ĐƯA LÊN KỆ 3D"
                disabled={aiLoading}
              >
                {aiLoading ? 'Đang tìm...' : 'Tìm gợi ý'}
              </button>
            </form>

            <div className="vasari-pill-list">
              {sampleAiQueries.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  className="vasari-pill"
                  onClick={() => {
                    onAiQueryChange?.(sample);
                    onRunAiSearch?.(sample);
                    moveTargetTo(computeShortestLoopTarget(tRef.current, 0, 12));
                  }}
                >
                  {sample.length > 52 ? `${sample.slice(0, 52)}…` : sample}
                </button>
              ))}
            </div>

            {aiResponse && aiResponse.results.length > 0 && (
              <div className="vasari-ai-results">
                {aiResponse.results.map((item, idx) => (
                  <div key={item.book.id} className="vasari-ai-card">
                    <div>
                      <div className="vasari-ai-card-meta">
                        Gợi ý #{idx + 1} · Kệ {item.book.shelf}
                      </div>
                      <div className="vasari-ai-card-title">{item.book.title}</div>
                      <div className="vasari-ai-card-author">
                        {item.book.author} · Còn {item.book.available_copies}/{item.book.total_copies} bản
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button
                        type="button"
                        className="vasari-pill"
                        onClick={() => {
                          moveTargetTo(computeShortestLoopTarget(tRef.current, idx % 12, 12));
                        }}
                      >
                        Xem trên kệ
                      </button>
                      <Link
                        to={`/books/${item.book.id}`}
                        className="vasari-pill active"
                      >
                        Chi tiết →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. The 3D Shelf Stage */}
      <section
        ref={shelfRef}
        aria-label="Filmography shelf"
        className="vasari-shelf"
        data-scroll={scrollS}
        data-target={targetT}
        data-active-slot={activeSlot}
        data-active-book-id={activeBook.id}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
      >
        <div ref={probeRef} className="vasari-probe" aria-hidden="true" />

        <div
          ref={stageRef}
          className="stage"
          style={
            {
              '--H-px': `${measuredH}px`,
              '--ws': `${ws}px`,
              '--d': `${d}px`,
            } as React.CSSProperties
          }
        >
          {tapes.map(({ v, copy, slotIndex, book }) => {
            const r = computeRelativeIndex(v, scrollS, 36);
            const lift = liftMapRef.current[v] ?? 0;
            const tf = computeTapeTransform(
              r,
              measuredH,
              ws,
              d,
              gap,
              tiltXRef.current,
              tiltYRef.current,
              lift
            );
            const isActiveTape = Math.abs(computeRelativeIndex(v, targetT, 36)) < 0.5;
            const viewportW = typeof window !== 'undefined' ? window.innerWidth || 1440 : 1440;
            const culled = Math.abs(tf.x) > viewportW / 2 + 1.5 * d;

            return (
              <div
                key={v}
                ref={(el) => {
                  tapeRefs.current[v] = el;
                }}
                className={`tape ${isActiveTape ? 'active' : ''}`.trim()}
                data-virtual-index={v}
                data-copy-index={copy}
                data-slot-index={slotIndex}
                data-film-id={book.filmId}
                data-book-id={book.id}
                data-book-code={book.code}
                data-active={isActiveTape ? 'true' : 'false'}
                data-r={r.toFixed(3)}
                style={{
                  transform: tf.transform,
                  zIndex: tf.zIndex,
                  visibility: culled ? 'hidden' : 'visible',
                }}
                onClick={() => handleTapeClick(v)}
                onPointerEnter={() => handleTapeHoverEnter(v)}
                onPointerLeave={() => handleTapeHoverLeave(v)}
                onMouseEnter={() => handleTapeHoverEnter(v)}
                onMouseLeave={() => handleTapeHoverLeave(v)}
              >
                {/* Spine Face (.sp) */}
                <div
                  className="face sp"
                  data-face="spine"
                  style={
                    {
                      ...book.spineStyle,
                      '--shade': tf.spineShade,
                    } as React.CSSProperties
                  }
                >
                  <img
                    src={book.spineJacketDataUri}
                    alt=""
                    aria-hidden="true"
                    className="vasari-face-jacket"
                  />
                </div>

                {/* Cover Face (.cv) */}
                <div
                  className="face cv"
                  data-face="cover"
                  style={
                    {
                      ...book.coverStyle,
                      '--shade': tf.coverShade,
                    } as React.CSSProperties
                  }
                  onPointerEnter={() => {
                    if (isActiveTape && !isOpen) setCursorMode('open');
                  }}
                  onMouseEnter={() => {
                    if (isActiveTape && !isOpen) setCursorMode('open');
                  }}
                >
                  <img
                    src={book.coverJacketDataUri}
                    alt=""
                    aria-hidden="true"
                    className="vasari-face-jacket"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Play Ring Button */}
        <button
          type="button"
          className="vasari-play"
          aria-label="Open film"
          style={{
            left: `calc(50% - ${0.5 * d + 6}px)`,
            top: `calc(50% + ${0.36 * measuredH}px)`,
            transform: `scale(${playScale})`,
            visibility: isOpen ? 'hidden' : 'visible',
          }}
          onClick={openDetail}
          onPointerEnter={() => setCursorMode('btn')}
          onPointerLeave={() => setCursorMode('default')}
          onMouseEnter={() => setCursorMode('btn')}
          onMouseLeave={() => setCursorMode('default')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <polygon points="3,1 11,6 3,11" fill="currentColor" />
          </svg>
        </button>
      </section>

      {/* 3. Minimal 2-Line Caption, Arrows & Action Dock */}
      <div className="vasari-bottom-bar">
        <button
          type="button"
          className="vasari-arrow vasari-arrow-prev"
          aria-label="Previous film"
          onClick={() => moveTargetTo(Math.round(tRef.current) - 1)}
          onPointerEnter={() => setCursorMode('btn')}
          onPointerLeave={() => setCursorMode('default')}
          onMouseEnter={() => setCursorMode('btn')}
          onMouseLeave={() => setCursorMode('default')}
        >
          <svg width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden="true">
            <path
              d="M5 1 L1 5 L5 9 M1 5 L17 5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="vasari-caption" aria-live="polite" data-testid="vasari-caption">
          <div ref={titleMaskRef} className="vasari-mask vasari-caption-title">
            <span className="vasari-mask-span">{activeBook.title}</span>
          </div>
          <div ref={subMaskRef} className="vasari-mask vasari-caption-sub">
            <span className="vasari-mask-span">{activeBook.subtitle}</span>
          </div>
        </div>

        <button
          type="button"
          className="vasari-arrow vasari-arrow-next"
          aria-label="Next film"
          onClick={() => moveTargetTo(Math.round(tRef.current) + 1)}
          onPointerEnter={() => setCursorMode('btn')}
          onPointerLeave={() => setCursorMode('default')}
          onMouseEnter={() => setCursorMode('btn')}
          onMouseLeave={() => setCursorMode('default')}
        >
          <svg width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden="true">
            <path
              d="M13 1 L17 5 L13 9 M17 5 L1 5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Clean 4-Button Action Dock Directly Under Caption */}
        <div
          className="vasari-action-dock"
          role="toolbar"
          aria-label="Công cụ tra cứu nhanh trên kệ 3D"
        >
          <button
            type="button"
            aria-label="Tìm từ khóa / TÌM TỪ KHÓA / KEYWORD"
            className={`vasari-dock-btn ${activeDrawer === 'keyword' || keyword ? 'active' : ''}`}
            onClick={() => toggleDrawer('keyword')}
            onPointerEnter={() => setCursorMode('btn')}
            onPointerLeave={() => setCursorMode('default')}
            onMouseEnter={() => setCursorMode('btn')}
            onMouseLeave={() => setCursorMode('default')}
          >
            {keyword ? `Từ khóa: “${keyword}”` : 'Tìm từ khóa'}
          </button>

          <button
            type="button"
            aria-label="Lọc chủ đề / LỌC CHỦ ĐỀ / SUBJECTS"
            className={`vasari-dock-btn ${activeDrawer === 'subject' || category !== 'ALL' ? 'active' : ''}`}
            onClick={() => toggleDrawer('subject')}
            onPointerEnter={() => setCursorMode('btn')}
            onPointerLeave={() => setCursorMode('default')}
            onMouseEnter={() => setCursorMode('btn')}
            onMouseLeave={() => setCursorMode('default')}
          >
            {category === 'ALL' ? 'Lọc chủ đề' : `Chủ đề: ${category}`}
          </button>

          <button
            type="button"
            aria-label="Tìm bằng AI / TÌM BẰNG AI LOCAL / AI SEARCH"
            className={`vasari-dock-btn vasari-dock-btn-ai ${activeDrawer === 'ai' ? 'active' : ''}`}
            onClick={() => toggleDrawer('ai')}
            onPointerEnter={() => setCursorMode('btn')}
            onPointerLeave={() => setCursorMode('default')}
            onMouseEnter={() => setCursorMode('btn')}
            onMouseLeave={() => setCursorMode('default')}
          >
            Tìm bằng AI
          </button>

          <a
            href="#libmate-catalog-search"
            aria-label="Xem tất cả sách / DANH MỤC 100 SÁCH / FULL CATALOG"
            className="vasari-dock-btn"
            onPointerEnter={() => setCursorMode('btn')}
            onPointerLeave={() => setCursorMode('default')}
            onMouseEnter={() => setCursorMode('btn')}
            onMouseLeave={() => setCursorMode('default')}
          >
            Xem tất cả sách ↓
          </a>
        </div>
      </div>

      {/* 4. Detail Sheet & 7-Circle Ink-Blot Reveal Dialog */}
      {isOpen && (
        <div
          ref={detailRef}
          role="dialog"
          aria-modal="true"
          aria-label={activeBook.title}
          className="vasari-detail"
          data-testid="vasari-detail-dialog"
        >
          <button
            type="button"
            aria-label="Đóng / CLOSE / 閉じる"
            className="lbl box vasari-detail-close"
            onClick={closeDetail}
          >
            Đóng ×
          </button>

          <div className="vasari-detail-left">
            <div className="vasari-detail-line-mask">
              <span className="vasari-detail-line lbl vasari-detail-sub">
                {activeBook.category} · {activeBook.code}
              </span>
            </div>

            <div className="vasari-detail-line-mask">
              <h2 className="vasari-detail-line vasari-detail-title">{activeBook.title}</h2>
            </div>

            <div className="vasari-detail-line-mask">
              <span className="vasari-detail-line vasari-detail-meta">
                Tác giả: <strong>{activeBook.author}</strong> · Kệ {activeBook.shelf} · Còn{' '}
                {activeBook.available_copies}/{activeBook.total_copies} bản sẵn có
              </span>
            </div>

            <div className="vasari-detail-line-mask">
              <p className="vasari-detail-line vasari-detail-synopsis">
                {activeBook.description}
              </p>
            </div>

            <div className="vasari-detail-line-mask">
              <div className="vasari-detail-line">
                <Link
                  to={`/books/${activeBook.id}`}
                  className="vasari-watch-btn"
                >
                  Xem chi tiết &amp; Đặt mượn →
                </Link>
              </div>
            </div>
          </div>

          {/* Right Column: Inline SVG 474x900 Poster with 7-Circle Ink-Blot Mask */}
          <div className="vasari-detail-right">
            <svg
              viewBox="0 0 474 900"
              aria-hidden="true"
              className="vasari-poster-svg"
              data-testid="vasari-poster-svg"
            >
              <defs>
                <clipPath id="vasari-poster-clip">
                  <rect x="0" y="0" width="474" height="900" rx="3" />
                </clipPath>
                <filter
                  id="vasari-ink-filter"
                  x="-20%"
                  y="-20%"
                  width="140%"
                  height="140%"
                >
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency=".011"
                    numOctaves="3"
                    seed="7"
                    result="noise"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="noise"
                    scale="120"
                    xChannelSelector="R"
                    yChannelSelector="G"
                  />
                </filter>
                <mask
                  id="vasari-ink-mask"
                  maskUnits="userSpaceOnUse"
                  x="-200"
                  y="-200"
                  width="874"
                  height="1300"
                >
                  <rect x="-200" y="-200" width="874" height="1300" fill="black" />
                  <g filter="url(#vasari-ink-filter)">
                    {INK_BLOBS.map((blob, idx) => (
                      <circle
                        key={idx}
                        cx={blob.cx}
                        cy={blob.cy}
                        r={blobRadii[idx] ?? 720}
                        fill="white"
                        data-blob-index={idx + 1}
                        data-delay={blob.delay}
                      />
                    ))}
                  </g>
                </mask>
              </defs>

              <g clipPath="url(#vasari-poster-clip)" mask="url(#vasari-ink-mask)">
                <image
                  href={activeBook.posterRect.href}
                  x={activeBook.posterRect.x}
                  y={activeBook.posterRect.y}
                  width={activeBook.posterRect.width}
                  height={activeBook.posterRect.height}
                  preserveAspectRatio="none"
                />
                <image
                  href={activeBook.coverJacketDataUri}
                  x="0"
                  y="0"
                  width="474"
                  height="900"
                  preserveAspectRatio="none"
                />
              </g>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};
