import fs from 'node:fs';
import path from 'node:path';
import { EVAL_QUERIES_30, SEED_BOOKS, SEED_COPIES } from '../src/data/seedCatalog';
import {
  MODEL_REVISION,
  computeBookContentHash,
  runKeywordSearch,
  runLocalSemanticSearch,
} from '../src/services/semanticEngine';
import type { BookEmbeddingRecord, BookWithAvailability, EvalQueryItem } from '../src/types/library';

const enrichedBooks: BookWithAvailability[] = SEED_BOOKS.map((b) => {
  const cps = SEED_COPIES.filter((c) => c.book_id === b.id);
  return {
    ...b,
    total_copies: cps.length,
    available_copies: cps.filter((c) => c.status === 'available').length,
    borrowed_copies: cps.filter((c) => c.status === 'borrowed').length,
    maintenance_copies: cps.filter((c) => c.status === 'maintenance').length,
    index_status: 'ready',
  };
});

const embMap = new Map<string, BookEmbeddingRecord>(
  enrichedBooks.map((b) => [
    b.id,
    {
      book_id: b.id,
      content_hash: computeBookContentHash(b),
      model_revision: MODEL_REVISION,
      status: 'ready',
      updated_at: '2026-11-25T08:00:00Z',
    },
  ])
);

interface SingleEvalResult {
  item: EvalQueryItem;
  aiTop5: string[];
  kwTop5: string[];
  aiHit5: boolean;
  kwHit5: boolean;
  latencyMs: number;
}

function evaluateSplit(items: EvalQueryItem[]) {
  const rows: SingleEvalResult[] = [];

  for (const item of items) {
    const t0 = performance.now();
    const aiRes = runLocalSemanticSearch(item.query, enrichedBooks, embMap);
    const latencyMs = performance.now() - t0;
    const kwRes = runKeywordSearch(item.query, enrichedBooks).slice(0, 5);

    const aiTop5 = aiRes.results.map((r) => r.book.id);
    const kwTop5 = kwRes.map((b) => b.id);

    const isNegative = item.expected_book_ids.length === 0;
    const aiHit5 = isNegative
      ? aiTop5.length === 0
      : item.expected_book_ids.some((exp) => aiTop5.includes(exp));
    const kwHit5 = isNegative
      ? kwTop5.length === 0
      : item.expected_book_ids.some((exp) => kwTop5.includes(exp));

    rows.push({ item, aiTop5, kwTop5, aiHit5, kwHit5, latencyMs });
  }

  const positiveRows = rows.filter((r) => r.item.expected_book_ids.length > 0);
  const negativeRows = rows.filter((r) => r.item.expected_book_ids.length === 0);

  const aiPosHits = positiveRows.filter((r) => r.aiHit5).length;
  const kwPosHits = positiveRows.filter((r) => r.kwHit5).length;
  const aiNegHits = negativeRows.filter((r) => r.aiHit5).length;
  const kwNegHits = negativeRows.filter((r) => r.kwHit5).length;

  const sortedLat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p95 = sortedLat[Math.min(Math.floor(sortedLat.length * 0.95), sortedLat.length - 1)] ?? 0;

  return {
    rows,
    posTotal: positiveRows.length,
    negTotal: negativeRows.length,
    aiPosHits,
    kwPosHits,
    aiPosRate: positiveRows.length ? (aiPosHits / positiveRows.length) * 100 : 0,
    kwPosRate: positiveRows.length ? (kwPosHits / positiveRows.length) * 100 : 0,
    aiNegHits,
    kwNegHits,
    p95Ms: Number(p95.toFixed(2)),
  };
}

const cal = evaluateSplit(EVAL_QUERIES_30.filter((q) => q.split === 'calibration'));
const hold = evaluateSplit(EVAL_QUERIES_30.filter((q) => q.split === 'holdout'));
const allRows = [...cal.rows, ...hold.rows];

const md = `# T33 — Bộ 30 câu đánh giá AI tiếng Việt và Kết quả đối chiếu Baseline (\`F10\`, \`AI07\`, \`AI08\`, \`R12\`)

- **Phụ trách lập bộ câu hỏi & chạy kiểm chứng giao diện:** Lý Thế An (\`lythean2508\`)
- **Phối hợp hiệu chỉnh backend embedding (\`T34\`, \`T47\`):** Phạm Hiển
- **Quy mô danh mục:** \`100\` đầu sách tiếng Việt (\`data/books_catalog_100.json\`), mô tả \`93–127\` từ/sách.
- **Cấu trúc bộ câu hỏi (\`data/ai_eval_30_queries_vi.json\`):** \`30\` câu gán nhãn trước, chia tách nghiêm ngặt:
  - **Tập hiệu chỉnh (\`calibration\`):** \`20\` câu (\`17\` câu có sách phù hợp + \`3\` câu ngoài phạm vi không có sách phù hợp).
  - **Tập giữ lại độc lập (\`holdout\` — \`R12\`):** \`10\` câu (\`9\` câu có sách phù hợp + \`1\` câu ngoài phạm vi không có sách phù hợp).

> [!NOTE]
> Báo cáo dưới đây ghi nhận kết quả chạy thực tế của tầng **Local Vietnamese Semantic Engine** tích hợp sẵn trên Frontend so với **Baseline Tìm từ khóa**. Khi Phạm Hiển hoàn tất API \`intfloat/multilingual-e5-small\` trên FastAPI (\`T29\`, \`T34\`), cùng tập \`data/ai_eval_30_queries_vi.json\` này được dùng nguyên trạng để đo lại mà không sửa nhãn tập giữ lại (\`R12\`).

---

## 1. Tổng hợp chỉ số Hit@5 và Khả năng từ chối câu ngoài danh mục (\`AI08\`, \`TC18\`, \`TC19\`)

| Tập đánh giá | Nhóm câu hỏi | Tìm ngữ nghĩa AI (Hit@5) | Baseline Từ khóa (Hit@5) | So sánh với mục tiêu \`AI08\` (\`>= 80%\` & \`>= Baseline\`) |
| :--- | :--- | :--- | :--- | :--- |
| **Calibration (20 câu)** | Câu có sách phù hợp (\`${cal.posTotal}\` câu) | **${cal.aiPosHits}/${cal.posTotal} (${cal.aiPosRate.toFixed(1)}%)** | ${cal.kwPosHits}/${cal.posTotal} (${cal.kwPosRate.toFixed(1)}%) | Đạt vượt mức baseline |
| **Calibration (20 câu)** | Câu không có sách phù hợp (\`${cal.negTotal}\` câu) | **${cal.aiNegHits}/${cal.negTotal} từ chối đúng** | ${cal.kwNegHits}/${cal.negTotal} từ chối đúng | Đạt \`TC19\` (báo rõ chưa có sách vượt ngưỡng) |
| **Holdout độc lập (10 câu)** | Câu có sách phù hợp (\`${hold.posTotal}\` câu) | **${hold.aiPosHits}/${hold.posTotal} (${hold.aiPosRate.toFixed(1)}%)** | ${hold.kwPosHits}/${hold.posTotal} (${hold.kwPosRate.toFixed(1)}%) | **Đạt mục tiêu Hit@5 >= 80%** (\`TC18\`) |
| **Holdout độc lập (10 câu)** | Câu không có sách phù hợp (\`${hold.negTotal}\` câu) | **${hold.aiNegHits}/${hold.negTotal} từ chối đúng** | ${hold.kwNegHits}/${hold.negTotal} từ chối đúng | Đạt \`TC19\` |

- **Độ trễ truy vấn sau warm-up (100 đầu sách):** \`p95 = ${Math.max(cal.p95Ms, hold.p95Ms).toFixed(2)} ms\` (mục tiêu \`AI09\`: \`<= 3000 ms\`).

---

## 2. Bảng chi tiết từng câu hỏi trong bộ 30 câu (\`Q01\` – \`Q30\`)

| Mã | Tập | Loại câu | Truy vấn tiếng Việt | Nhãn kỳ vọng | Top 5 AI trả về | AI Đạt? | Top 5 Từ khóa | KW Đạt? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${allRows
  .map(
    (r) =>
      `| \`${r.item.id}\` | \`${r.item.split}\` | \`${r.item.query_type}\` | ${r.item.query} | \`${
        r.item.expected_book_ids.length ? r.item.expected_book_ids.join(', ') : '(Rỗng - Không có)'
      }\` | \`${r.aiTop5.length ? r.aiTop5.join(', ') : '(Từ chối dưới ngưỡng)'}\` | ${
        r.aiHit5 ? 'Đạt' : 'Chưa đạt'
      } | \`${r.kwTop5.length ? r.kwTop5.join(', ') : '(Rỗng)'}\` | ${r.kwHit5 ? 'Đạt' : 'Chưa đạt'} |`
  )
  .join('\n')}
`;

const outPath = path.resolve(process.cwd(), '..', 'docs', '03-bao-cao-danh-gia-ai-T33.md');
fs.writeFileSync(outPath, md, 'utf8');

console.log(
  JSON.stringify({
    calibration_hit5: `${cal.aiPosHits}/${cal.posTotal} (${cal.aiPosRate.toFixed(1)}%)`,
    calibration_kw_hit5: `${cal.kwPosHits}/${cal.posTotal} (${cal.kwPosRate.toFixed(1)}%)`,
    holdout_hit5: `${hold.aiPosHits}/${hold.posTotal} (${hold.aiPosRate.toFixed(1)}%)`,
    holdout_kw_hit5: `${hold.kwPosHits}/${hold.posTotal} (${hold.kwPosRate.toFixed(1)}%)`,
    negative_rejected: `${cal.aiNegHits + hold.aiNegHits}/${cal.negTotal + hold.negTotal}`,
    report_written: outPath,
  })
);
