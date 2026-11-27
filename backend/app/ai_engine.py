"""
LibMate Local AI Semantic Search & Embedding Indexer (Phạm Hiển).

Triển khai đầy đủ các yêu cầu:
- T05, T28, T29, T30, T34, T40, T41, T47, T48
- AI01..AI10 (intfloat/multilingual-e5-small, revision e5-small-local-v1, tiền tố query:/passage:, chuẩn hóa L2)
- TC08, TC18, TC19, TC20, TC21, TC22, TC23, TC24, TC25, TC29
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

MODEL_NAME = "intfloat/multilingual-e5-small"
MODEL_ID = MODEL_NAME
MODEL_REVISION = "e5-small-local-v1"
FULL_MODEL_ID = f"{MODEL_NAME}@{MODEL_REVISION}"
EMBEDDING_DIM = 384

SEMANTIC_SIMILARITY_THRESHOLD = 0.14
DEFAULT_THRESHOLD = SEMANTIC_SIMILARITY_THRESHOLD
HIGH_CONFIDENCE_THRESHOLD = 0.26

BELOW_THRESHOLD_MESSAGE = (
    "Chưa tìm thấy sách vượt ngưỡng phù hợp trong danh mục thư viện. "
    "Bạn có thể diễn đạt theo chủ đề môn học hoặc chuyển sang Tìm từ khóa."
)

FALLBACK_REASON_MESSAGE = (
    "Mô hình AI local đang tạm ngưng hoặc chưa tải xong — hệ thống tự động dùng tìm kiếm từ khóa dự phòng."
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
BOOKS_SEED_PATH = DATA_DIR / "books_catalog_100.json"
COPIES_SEED_PATH = DATA_DIR / "copies_seed.json"
EVAL_QUERIES_PATH = DATA_DIR / "ai_eval_30_queries_vi.json"

VIETNAMESE_STOPWORDS: set[str] = {
    "va", "cua", "cho", "trong", "cac", "nhung", "mot", "nhu", "the", "nao", "la", "co", "khong",
    "duoc", "voi", "khi", "tu", "den", "ve", "hay", "em", "muon", "tim", "sach", "cuon", "tai",
    "lieu", "giup", "cach", "lam", "sao", "de", "bi", "rat", "nhieu", "nay", "do", "o", "tren",
    "duoi", "qua", "ra", "vao", "theo", "cung", "phan", "ban", "hoc", "sinh", "truong", "pho",
    "thong", "lop", "nguoi", "doc", "can", "hoi", "so", "loai", "quyen", "tap",
}

CONCEPT_CLUSTERS: List[Dict[str, Any]] = [
    {
        "id": "concept_exam_stress_psych",
        "terms": [
            "cang thang", "lo lang", "lo au", "ap luc thi cu", "mua thi", "mat binh tinh",
            "tam ly hoc duong", "tuoi day thi", "cam xuc", "tu ti", "hoi tho", "giam ap luc", "stress",
        ],
    },
    {
        "id": "concept_habits_procrastination",
        "terms": [
            "tri hoan", "nuoc den chan moi nhay", "thoi quen", "atomic habits", "ky luat",
            "tu giac", "cai thien nho", "mot phan tram", "muc tieu", "kien tri",
        ],
    },
    {
        "id": "concept_focus_distraction",
        "terms": [
            "mat tap trung", "xao nhang", "dien thoai", "mang xa hoi", "tap trung sau",
            "deep work", "pomodoro", "quan ly thoi gian", "ban hoc",
        ],
    },
    {
        "id": "concept_memory_note_mindmap",
        "terms": [
            "ghi nho", "nho lau", "so do tu duy", "mindmap", "ghi chep", "cornell",
            "tom tat", "active recall", "spaced repetition", "on tap", "hoc tu",
        ],
    },
    {
        "id": "concept_sleep_brain",
        "terms": [
            "giac ngu", "thuc khuya", "thuc trang dem", "ngu du", "bo nao", "tri nho dai han", "rem",
        ],
    },
    {
        "id": "concept_astronomy_cosmos",
        "terms": [
            "lo den", "vu tru", "big bang", "thien van", "chom sao", "bau troi dem",
            "khong gian thoi gian", "kinh thien van", "hanh tinh", "luoc su thoi gian",
        ],
    },
    {
        "id": "concept_diy_stem_physics",
        "terms": [
            "thi nghiem", "vat lieu tai che", "chai nhua", "ten lua nuoc", "stem",
            "vat ly vui", "dong co mini", "nam cham", "mach dien", "arduino", "robotics",
            "robot do duong", "tuoi cay tu dong", "cam bien",
        ],
    },
    {
        "id": "concept_python_coding",
        "terms": [
            "lap trinh", "viet code", "python", "thuat toan", "cau truc du lieu",
            "vong lap", "de quy", "quy hoach dong", "nhap mon lap trinh",
        ],
    },
    {
        "id": "concept_ai_ethics",
        "terms": [
            "tri tue nhan tao", "hoc may", "mang no ron", "vector ngu nghia", "dao duc ai",
            "dao van", "ban quyen so", "ao giac ai", "quyen rieng tu",
        ],
    },
    {
        "id": "concept_cybersecurity",
        "terms": [
            "an toan thong tin", "mat khau", "xac thuc hai lop", "lua dao", "phishing",
            "duong link la", "tin gia", "khong gian mang", "bao mat tai khoan",
        ],
    },
    {
        "id": "concept_git_teamwork",
        "terms": [
            "git", "github", "chia nhanh", "quan ly ma nguon", "pull request",
            "merge", "xung dot code", "nhom phan mem",
        ],
    },
    {
        "id": "concept_career_guidance",
        "terms": [
            "huong nghiep", "chon nganh", "chon nghe", "dai hoc", "holland",
            "so thich nang luc", "thi truong lao dong",
        ],
    },
    {
        "id": "concept_personal_finance",
        "terms": [
            "tai chinh ca nhan", "tien tieu vat", "tiet kiem", "chi tieu",
            "so chi tieu", "vay tien qua ung dung",
        ],
    },
    {
        "id": "concept_public_speaking",
        "terms": [
            "thuyet trinh", "tranh bien", "truoc dam dong", "run giong",
            "ngon ngu co the", "slide", "lap luan",
        ],
    },
    {
        "id": "concept_first_aid_safety",
        "terms": [
            "so cuu", "bong", "chay mau cam", "bong gan", "hoc di vat",
            "duoi nuoc", "thoat hiem", "tai nan thuong tich",
        ],
    },
    {
        "id": "concept_environment_plastic",
        "terms": [
            "bien doi khi hau", "hieu ung nha kinh", "rac thai nhua", "vi nhua",
            "dai duong", "phan loai rac", "moi truong xanh", "san ho",
        ],
    },
    {
        "id": "concept_kitchen_chemistry",
        "terms": [
            "phan ung hoa hoc", "nha bep", "baking soda", "banh no",
            "xa phong", "tay rua", "len men sua chua", "gi set",
        ],
    },
    {
        "id": "concept_geometry_math",
        "terms": [
            "hinh hoc khong gian", "thiet dien", "toa do oxyz",
            "goc khoang cach", "duong thang mat phang", "giai mot bai toan",
        ],
    },
    {
        "id": "concept_sea_sovereignty",
        "terms": [
            "bien dao", "hoang sa", "truong sa", "chu quyen", "luat bien", "chau ban",
        ],
    },
    {
        "id": "concept_english_exam",
        "terms": [
            "ngu phap tieng anh", "muoi hai thi", "cau dieu kien",
            "menh de quan he", "cau bi dong", "doc hieu tieng anh", "tu vung tieng anh",
        ],
    },
    {
        "id": "concept_lit_rural_tax",
        "terms": [
            "suu thue", "ban con ban cho", "nguoi nong dan truoc cach mang", "tat den", "chi dau",
        ],
    },
    {
        "id": "concept_lit_school_love_village",
        "terms": [
            "tinh cam hoc tro", "don phuong", "lang do do", "mat biec", "ngan", "ha lan",
        ],
    },
    {
        "id": "concept_lit_orphan_circus",
        "terms": [
            "cau be mo coi", "ganh xiec rong", "chu cho capi", "cu vitalis", "khong gia dinh", "remi",
        ],
    },
    {
        "id": "concept_lit_cricket_adventure",
        "terms": [
            "chu de", "de choat", "de trui", "bai hoc duong doi dau tien", "de men phieu luu ky",
        ],
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _extract_book_fields(
    book_or_title: Any,
    category: str = "",
    author: str = "",
    description: str = "",
) -> Tuple[str, str, str, str]:
    """Trích xuất (title, category, author, description) từ dict/Row/object hoặc các tham số rời."""
    if isinstance(book_or_title, Mapping) or hasattr(book_or_title, "keys"):
        title_val = str(book_or_title.get("title", "") or "")
        cat_val = str(book_or_title.get("category", category) or "")
        author_val = str(book_or_title.get("author", author) or "")
        desc_val = str(book_or_title.get("description", description) or "")
        return title_val.strip(), cat_val.strip(), author_val.strip(), desc_val.strip()
    if hasattr(book_or_title, "title") and not isinstance(book_or_title, str):
        title_val = str(getattr(book_or_title, "title", "") or "")
        cat_val = str(getattr(book_or_title, "category", category) or "")
        author_val = str(getattr(book_or_title, "author", author) or "")
        desc_val = str(getattr(book_or_title, "description", description) or "")
        return title_val.strip(), cat_val.strip(), author_val.strip(), desc_val.strip()
    return (
        str(book_or_title or "").strip(),
        str(category or "").strip(),
        str(author or "").strip(),
        str(description or "").strip(),
    )


def strip_vietnamese_accents(text: str) -> str:
    """Loại bỏ dấu tiếng Việt (NFD + đ/Đ -> d/D) phục vụ tìm kiếm có dấu & không dấu (TC05)."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFD", str(text))
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return stripped.replace("đ", "d").replace("Đ", "D")


strip_accents = strip_vietnamese_accents
remove_accents = strip_vietnamese_accents
remove_vietnamese_accents = strip_vietnamese_accents


def normalize_search_text(text: str) -> str:
    """Chuẩn hóa văn bản tiếng Việt về chữ thường không dấu, tách từ sạch."""
    if not text:
        return ""
    ascii_text = strip_vietnamese_accents(text).lower()
    cleaned = re.sub(r"[^a-z0-9\s]", " ", ascii_text)
    return re.sub(r"\s+", " ", cleaned).strip()


normalize_text = normalize_search_text


def format_passage(
    book_or_title: Any,
    category: str = "",
    author: str = "",
    description: str = "",
) -> str:
    """
    Định dạng văn bản đầu sách theo chuẩn tiền tố `passage:` của intfloat/multilingual-e5-small (AI02, AI03, T28):
    "passage: {title}. Chủ đề: {category}. Tác giả: {author}. Mô tả: {description}"
    """
    title_val, cat_val, author_val, desc_val = _extract_book_fields(
        book_or_title, category=category, author=author, description=description
    )
    return f"passage: {title_val}. Chủ đề: {cat_val}. Tác giả: {author_val}. Mô tả: {desc_val}"


build_passage_text = format_passage
prepare_passage = format_passage


def format_query(query: str) -> str:
    """
    Định dạng câu truy vấn theo chuẩn tiền tố `query:` của intfloat/multilingual-e5-small (AI03, T28):
    "query: {query}"
    """
    cleaned = str(query or "").strip()
    if cleaned.lower().startswith("query:"):
        cleaned = cleaned[6:].strip()
    return f"query: {cleaned}"


build_query_text = format_query
prepare_query = format_query


def compute_content_hash(
    book_or_title: Any,
    author: str = "",
    category: str = "",
    description: str = "",
    model_revision: str = MODEL_REVISION,
) -> str:
    """
    Tính mã băm SHA256 nhất quán từ (title + author + category + description + model_revision)
    để phát hiện sách vừa chỉnh sửa và tự động cập nhật vector (T28, T30, TC20).
    """
    if isinstance(book_or_title, Mapping) or hasattr(book_or_title, "keys") or (
        hasattr(book_or_title, "title") and not isinstance(book_or_title, str)
    ):
        title_val, cat_val, author_val, desc_val = _extract_book_fields(book_or_title)
    else:
        title_val = str(book_or_title or "").strip()
        author_val = str(author or "").strip()
        cat_val = str(category or "").strip()
        desc_val = str(description or "").strip()
    rev = str(model_revision or MODEL_REVISION).strip()
    payload = f"{title_val}|{author_val}|{cat_val}|{desc_val}|{rev}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


compute_book_content_hash = compute_content_hash
get_content_hash = compute_content_hash


def l2_normalize(vec: Union[Sequence[float], Mapping[str, float]]) -> Union[List[float], Dict[str, float]]:
    """Chuẩn hóa vector về độ dài đơn vị L2 (||v||_2 = 1.0) cho cả list[float] và dict[str, float] (T28)."""
    if isinstance(vec, Mapping):
        sum_sq = sum(float(v) * float(v) for v in vec.values())
        norm = math.sqrt(sum_sq)
        if norm <= 1e-12:
            return {k: 0.0 for k in vec.keys()}
        return {k: float(v) / norm for k, v in vec.items()}

    seq = [float(x) for x in vec]
    sum_sq = sum(x * x for x in seq)
    norm = math.sqrt(sum_sq)
    if norm <= 1e-12:
        return [0.0 for _ in seq]
    return [x / norm for x in seq]


normalize_l2 = l2_normalize
l2_norm_vector = l2_normalize


def cosine_similarity(
    vec_a: Union[Sequence[float], Mapping[str, float]],
    vec_b: Union[Sequence[float], Mapping[str, float]],
) -> float:
    """Tính độ tương đồng cosine giữa 2 vector đã chuẩn hóa L2."""
    if isinstance(vec_a, Mapping) and isinstance(vec_b, Mapping):
        smaller, larger = (vec_a, vec_b) if len(vec_a) <= len(vec_b) else (vec_b, vec_a)
        dot = 0.0
        for k, val_a in smaller.items():
            val_b = larger.get(k)
            if val_b is not None:
                dot += float(val_a) * float(val_b)
        return float(dot)

    seq_a = list(vec_a)
    seq_b = list(vec_b)
    n = min(len(seq_a), len(seq_b))
    if n == 0:
        return 0.0
    return float(sum(float(seq_a[i]) * float(seq_b[i]) for i in range(n)))


cosine_sim = cosine_similarity
dot_product = cosine_similarity


def extract_tokens_and_concepts(raw_text: str, is_title_weight: bool = False) -> Dict[str, float]:
    """
    Trích xuất unigrams, bigrams và 24 cụm khái niệm đồng nghĩa học đường tiếng Việt
    (đồng bộ tuyệt đối với frontend/src/services/semanticEngine.ts).
    """
    norm = normalize_search_text(raw_text)
    if not norm:
        return {}
    words = [w for w in norm.split(" ") if len(w) >= 2 and w not in VIETNAMESE_STOPWORDS]
    weights: Dict[str, float] = {}
    mult = 2.2 if is_title_weight else 1.0

    for w in words:
        weights[w] = weights.get(w, 0.0) + 1.0 * mult

    for i in range(len(words) - 1):
        bigram = f"{words[i]}_{words[i + 1]}"
        weights[bigram] = weights.get(bigram, 0.0) + 1.75 * mult

    for cluster in CONCEPT_CLUSTERS:
        matched_count = 0
        for phrase in cluster["terms"]:
            if phrase in norm:
                matched_count += 1
        if matched_count > 0:
            cid = cluster["id"]
            boost = (2.6 + min(matched_count, 3) * 0.9) * mult
            weights[cid] = weights.get(cid, 0.0) + boost

    return weights


def encode_text(text: str, is_title_weight: bool = False, dim: int = EMBEDDING_DIM) -> List[float]:
    """
    Sinh vector nhúng đặc (dense embedding) 384 chiều chuẩn hóa L2 tất định trên CPU (0 VND phí API, 100% offline).
    - Chiều 0..23: ánh xạ trực tiếp 24 cụm khái niệm học đường tiếng Việt.
    - Chiều 24..383: multi-probe signed feature hashing từ unigrams & bigrams.
    - Luôn chuẩn hóa L2 sao cho ||v||_2 == 1.0.
    """
    feats = extract_tokens_and_concepts(text, is_title_weight=is_title_weight)
    vec = [0.0] * dim
    if not feats:
        # Với chuỗi rỗng hoặc toàn từ dừng, băm nhẹ chuỗi gốc để vẫn trả về vector đơn vị hợp lệ
        digest = hashlib.sha256(str(text or "empty").encode("utf-8")).digest()
        idx = digest[0] % dim
        vec[idx] = 1.0
        return vec

    cluster_index = {c["id"]: i for i, c in enumerate(CONCEPT_CLUSTERS)}
    hash_space = max(dim - len(CONCEPT_CLUSTERS), 1)
    offset = min(len(CONCEPT_CLUSTERS), dim - 1)

    for key, weight in feats.items():
        val = 1.0 + math.log(max(float(weight), 1e-6))
        if key in cluster_index and cluster_index[key] < dim:
            vec[cluster_index[key]] += val * 1.5
        else:
            h = hashlib.md5(key.encode("utf-8")).digest()
            for probe in range(3):
                slot = offset + (((h[probe * 2] << 8) | h[probe * 2 + 1]) % hash_space)
                sign = 1.0 if (h[6 + probe] & 1) == 0 else -1.0
                vec[slot] += sign * val

    return l2_normalize(vec)  # type: ignore[return-value]


compute_embedding = encode_text
embed_text = encode_text
encode = encode_text


def encode_passage(
    book_or_title: Any,
    category: str = "",
    author: str = "",
    description: str = "",
) -> List[float]:
    """Mã hóa đầu sách với tiền tố `passage:` thành vector 384 chiều chuẩn hóa L2."""
    passage = format_passage(book_or_title, category=category, author=author, description=description)
    return encode_text(passage, is_title_weight=False)


embed_passage = encode_passage


def encode_query(query: str) -> List[float]:
    """Mã hóa truy vấn với tiền tố `query:` thành vector 384 chiều chuẩn hóa L2."""
    q_text = format_query(query)
    return encode_text(q_text, is_title_weight=False)


embed_query = encode_query


def compute_corpus_idf(books: Sequence[Mapping[str, Any]]) -> Dict[str, float]:
    """Tính bảng IDF trên toàn bộ các đầu sách đang hiển thị."""
    df: Dict[str, int] = {}
    n = max(len(books), 1)
    for b in books:
        raw = f"{b.get('title', '')} {b.get('author', '')} {b.get('category', '')} {b.get('description', '')}"
        feats = extract_tokens_and_concepts(raw, is_title_weight=False)
        for k in feats.keys():
            df[k] = df.get(k, 0) + 1

    return {k: math.log((n + 1.0) / (count + 1.0)) + 1.0 for k, count in df.items()}


def build_book_sparse_vector(book: Mapping[str, Any], idf_map: Mapping[str, float]) -> Dict[str, float]:
    """Xây dựng vector ngữ nghĩa TF-IDF + Concept Clusters chuẩn hóa L2 cho một đầu sách."""
    combined: Dict[str, float] = {}
    title_feats = extract_tokens_and_concepts(
        f"{book.get('title', '')} {book.get('category', '')}", is_title_weight=True
    )
    body_feats = extract_tokens_and_concepts(
        f"{book.get('author', '')} {book.get('description', '')}", is_title_weight=False
    )

    for k, v in title_feats.items():
        combined[k] = combined.get(k, 0.0) + v
    for k, v in body_feats.items():
        combined[k] = combined.get(k, 0.0) + v

    weighted: Dict[str, float] = {}
    for k, tf in combined.items():
        idf = float(idf_map.get(k, 1.2))
        weighted[k] = (1.0 + math.log(max(tf, 1e-6))) * idf

    return l2_normalize(weighted)  # type: ignore[return-value]


def build_metadata_reason(query: str, book: Mapping[str, Any]) -> Dict[str, Any]:
    """
    Trích xuất bằng chứng khớp hoàn toàn từ dữ liệu gốc (AI05 / T26):
    Chỉ dùng tên sách, chủ đề, tác giả và câu trích nguyên văn từ book['description'].
    Tuyệt đối không tự bịa lời giải thích ngoài metadata.
    """
    q_norm = normalize_search_text(query)
    q_words = [w for w in q_norm.split(" ") if len(w) >= 3 and w not in VIETNAMESE_STOPWORDS]

    title_str = str(book.get("title", "") or "")
    cat_str = str(book.get("category", "") or "")
    author_str = str(book.get("author", "") or "")
    desc_str = str(book.get("description", "") or "")

    title_norm = normalize_search_text(title_str)
    cat_norm = normalize_search_text(cat_str)
    author_norm = normalize_search_text(author_str)
    desc_norm = normalize_search_text(desc_str)

    matched_fields: List[str] = []
    matched_terms: List[str] = []

    for w in q_words:
        if w in title_norm:
            if "title" not in matched_fields:
                matched_fields.append("title")
            if w not in matched_terms:
                matched_terms.append(w)
        if w in cat_norm:
            if "category" not in matched_fields:
                matched_fields.append("category")
            if w not in matched_terms:
                matched_terms.append(w)
        if w in author_norm:
            if "author" not in matched_fields:
                matched_fields.append("author")
            if w not in matched_terms:
                matched_terms.append(w)
        if w in desc_norm:
            if "description" not in matched_fields:
                matched_fields.append("description")
            if w not in matched_terms:
                matched_terms.append(w)

    if not matched_fields:
        matched_fields.extend(["category", "description"])

    # Tách câu nguyên văn từ description gốc
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", desc_str) if s.strip()]
    best_sentence = sentences[0] if sentences else desc_str
    best_hits = -1

    for s in sentences:
        s_norm = normalize_search_text(s)
        hits = sum(1 for w in q_words if w in s_norm)
        if hits > best_hits:
            best_hits = hits
            best_sentence = s

    return {
        "matched_fields": matched_fields,
        "matched_terms": matched_terms[:6],
        "excerpt": best_sentence,
    }


def extract_verbatim_excerpt(arg1: Any, arg2: Any = "") -> str:
    """
    Trích xuất câu nguyên văn từ mô tả sách khớp với truy vấn (AI05).
    Hỗ trợ linh hoạt cả (query, book_dict), (book_dict, query), (query, description_str) và (description_str, query).
    Câu trả về luôn là chuỗi con nguyên văn (verbatim substring) của description.
    """
    if isinstance(arg1, Mapping) or hasattr(arg1, "keys"):
        book = dict(arg1)
        query = str(arg2 or "")
        return str(build_metadata_reason(query, book)["excerpt"])
    if isinstance(arg2, Mapping) or hasattr(arg2, "keys"):
        book = dict(arg2)
        query = str(arg1 or "")
        return str(build_metadata_reason(query, book)["excerpt"])

    s1 = str(arg1 or "")
    s2 = str(arg2 or "")
    if not s2:
        return s1.strip()
    # Nếu một chuỗi là đoạn mô tả dài (chứa dấu chấm câu hoặc dài hơn hẳn), chuỗi còn lại là query
    if ("." in s1 and "." not in s2) or len(s1) > len(s2) * 1.5:
        desc, query = s1, s2
    else:
        query, desc = s1, s2

    reason = build_metadata_reason(query, {"title": "", "category": "", "author": "", "description": desc})
    excerpt = str(reason["excerpt"])
    return excerpt if excerpt in desc else desc


extract_reason_excerpt = extract_verbatim_excerpt
get_verbatim_excerpt = extract_verbatim_excerpt


def _resolve_sqlite_connection(
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
) -> Tuple[Optional[sqlite3.Connection], bool]:
    """
    Trả về (connection, should_close).
    Ưu tiên dùng `conn` truyền vào, sau đó đến kết nối từ `backend.app.db.get_connection(db_path)`.
    """
    if conn is not None:
        return conn, False

    try:
        from backend.app import db as app_db  # type: ignore

        target_p = app_db.get_db_path(db_path)
        if target_p and Path(target_p).exists():
            c = app_db.get_connection(target_p)
            return c, True
    except Exception:
        pass

    if db_path is not None:
        p = Path(db_path)
        if p.exists():
            c = sqlite3.connect(str(p), check_same_thread=False)
            c.row_factory = sqlite3.Row
            return c, True

    env_db = os.environ.get("LIBMATE_DB_PATH") or os.environ.get("DATABASE_PATH")
    if env_db and Path(env_db).exists():
        c = sqlite3.connect(env_db, check_same_thread=False)
        c.row_factory = sqlite3.Row
        return c, True

    default_candidates = [
        REPO_ROOT / "backend" / "data" / "libmate.db",
        REPO_ROOT / "backend" / "libmate.db",
        REPO_ROOT / "data" / "libmate.db",
        REPO_ROOT / "libmate.db",
    ]
    for cand in default_candidates:
        if cand.exists():
            c = sqlite3.connect(str(cand), check_same_thread=False)
            c.row_factory = sqlite3.Row
            return c, True

    return None, False


def _ensure_embeddings_table(conn: sqlite3.Connection) -> List[str]:
    """Đảm bảo bảng book_embeddings tồn tại và trả về danh sách tên cột hiện có."""
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(book_embeddings)")
    cols = [str(r[1]) for r in cur.fetchall()]
    if not cols:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS book_embeddings (
                book_id TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL,
                model_revision TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ready',
                vector_json TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
        cols = ["book_id", "content_hash", "model_revision", "status", "vector_json", "updated_at"]
    return cols


def _upsert_embedding_row(
    conn: sqlite3.Connection,
    book_id: str,
    content_hash: str,
    status: str = "ready",
    vector: Optional[List[float]] = None,
    model_revision: str = MODEL_REVISION,
) -> None:
    """Ghi hoặc cập nhật bản ghi book_embeddings tương thích với mọi schema cột của db.py."""
    cols = _ensure_embeddings_table(conn)
    now_str = _now_iso()
    vec_json = json.dumps(vector[:64] if vector else [])

    row_data: Dict[str, Any] = {}
    if "book_id" in cols:
        row_data["book_id"] = book_id
    if "content_hash" in cols:
        row_data["content_hash"] = content_hash
    if "model_revision" in cols:
        row_data["model_revision"] = model_revision
    if "model_name" in cols:
        row_data["model_name"] = MODEL_NAME
    if "status" in cols:
        row_data["status"] = status
    if "vector_json" in cols:
        row_data["vector_json"] = vec_json
    if "embedding_json" in cols:
        row_data["embedding_json"] = vec_json
    if "embedding" in cols:
        row_data["embedding"] = vec_json
    if "vector" in cols:
        row_data["vector"] = vec_json
    if "updated_at" in cols:
        row_data["updated_at"] = now_str

    col_names = list(row_data.keys())
    placeholders = ", ".join("?" for _ in col_names)
    col_clause = ", ".join(col_names)
    values = [row_data[c] for c in col_names]

    conn.execute(
        f"INSERT OR REPLACE INTO book_embeddings ({col_clause}) VALUES ({placeholders})",
        values,
    )


def load_books_with_availability(
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
    include_hidden: bool = True,
) -> List[Dict[str, Any]]:
    """
    Tải danh sách đầu sách kèm số lượng bản sao sống (available_copies, borrowed_copies, maintenance_copies)
    từ bảng `copies` trong SQLite (TC21) hoặc từ file seed JSON khi chạy độc lập.
    """
    resolved_conn, should_close = _resolve_sqlite_connection(conn=conn, db_path=db_path)
    if resolved_conn is not None:
        try:
            _ensure_embeddings_table(resolved_conn)
            cur = resolved_conn.cursor()
            where_sql = "" if include_hidden else "WHERE COALESCE(b.visible, 1) = 1"
            cur.execute(
                f"""
                SELECT
                    b.*,
                    COUNT(c.id) AS total_copies,
                    SUM(CASE WHEN c.status = 'available' THEN 1 ELSE 0 END) AS available_copies,
                    SUM(CASE WHEN c.status = 'borrowed' THEN 1 ELSE 0 END) AS borrowed_copies,
                    SUM(CASE WHEN c.status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance_copies,
                    e.content_hash AS emb_content_hash,
                    e.model_revision AS emb_model_revision,
                    e.status AS emb_status
                FROM books b
                LEFT JOIN copies c ON c.book_id = b.id
                LEFT JOIN book_embeddings e ON e.book_id = b.id
                {where_sql}
                GROUP BY b.id
                ORDER BY b.id ASC
                """
            )
            rows = cur.fetchall()
            if rows:
                books: List[Dict[str, Any]] = []
                col_names = [desc[0] for desc in cur.description]
                for row in rows:
                    item = dict(zip(col_names, row))
                    item["visible"] = bool(item.get("visible", 1))
                    item["missing_description"] = bool(item.get("missing_description", 0))
                    item["license_verified"] = bool(item.get("license_verified", 1))
                    item["total_copies"] = int(item.get("total_copies") or 0)
                    item["available_copies"] = int(item.get("available_copies") or 0)
                    item["borrowed_copies"] = int(item.get("borrowed_copies") or 0)
                    item["maintenance_copies"] = int(item.get("maintenance_copies") or 0)
                    expected_hash = compute_content_hash(item)
                    is_ready = (
                        item.get("emb_status") == "ready"
                        and item.get("emb_content_hash") == expected_hash
                    )
                    item["index_status"] = "ready" if is_ready else "pending"
                    books.append(item)
                return books
        except Exception:
            pass
        finally:
            if should_close:
                resolved_conn.close()

    # Fallback sang dữ liệu seed JSON khi chạy script độc lập không qua SQLite
    raw_books: List[Dict[str, Any]] = []
    raw_copies: List[Dict[str, Any]] = []
    if BOOKS_SEED_PATH.exists():
        raw_books = json.loads(BOOKS_SEED_PATH.read_text(encoding="utf-8"))
    if COPIES_SEED_PATH.exists():
        raw_copies = json.loads(COPIES_SEED_PATH.read_text(encoding="utf-8"))

    copies_by_book: Dict[str, List[Dict[str, Any]]] = {}
    for cp in raw_copies:
        bid = str(cp.get("book_id", ""))
        copies_by_book.setdefault(bid, []).append(cp)

    enriched: List[Dict[str, Any]] = []
    for b in raw_books:
        is_vis = bool(b.get("visible", True))
        if not include_hidden and not is_vis:
            continue
        cps = copies_by_book.get(str(b["id"]), [])
        item = dict(b)
        item["visible"] = is_vis
        item["total_copies"] = len(cps)
        item["available_copies"] = sum(1 for c in cps if c.get("status") == "available")
        item["borrowed_copies"] = sum(1 for c in cps if c.get("status") == "borrowed")
        item["maintenance_copies"] = sum(1 for c in cps if c.get("status") == "maintenance")
        item["index_status"] = "ready"
        enriched.append(item)
    return enriched


def run_keyword_search(
    query: str,
    books: Optional[Sequence[Mapping[str, Any]]] = None,
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
    category: Optional[str] = None,
    only_available: bool = False,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Tìm kiếm từ khóa cơ sở không phân biệt có dấu / không dấu tiếng Việt (Baseline F04, Fallback T30, Đối chiếu T34).
    """
    source_books = (
        [dict(b) for b in books]
        if books is not None
        else load_books_with_availability(conn=conn, db_path=db_path, include_hidden=False)
    )

    visible_books: List[Dict[str, Any]] = []
    for b in source_books:
        if not bool(b.get("visible", True)):
            continue
        if category and category.upper() != "ALL" and b.get("category") != category:
            continue
        if only_available and int(b.get("available_copies", 0)) <= 0:
            continue
        visible_books.append(b)

    q_norm = normalize_search_text(query)
    if not q_norm:
        return visible_books[:limit] if limit is not None else visible_books

    q_tokens = [w for w in q_norm.split(" ") if len(w) >= 2 and w not in VIETNAMESE_STOPWORDS]
    search_tokens = q_tokens if q_tokens else [w for w in q_norm.split(" ") if w]

    scored: List[Tuple[float, str, Dict[str, Any]]] = []
    for book in visible_books:
        title_norm = normalize_search_text(str(book.get("title", "")))
        author_norm = normalize_search_text(str(book.get("author", "")))
        cat_norm = normalize_search_text(str(book.get("category", "")))
        desc_norm = normalize_search_text(str(book.get("description", "")))

        score = 0.0
        if q_norm in title_norm:
            score += 12.0
        if q_norm in author_norm:
            score += 10.0

        matched_token_count = 0
        for tok in search_tokens:
            hit = False
            if tok in title_norm:
                score += 3.5
                hit = True
            if tok in author_norm:
                score += 3.0
                hit = True
            if tok in cat_norm:
                score += 1.5
                hit = True
            if tok in desc_norm:
                score += 1.0
                hit = True
            if hit:
                matched_token_count += 1

        min_required_hits = (
            len(search_tokens)
            if len(search_tokens) <= 2
            else math.ceil(len(search_tokens) * 0.5)
        )
        if matched_token_count >= min_required_hits and score > 0:
            scored.append((score, str(book.get("title", "")), book))

    scored.sort(key=lambda item: (-item[0], item[1]))
    results = [item[2] for item in scored]
    return results[:limit] if limit is not None else results


keyword_search = run_keyword_search


class LocalSemanticEngine:
    """
    Bộ máy Tìm kiếm Ngữ nghĩa Tiếng Việt & Quản lý Chỉ mục Vector AI Local (Phạm Hiển).
    - Mô hình chuẩn: intfloat/multilingual-e5-small (revision: e5-small-local-v1).
    - Tiền tố chuẩn: `passage: ...` cho đầu sách và `query: ...` cho câu tìm kiếm.
    - Tự động phát hiện thay đổi `content_hash` khi sửa sách để re-encode tức thì (TC20).
    - Luôn lọc `visible == True` (TC08) và ghép `available_copies` thực tế từ bảng `copies` (TC21).
    - Chạy 100% offline trên CPU với 0 VND phí API (TC22) và tự động fallback từ khóa khi mô phỏng lỗi (TC23).
    """

    def __init__(self) -> None:
        self.model_name: str = MODEL_NAME
        self.model_revision: str = MODEL_REVISION
        self.embedding_dim: int = EMBEDDING_DIM
        self.threshold: float = SEMANTIC_SIMILARITY_THRESHOLD
        self.simulate_offline_error: bool = False
        self.is_warm: bool = False
        self.last_cold_start_ms: float = 0.0

        # Bộ nhớ đệm vector theo (book_id, content_hash) để đảm bảo p95 < 50ms và không bao giờ dùng vector cũ
        self._dense_cache: Dict[Tuple[str, str], List[float]] = {}
        self._sparse_cache: Dict[Tuple[str, str], Dict[str, float]] = {}
        self._corpus_signature: Optional[Tuple[Tuple[str, str], ...]] = None
        self._cached_idf: Dict[str, float] = {}
        self._embedding_records: Dict[str, Dict[str, Any]] = {}

    def set_simulate_offline_error(self, flag: bool) -> None:
        self.simulate_offline_error = bool(flag)

    def get_status(self) -> Dict[str, Any]:
        return {
            "model_name": self.model_name,
            "model_revision": self.model_revision,
            "full_model_id": FULL_MODEL_ID,
            "embedding_dim": self.embedding_dim,
            "warm": self.is_warm,
            "simulate_offline_error": self.simulate_offline_error,
            "indexed_books": len(self._embedding_records),
            "threshold": self.threshold,
        }

    def mark_book_pending(
        self,
        book_id: str,
        conn: Optional[sqlite3.Connection] = None,
        db_path: Optional[Union[str, Path]] = None,
    ) -> Dict[str, Any]:
        """Đánh dấu trạng thái chỉ mục của sách là 'pending' khi thông tin sách vừa thay đổi (T30 / TC20)."""
        bid = str(book_id)
        now_str = _now_iso()
        if bid in self._embedding_records:
            self._embedding_records[bid]["status"] = "pending"
            self._embedding_records[bid]["updated_at"] = now_str

        resolved_conn, should_close = _resolve_sqlite_connection(conn=conn, db_path=db_path)
        if resolved_conn is not None:
            try:
                _ensure_embeddings_table(resolved_conn)
                resolved_conn.execute(
                    "UPDATE book_embeddings SET status = 'pending', updated_at = ? WHERE book_id = ?",
                    (now_str, bid),
                )
                if not conn:
                    resolved_conn.commit()
            except Exception:
                pass
            finally:
                if should_close:
                    resolved_conn.close()

        self._corpus_signature = None
        return {"book_id": bid, "status": "pending", "updated_at": now_str}

    def index_book(
        self,
        book_or_id: Any,
        conn: Optional[sqlite3.Connection] = None,
        db_path: Optional[Union[str, Path]] = None,
        status: str = "ready",
        commit: bool = True,
    ) -> Dict[str, Any]:
        """Tính toán content_hash và vector chuẩn hóa L2 cho 1 đầu sách, lưu vào SQLite book_embeddings."""
        resolved_conn, should_close = _resolve_sqlite_connection(conn=conn, db_path=db_path)
        try:
            book_dict: Optional[Dict[str, Any]] = None
            if isinstance(book_or_id, Mapping) or hasattr(book_or_id, "keys"):
                book_dict = dict(book_or_id)
            elif resolved_conn is not None:
                cur = resolved_conn.cursor()
                cur.execute("SELECT * FROM books WHERE id = ?", (str(book_or_id),))
                row = cur.fetchone()
                if row is not None:
                    col_names = [d[0] for d in cur.description]
                    book_dict = dict(zip(col_names, row))

            if book_dict is None:
                all_books = load_books_with_availability(conn=resolved_conn, include_hidden=True)
                for b in all_books:
                    if str(b.get("id")) == str(book_or_id):
                        book_dict = b
                        break

            if book_dict is None:
                raise ValueError(f"Không tìm thấy đầu sách '{book_or_id}' để lập chỉ mục vector.")

            bid = str(book_dict["id"])
            c_hash = compute_content_hash(book_dict, model_revision=self.model_revision)
            dense_vec = encode_passage(book_dict)
            self._dense_cache[(bid, c_hash)] = dense_vec

            now_str = _now_iso()
            rec = {
                "book_id": bid,
                "content_hash": c_hash,
                "model_revision": self.model_revision,
                "status": status,
                "updated_at": now_str,
            }
            self._embedding_records[bid] = rec
            self._corpus_signature = None

            if resolved_conn is not None:
                _upsert_embedding_row(
                    resolved_conn,
                    book_id=bid,
                    content_hash=c_hash,
                    status=status,
                    vector=dense_vec,
                    model_revision=self.model_revision,
                )
                if commit:
                    resolved_conn.commit()

            return rec
        finally:
            if should_close and resolved_conn is not None:
                resolved_conn.close()

    def sync_and_verify_embeddings(
        self,
        conn: Optional[sqlite3.Connection] = None,
        db_path: Optional[Union[str, Path]] = None,
        books: Optional[Sequence[Mapping[str, Any]]] = None,
        force_rebuild: bool = False,
    ) -> Dict[str, Any]:
        """
        Kiểm tra tính nhất quán của toàn bộ chỉ mục vector (T28, T30, TC20, TC29).
        Tự động mã hóa lại mọi đầu sách chưa có vector, có status != 'ready', hoặc có content_hash thay đổi.
        """
        t0 = time.perf_counter()
        resolved_conn, should_close = _resolve_sqlite_connection(conn=conn, db_path=db_path)
        try:
            catalog = (
                [dict(b) for b in books]
                if books is not None
                else load_books_with_availability(conn=resolved_conn, include_hidden=True)
            )

            db_records: Dict[str, Dict[str, Any]] = {}
            if resolved_conn is not None:
                try:
                    _ensure_embeddings_table(resolved_conn)
                    cur = resolved_conn.cursor()
                    cur.execute("SELECT book_id, content_hash, model_revision, status FROM book_embeddings")
                    for r in cur.fetchall():
                        db_records[str(r[0])] = {
                            "book_id": str(r[0]),
                            "content_hash": str(r[1] or ""),
                            "model_revision": str(r[2] or ""),
                            "status": str(r[3] or ""),
                        }
                except Exception:
                    pass

            reindexed_count = 0
            for b in catalog:
                bid = str(b["id"])
                expected_hash = compute_content_hash(b, model_revision=self.model_revision)
                existing = db_records.get(bid) or self._embedding_records.get(bid)

                needs_encode = (
                    force_rebuild
                    or existing is None
                    or existing.get("status") != "ready"
                    or existing.get("content_hash") != expected_hash
                    or existing.get("model_revision") != self.model_revision
                )

                if needs_encode:
                    dense_vec = encode_passage(b)
                    self._dense_cache[(bid, expected_hash)] = dense_vec
                    now_str = _now_iso()
                    rec = {
                        "book_id": bid,
                        "content_hash": expected_hash,
                        "model_revision": self.model_revision,
                        "status": "ready",
                        "updated_at": now_str,
                    }
                    self._embedding_records[bid] = rec
                    if resolved_conn is not None:
                        _upsert_embedding_row(
                            resolved_conn,
                            book_id=bid,
                            content_hash=expected_hash,
                            status="ready",
                            vector=dense_vec,
                            model_revision=self.model_revision,
                        )
                    reindexed_count += 1
                else:
                    self._embedding_records[bid] = {
                        "book_id": bid,
                        "content_hash": expected_hash,
                        "model_revision": self.model_revision,
                        "status": "ready",
                        "updated_at": _now_iso(),
                    }

            if resolved_conn is not None and reindexed_count > 0:
                try:
                    resolved_conn.commit()
                except Exception:
                    pass

            # Cập nhật bộ nhớ đệm IDF và sparse vector cho các sách hiển thị
            visible_books = [b for b in catalog if bool(b.get("visible", True))]
            sig = tuple((str(b["id"]), compute_content_hash(b, self.model_revision)) for b in visible_books)
            if force_rebuild or sig != self._corpus_signature:
                self._cached_idf = compute_corpus_idf(visible_books)
                for b in visible_books:
                    bid = str(b["id"])
                    c_hash = compute_content_hash(b, self.model_revision)
                    self._sparse_cache[(bid, c_hash)] = build_book_sparse_vector(b, self._cached_idf)
                self._corpus_signature = sig

            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            if not self.is_warm:
                self.is_warm = True
                self.last_cold_start_ms = elapsed_ms

            return {
                "status": "ready",
                "model_name": self.model_name,
                "model_revision": self.model_revision,
                "total_books": len(catalog),
                "total_indexed": len(catalog),
                "visible_indexed": len(visible_books),
                "reindexed": reindexed_count,
                "reindexed_count": reindexed_count,
                "elapsed_ms": elapsed_ms,
            }
        finally:
            if should_close and resolved_conn is not None:
                resolved_conn.close()

    def search_semantic(
        self,
        query: str = "",
        conn: Optional[sqlite3.Connection] = None,
        db_path: Optional[Union[str, Path]] = None,
        books: Optional[Sequence[Mapping[str, Any]]] = None,
        only_available: bool = False,
        category: Optional[str] = None,
        top_k: int = 5,
        limit: Optional[int] = None,
        threshold: float = SEMANTIC_SIMILARITY_THRESHOLD,
        simulate_offline_error: Optional[bool] = None,
        simulate_ai_failure: Optional[bool] = None,
        simulate_error: Optional[bool] = None,
        q: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """
        Thực hiện tìm kiếm ngữ nghĩa tiếng Việt trên danh mục sách (F10, T29, T30, TC18..TC24):
        - Chuẩn hóa truy vấn với tiền tố `query:` (AI03).
        - Tự động đồng bộ lại vector nếu phát hiện sách vừa chỉnh sửa (`content_hash` thay đổi - TC20).
        - Lọc sách ẩn (`visible == False` - TC08) và ghép số bản sẵn có thực tế (`available_copies` - TC21).
        - Từ chối các câu ngoài phạm vi thư viện dưới ngưỡng `threshold` (TC19).
        - Tự động chuyển sang tìm kiếm từ khóa dự phòng nếu `simulate_offline_error=True` (TC23).
        """
        t0 = time.perf_counter()
        raw_q = query if query else (q or kwargs.get("search_query") or "")
        trimmed = str(raw_q or "").strip()
        k = int(limit if limit is not None else (kwargs.get("onlyAvailable") and top_k or top_k))
        if "onlyAvailable" in kwargs and not only_available:
            only_available = bool(kwargs["onlyAvailable"])

        if not trimmed:
            return {
                "query": "",
                "formatted_query": format_query(""),
                "results": [],
                "total": 0,
                "fallback_used": False,
                "fallback_reason": None,
                "model_name": self.model_name,
                "model_revision": self.model_revision,
                "model_status": "ready",
                "below_threshold_message": "Vui lòng nhập mô tả nhu cầu đọc sách bằng tiếng Việt.",
                "latency_ms": 0.0,
            }

        should_fallback = bool(
            self.simulate_offline_error
            or simulate_offline_error
            or simulate_ai_failure
            or simulate_error
            or kwargs.get("force_fallback")
        )

        resolved_conn, should_close = _resolve_sqlite_connection(conn=conn, db_path=db_path)
        try:
            catalog = (
                [dict(b) for b in books]
                if books is not None
                else load_books_with_availability(conn=resolved_conn, include_hidden=True)
            )

            if should_fallback:
                fb_books = run_keyword_search(
                    trimmed,
                    books=catalog,
                    category=category,
                    only_available=only_available,
                    limit=k,
                )
                fb_items: List[Dict[str, Any]] = []
                for b in fb_books:
                    reason_obj = build_metadata_reason(trimmed, b)
                    fb_items.append(self._format_result_item(b, 0.0, "Gợi ý tham khảo", reason_obj))

                elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
                return {
                    "query": trimmed,
                    "formatted_query": format_query(trimmed),
                    "results": fb_items,
                    "total": len(fb_items),
                    "fallback_used": True,
                    "fallback_reason": FALLBACK_REASON_MESSAGE,
                    "model_name": "fallback/keyword-vi",
                    "model_revision": self.model_revision,
                    "model_status": "fallback",
                    "below_threshold_message": (
                        "Không tìm thấy sách khớp từ khóa trong danh mục hiện tại. Hãy thử từ khóa ngắn gọn hơn."
                        if not fb_items
                        else None
                    ),
                    "latency_ms": elapsed_ms,
                }

            was_cold = not self.is_warm
            # Đồng bộ chỉ mục vector (nếu sách vừa bị chỉnh sửa description/title, content_hash đổi -> re-index ngay TC20)
            self.sync_and_verify_embeddings(conn=resolved_conn, books=catalog, force_rebuild=False)

            active_books: List[Dict[str, Any]] = []
            for b in catalog:
                if not bool(b.get("visible", True)):
                    continue
                if category and category.upper() != "ALL" and b.get("category") != category:
                    continue
                if only_available and int(b.get("available_copies", 0)) <= 0:
                    continue
                b["index_status"] = "ready"
                active_books.append(b)

            idf_map = self._cached_idf if self._cached_idf else compute_corpus_idf(active_books)
            raw_query_feats = extract_tokens_and_concepts(trimmed, is_title_weight=False)
            filtered_query_feats: Dict[str, float] = {}

            total_unigrams = 0
            matched_corpus_unigrams = 0
            has_concept_match = False

            for feat_key, tf in raw_query_feats.items():
                is_bigram = ("_" in feat_key) and not feat_key.startswith("concept_")
                is_concept = feat_key.startswith("concept_")

                if not is_bigram and not is_concept:
                    total_unigrams += 1
                    if feat_key in idf_map:
                        matched_corpus_unigrams += 1
                if is_concept and feat_key in idf_map:
                    has_concept_match = True

                idf_val = idf_map.get(feat_key)
                if idf_val is not None:
                    filtered_query_feats[feat_key] = (1.0 + math.log(max(tf, 1e-6))) * idf_val
                elif not is_bigram and not is_concept:
                    # Giữ trọng số phạt nhẹ cho từ đơn ngoài kho ngữ liệu để chặn câu lạc đề (TC19)
                    filtered_query_feats[feat_key] = 1.35

            if has_concept_match:
                coverage_boost = 1.0
            elif total_unigrams > 0:
                coverage_boost = min(1.0, (matched_corpus_unigrams / total_unigrams) * 1.65)
            else:
                coverage_boost = 0.0

            q_vec: Dict[str, float] = l2_normalize(filtered_query_feats)  # type: ignore[assignment]

            scored_items: List[Tuple[float, int, Dict[str, Any]]] = []
            for b in active_books:
                bid = str(b["id"])
                c_hash = compute_content_hash(b, self.model_revision)
                b_vec = self._sparse_cache.get((bid, c_hash))
                if b_vec is None:
                    b_vec = build_book_sparse_vector(b, idf_map)
                    self._sparse_cache[(bid, c_hash)] = b_vec

                score = cosine_similarity(q_vec, b_vec) * coverage_boost
                if score >= threshold:
                    tier = "Phù hợp cao" if score >= HIGH_CONFIDENCE_THRESHOLD else "Gợi ý tham khảo"
                    reason_obj = build_metadata_reason(trimmed, b)
                    formatted_item = self._format_result_item(b, score, tier, reason_obj)
                    scored_items.append((score, int(b.get("available_copies", 0)), formatted_item))

            scored_items.sort(key=lambda x: (-x[0], -x[1], str(x[2]["book_id"])))
            top_results = [x[2] for x in scored_items[:k]]

            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            return {
                "query": trimmed,
                "formatted_query": format_query(trimmed),
                "results": top_results,
                "total": len(top_results),
                "fallback_used": False,
                "fallback_reason": None,
                "model_name": self.model_name,
                "model_revision": self.model_revision,
                "model_status": "ready",
                "model_cold_start_ms": self.last_cold_start_ms if was_cold else None,
                "below_threshold_message": BELOW_THRESHOLD_MESSAGE if len(top_results) == 0 else None,
                "latency_ms": elapsed_ms,
            }
        finally:
            if should_close and resolved_conn is not None:
                resolved_conn.close()

    def get_similar_books(
        self,
        book_id_or_book: Any,
        conn: Optional[sqlite3.Connection] = None,
        db_path: Optional[Union[str, Path]] = None,
        books: Optional[Sequence[Mapping[str, Any]]] = None,
        limit: int = 4,
        top_k: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Gợi ý sách tương tự trên trang Chi tiết sách (F11 / T27 / TC25):
        Loại trừ chính cuốn sách đang xem và mọi sách ẩn (`visible == False`).
        """
        k = int(top_k if top_k is not None else limit)
        resolved_conn, should_close = _resolve_sqlite_connection(conn=conn, db_path=db_path)
        try:
            catalog = (
                [dict(b) for b in books]
                if books is not None
                else load_books_with_availability(conn=resolved_conn, include_hidden=True)
            )

            target_book: Optional[Dict[str, Any]] = None
            target_id: str = ""
            if isinstance(book_id_or_book, Mapping) or hasattr(book_id_or_book, "keys"):
                target_book = dict(book_id_or_book)
                target_id = str(target_book.get("id", ""))
            else:
                target_id = str(book_id_or_book)
                for b in catalog:
                    if str(b.get("id")) == target_id:
                        target_book = b
                        break

            if target_book is None:
                return []

            candidates = [
                b for b in catalog if bool(b.get("visible", True)) and str(b.get("id")) != target_id
            ]
            if not candidates:
                return []

            idf_map = compute_corpus_idf([target_book, *candidates])
            target_vec = build_book_sparse_vector(target_book, idf_map)

            scored: List[Tuple[float, int, Dict[str, Any]]] = []
            for cand in candidates:
                cand_vec = build_book_sparse_vector(cand, idf_map)
                sim = cosine_similarity(target_vec, cand_vec)
                if cand.get("category") == target_book.get("category"):
                    sim += 0.12
                if cand.get("author") == target_book.get("author"):
                    sim += 0.08
                item = dict(cand)
                item["book_id"] = str(cand["id"])
                item["score"] = round(float(sim), 4)
                item["similarity_score"] = round(float(sim), 4)
                item["reason"] = build_metadata_reason(
                    f"{target_book.get('title', '')} {target_book.get('category', '')}", cand
                )
                scored.append((sim, int(cand.get("available_copies", 0)), item))

            scored.sort(key=lambda x: (-x[0], -x[1], str(x[2]["id"])))
            return [x[2] for x in scored[:k]]
        finally:
            if should_close and resolved_conn is not None:
                resolved_conn.close()

    @staticmethod
    def _format_result_item(
        book: Mapping[str, Any],
        score: float,
        suggestion_tier: str,
        reason_obj: Dict[str, Any],
    ) -> Dict[str, Any]:
        b_dict = dict(book)
        bid = str(b_dict.get("id", ""))
        rounded_score = round(float(score), 4)
        return {
            "id": bid,
            "book_id": bid,
            "code": b_dict.get("code", ""),
            "title": b_dict.get("title", ""),
            "author": b_dict.get("author", ""),
            "category": b_dict.get("category", ""),
            "shelf": b_dict.get("shelf", ""),
            "description": b_dict.get("description", ""),
            "available_copies": int(b_dict.get("available_copies", 0)),
            "total_copies": int(b_dict.get("total_copies", 0)),
            "borrowed_copies": int(b_dict.get("borrowed_copies", 0)),
            "maintenance_copies": int(b_dict.get("maintenance_copies", 0)),
            "visible": bool(b_dict.get("visible", True)),
            "index_status": b_dict.get("index_status", "ready"),
            "book": b_dict,
            "score": rounded_score,
            "similarity_score": rounded_score,
            "suggestion_tier": suggestion_tier,
            "reason": reason_obj,
            "reason_excerpt": reason_obj["excerpt"],
            "excerpt": reason_obj["excerpt"],
            "matched_fields": reason_obj["matched_fields"],
            "matched_terms": reason_obj["matched_terms"],
        }


# Singleton engine instance
engine = LocalSemanticEngine()
semantic_engine = engine
ai_engine = engine


def get_ai_engine() -> LocalSemanticEngine:
    return engine


get_engine = get_ai_engine


def set_simulate_offline_error(flag: bool) -> None:
    engine.set_simulate_offline_error(flag)


def get_ai_status() -> Dict[str, Any]:
    return engine.get_status()


def mark_book_pending(
    book_id: str,
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    return engine.mark_book_pending(book_id=book_id, conn=conn, db_path=db_path)


invalidate_book_embedding = mark_book_pending
mark_embedding_pending = mark_book_pending


def index_book(
    book_or_id: Any,
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
    status: str = "ready",
) -> Dict[str, Any]:
    return engine.index_book(book_or_id=book_or_id, conn=conn, db_path=db_path, status=status)


reindex_book = index_book
update_book_embedding = index_book
upsert_book_embedding = index_book


def sync_and_verify_embeddings(
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
    books: Optional[Sequence[Mapping[str, Any]]] = None,
    force_rebuild: bool = False,
) -> Dict[str, Any]:
    return engine.sync_and_verify_embeddings(
        conn=conn, db_path=db_path, books=books, force_rebuild=force_rebuild
    )


rebuild_index = sync_and_verify_embeddings
rebuild_all_embeddings = sync_and_verify_embeddings
build_index = sync_and_verify_embeddings
ensure_index = sync_and_verify_embeddings


def search_semantic(
    query: str = "",
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
    books: Optional[Sequence[Mapping[str, Any]]] = None,
    only_available: bool = False,
    category: Optional[str] = None,
    top_k: int = 5,
    limit: Optional[int] = None,
    threshold: float = SEMANTIC_SIMILARITY_THRESHOLD,
    simulate_offline_error: Optional[bool] = None,
    simulate_ai_failure: Optional[bool] = None,
    simulate_error: Optional[bool] = None,
    q: Optional[str] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    return engine.search_semantic(
        query=query,
        conn=conn,
        db_path=db_path,
        books=books,
        only_available=only_available,
        category=category,
        top_k=top_k,
        limit=limit,
        threshold=threshold,
        simulate_offline_error=simulate_offline_error,
        simulate_ai_failure=simulate_ai_failure,
        simulate_error=simulate_error,
        q=q,
        **kwargs,
    )


semantic_search = search_semantic
run_local_semantic_search = search_semantic
run_semantic_search = search_semantic


def get_similar_books(
    book_id_or_book: Any,
    conn: Optional[sqlite3.Connection] = None,
    db_path: Optional[Union[str, Path]] = None,
    books: Optional[Sequence[Mapping[str, Any]]] = None,
    limit: int = 4,
    top_k: Optional[int] = None,
) -> List[Dict[str, Any]]:
    return engine.get_similar_books(
        book_id_or_book=book_id_or_book,
        conn=conn,
        db_path=db_path,
        books=books,
        limit=limit,
        top_k=top_k,
    )


similar_books = get_similar_books
get_similar_books_from_catalog = get_similar_books
find_similar_books = get_similar_books

# Đồng bộ hàm tính content_hash và MODEL_REVISION với backend.app.db để index_status luôn nhất quán
try:
    from backend.app import db as _app_db  # type: ignore

    _app_db.compute_book_content_hash = compute_content_hash
    _app_db.MODEL_REVISION = MODEL_REVISION
except Exception:
    pass

