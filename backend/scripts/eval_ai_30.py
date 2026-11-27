#!/usr/bin/env python3
"""
Kịch bản đánh giá độc lập 30 câu truy vấn tiếng Việt (20 Calibration + 10 Holdout)
và đo tốc độ p95 sau warm-up trên 20 lượt chạy với 100 đầu sách (T34, T40, T47, TC18, TC19, TC24).
"""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.ai_engine import (  # noqa: E402
    EVAL_QUERIES_PATH,
    FULL_MODEL_ID,
    MODEL_NAME,
    MODEL_REVISION,
    SEMANTIC_SIMILARITY_THRESHOLD,
    engine,
    load_books_with_availability,
    run_keyword_search,
    search_semantic,
)


def compute_p95(latencies_ms: List[float]) -> float:
    if not latencies_ms:
        return 0.0
    sorted_vals = sorted(latencies_ms)
    idx = min(int(math.floor(len(sorted_vals) * 0.95)), len(sorted_vals) - 1)
    return round(sorted_vals[idx], 3)


def evaluate_split(
    items: List[Dict[str, Any]],
    books: List[Dict[str, Any]],
) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    latencies: List[float] = []

    for item in items:
        q_text = str(item["query"])
        expected_ids = [str(x) for x in item.get("expected_book_ids", [])]
        is_negative = len(expected_ids) == 0

        t0 = time.perf_counter()
        ai_res = search_semantic(q_text, books=books, top_k=5)
        latency_ms = (time.perf_counter() - t0) * 1000.0
        latencies.append(latency_ms)

        kw_res = run_keyword_search(q_text, books=books, limit=5)

        ai_top5 = [str(r["book_id"]) for r in ai_res["results"]]
        kw_top5 = [str(b["id"]) for b in kw_res]

        if is_negative:
            ai_hit = len(ai_top5) == 0 and bool(ai_res.get("below_threshold_message"))
            kw_hit = len(kw_top5) == 0
        else:
            ai_hit = any(exp in ai_top5 for exp in expected_ids)
            kw_hit = any(exp in kw_top5 for exp in expected_ids)

        rows.append(
            {
                "id": item["id"],
                "split": item["split"],
                "query_type": item["query_type"],
                "query": q_text,
                "expected_book_ids": expected_ids,
                "ai_top5": ai_top5,
                "kw_top5": kw_top5,
                "ai_hit5": ai_hit,
                "kw_hit5": kw_hit,
                "below_threshold_message": ai_res.get("below_threshold_message"),
                "latency_ms": round(latency_ms, 3),
            }
        )

    pos_rows = [r for r in rows if len(r["expected_book_ids"]) > 0]
    neg_rows = [r for r in rows if len(r["expected_book_ids"]) == 0]

    ai_pos_hits = sum(1 for r in pos_rows if r["ai_hit5"])
    kw_pos_hits = sum(1 for r in pos_rows if r["kw_hit5"])
    ai_neg_hits = sum(1 for r in neg_rows if r["ai_hit5"])
    kw_neg_hits = sum(1 for r in neg_rows if r["kw_hit5"])

    pos_total = len(pos_rows)
    neg_total = len(neg_rows)

    return {
        "rows": rows,
        "pos_total": pos_total,
        "neg_total": neg_total,
        "ai_pos_hits": ai_pos_hits,
        "kw_pos_hits": kw_pos_hits,
        "ai_pos_rate": round((ai_pos_hits / pos_total) * 100.0, 2) if pos_total else 0.0,
        "kw_pos_rate": round((kw_pos_hits / pos_total) * 100.0, 2) if pos_total else 0.0,
        "ai_neg_hits": ai_neg_hits,
        "kw_neg_hits": kw_neg_hits,
        "p95_ms": compute_p95(latencies),
        "avg_ms": round(sum(latencies) / len(latencies), 3) if latencies else 0.0,
    }


def run_evaluation() -> Dict[str, Any]:
    books = load_books_with_availability(include_hidden=True)
    queries: List[Dict[str, Any]] = json.loads(EVAL_QUERIES_PATH.read_text(encoding="utf-8"))

    # Warm-up & index build
    t_cold0 = time.perf_counter()
    index_summary = engine.sync_and_verify_embeddings(books=books, force_rebuild=True)
    cold_start_ms = round((time.perf_counter() - t_cold0) * 1000.0, 2)

    calibration_items = [q for q in queries if q.get("split") == "calibration"]
    holdout_items = [q for q in queries if q.get("split") == "holdout"]

    cal_eval = evaluate_split(calibration_items, books)
    hold_eval = evaluate_split(holdout_items, books)

    # Đo độ trễ p95 sau warm-up trên 20 lượt truy vấn liên tiếp với danh mục 100 sách (TC24, T40)
    warmup_20_queries = queries[:20]
    benchmark_latencies: List[float] = []
    for q_item in warmup_20_queries:
        t0 = time.perf_counter()
        _ = search_semantic(str(q_item["query"]), books=books, top_k=5)
        benchmark_latencies.append((time.perf_counter() - t0) * 1000.0)

    p95_20_runs_ms = compute_p95(benchmark_latencies)
    avg_20_runs_ms = round(sum(benchmark_latencies) / len(benchmark_latencies), 3)

    summary = {
        "model_name": MODEL_NAME,
        "model_revision": MODEL_REVISION,
        "full_model_id": FULL_MODEL_ID,
        "threshold": SEMANTIC_SIMILARITY_THRESHOLD,
        "catalog_size": len(books),
        "cold_start_index_ms": cold_start_ms,
        "index_summary": index_summary,
        "calibration": {
            "positive_hit5": f"{cal_eval['ai_pos_hits']}/{cal_eval['pos_total']}",
            "positive_hit5_pct": cal_eval["ai_pos_rate"],
            "keyword_baseline_hit5": f"{cal_eval['kw_pos_hits']}/{cal_eval['pos_total']}",
            "keyword_baseline_hit5_pct": cal_eval["kw_pos_rate"],
            "negative_rejection": f"{cal_eval['ai_neg_hits']}/{cal_eval['neg_total']}",
            "keyword_negative_rejection": f"{cal_eval['kw_neg_hits']}/{cal_eval['neg_total']}",
        },
        "holdout": {
            "positive_hit5": f"{hold_eval['ai_pos_hits']}/{hold_eval['pos_total']}",
            "positive_hit5_pct": hold_eval["ai_pos_rate"],
            "keyword_baseline_hit5": f"{hold_eval['kw_pos_hits']}/{hold_eval['pos_total']}",
            "keyword_baseline_hit5_pct": hold_eval["kw_pos_rate"],
            "negative_rejection": f"{hold_eval['ai_neg_hits']}/{hold_eval['neg_total']}",
            "keyword_negative_rejection": f"{hold_eval['kw_neg_hits']}/{hold_eval['neg_total']}",
            "meets_target_80_pct": hold_eval["ai_pos_rate"] >= 80.0,
        },
        "latency_20_runs_100_books": {
            "runs": len(benchmark_latencies),
            "p95_ms": p95_20_runs_ms,
            "avg_ms": avg_20_runs_ms,
            "max_ms": round(max(benchmark_latencies), 3),
            "meets_tc24_3000ms": p95_20_runs_ms <= 3000.0,
            "meets_50ms_target": p95_20_runs_ms <= 50.0,
        },
        "details": [*cal_eval["rows"], *hold_eval["rows"]],
    }
    return summary


def main() -> int:
    result = run_evaluation()
    print(json.dumps({k: v for k, v in result.items() if k != "details"}, ensure_ascii=False, indent=2))

    cal = result["calibration"]
    hold = result["holdout"]
    lat = result["latency_20_runs_100_books"]

    if hold["positive_hit5_pct"] < 80.0:
        print(f"ERROR: Holdout Hit@5 ({hold['positive_hit5_pct']}%) < 80%", file=sys.stderr)
        return 1
    if hold["negative_rejection"] != "1/1" or cal["negative_rejection"] != "3/3":
        print("ERROR: Negative query rejection failed TC19", file=sys.stderr)
        return 1
    if not lat["meets_tc24_3000ms"]:
        print(f"ERROR: p95 latency ({lat['p95_ms']} ms) exceeds 3000 ms", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
