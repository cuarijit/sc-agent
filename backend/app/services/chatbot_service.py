from __future__ import annotations

import json
import re
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict
from urllib import error as urllib_error
from urllib import request as urllib_request

from langgraph.graph import END, START, StateGraph
from sqlalchemy.orm import Session

from ..database import DATABASE_URL
from ..models import ChatbotFeedback
from .llm_service import resolve_llm_selection
from .rag_service import retrieve_policy_context

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
CHAT_SESSION_LIMIT = 32
MAX_ROWS = 2000
OUT_OF_SCOPE_MESSAGE = "I can only help with questions about the Inventory Planning and Optimization database."

BANNED_SQL_TOKENS = {
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "create",
    "replace",
    "truncate",
    "pragma",
    "attach",
    "detach",
    "vacuum",
    "reindex",
}

TEXT_MATCH_COLUMNS = {
    "severity",
    "alert_type",
    "status",
    "exception_reason",
    "order_type",
    "region",
    "supplier",
    "category",
    "node_type",
    "source_mode",
    "issue_type",
}


@dataclass
class ChatSessionState:
    conversation_id: str
    history: list[dict[str, str]]
    last_sql: str | None = None
    sql_history: list[str | None] = field(default_factory=list)


CHAT_SESSIONS: dict[str, ChatSessionState] = {}


class ChatbotFlowState(TypedDict, total=False):
    message: str
    conversation_id: str | None
    assistant_mode: str | None
    llm_provider: str | None
    llm_model: str | None
    openai_api_key: str | None
    context_cursor: int | None
    selected_provider: str
    selected_model: str
    api_key: str
    session_state: ChatSessionState
    response: dict[str, Any]
    short_circuit: bool


class ChatbotResponseFlowState(TypedDict, total=False):
    question: str
    session_state: ChatSessionState
    selected_provider: str
    selected_model: str
    api_key: str
    intent: str
    warnings: list[str]
    llm_invoked: bool
    schema: dict[str, list[str]]
    schema_hint_text: str
    prompt_used: str | None
    sql: str
    columns: list[str]
    rows: list[dict[str, Any]]
    answer: str
    follow_up: list[str]
    apply_filters: dict[str, list[str]]
    apply_candidates: list[dict[str, str]]
    can_apply: bool
    confidence_score: float | None
    reasoning_summary: str | None
    response: dict[str, Any]
    short_circuit: bool


def _parse_sqlite_path() -> Path | None:
    if not DATABASE_URL.startswith("sqlite:///"):
        return None
    raw = DATABASE_URL.replace("sqlite:///", "", 1)
    if raw.startswith("/") and len(raw) >= 3 and raw[2] == ":":
        raw = raw[1:]
    if not raw:
        return None
    return Path(raw)


def _read_only_connect() -> sqlite3.Connection:
    db_path = _parse_sqlite_path()
    if db_path is None:
        raise RuntimeError("Only sqlite databases are supported for chatbot SQL mode.")
    uri = f"file:{db_path.as_posix()}?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=3)


def _sqlite_schema() -> dict[str, list[str]]:
    schema: dict[str, list[str]] = {}
    with _read_only_connect() as conn:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for (table_name,) in tables:
            escaped_table_name = table_name.replace('"', '""')
            cols = conn.execute(f'PRAGMA table_info("{escaped_table_name}")').fetchall()
            schema[table_name] = [str(col[1]) for col in cols if len(col) > 1]
    return schema


def _normalize_sql(sql: str) -> str:
    cleaned = sql.strip().strip("`")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned.rstrip(";")


def _enforce_case_insensitive_text_matching(sql: str) -> tuple[str, bool]:
    """
    Rewrites text equality predicates into case-insensitive contains matching:
    <col> = 'value'  ->  LOWER(COALESCE(<col>, '')) LIKE '%value%'
    """
    changed = False
    canonical_text_columns = {_canonical_col(item) for item in TEXT_MATCH_COLUMNS}
    additional_casefold_columns = {
        "alert_id",
        "recommendation_id",
        "order_id",
        "sku",
        "ship_to_node_id",
        "ship_from_node_id",
        "node_id",
    }
    pattern = re.compile(
        r"""(?P<col>(?:"[^"]+"|\b[a-zA-Z_][a-zA-Z0-9_]*\b)(?:\.(?:"[^"]+"|\b[a-zA-Z_][a-zA-Z0-9_]*\b))?)\s*=\s*'(?P<val>[^']*)'""",
        re.IGNORECASE,
    )

    def _canonical_col_from_expr(col_expr: str) -> str:
        last = col_expr.split(".")[-1].strip()
        if last.startswith('"') and last.endswith('"') and len(last) >= 2:
            last = last[1:-1]
        return _canonical_col(last)

    def _should_casefold_expr(col_expr: str) -> bool:
        canonical = _canonical_col_from_expr(col_expr)
        return canonical in canonical_text_columns or canonical in additional_casefold_columns

    def _replace(match: re.Match[str]) -> str:
        nonlocal changed
        col_expr = match.group("col")
        val = (match.group("val") or "").strip().lower()
        if not _should_casefold_expr(col_expr):
            return match.group(0)
        changed = True
        safe_val = val.replace("'", "''")
        return f"LOWER(COALESCE({col_expr}, '')) LIKE '%{safe_val}%'"

    rewritten = pattern.sub(_replace, sql)

    # Ensure case-insensitive matching on both sides of IN (SELECT ...) text comparisons.
    # Example:
    # LOWER(COALESCE(ro.alert_id, '')) IN (SELECT alert_id FROM network_alerts ...)
    # -> LOWER(COALESCE(ro.alert_id, '')) IN (SELECT LOWER(COALESCE(alert_id, '')) FROM network_alerts ...)
    in_subquery_pattern = re.compile(
        r"""(?P<lhs>LOWER\s*\(\s*COALESCE\s*\(\s*(?P<left_expr>(?:"[^"]+"|\b[a-zA-Z_][a-zA-Z0-9_]*\b)(?:\.(?:"[^"]+"|\b[a-zA-Z_][a-zA-Z0-9_]*\b))?)\s*,\s*''\s*\)\s*\))\s+IN\s*\(\s*SELECT\s+(?P<right_expr>(?:"[^"]+"|\b[a-zA-Z_][a-zA-Z0-9_]*\b)(?:\.(?:"[^"]+"|\b[a-zA-Z_][a-zA-Z0-9_]*\b))?)\s+FROM\s+(?P<tail>[^)]*)\)""",
        re.IGNORECASE,
    )

    def _replace_in_subquery(match: re.Match[str]) -> str:
        nonlocal changed
        left_expr = match.group("left_expr")
        right_expr = match.group("right_expr")
        if not (_should_casefold_expr(left_expr) or _should_casefold_expr(right_expr)):
            return match.group(0)
        changed = True
        lhs = match.group("lhs")
        tail = match.group("tail")
        return f"{lhs} IN (SELECT LOWER(COALESCE({right_expr}, '')) FROM {tail})"

    rewritten = in_subquery_pattern.sub(_replace_in_subquery, rewritten)
    return rewritten, changed


def _is_safe_select_sql(sql: str) -> tuple[bool, str | None]:
    if not sql:
        return False, "SQL was empty."
    lowered = sql.lower()
    if ";" in lowered:
        return False, "Multiple SQL statements are not allowed."
    if not (lowered.startswith("select") or lowered.startswith("with")):
        return False, "Only SELECT queries are allowed."
    if re.search(r"\bselect\s+\*", lowered):
        return False, "SELECT * is not allowed. Select only required columns."
    for token in BANNED_SQL_TOKENS:
        if re.search(rf"\b{re.escape(token)}\b", lowered):
            return False, f"Blocked SQL token: {token}."
    return True, None


def _with_limit(sql: str, row_limit: int = MAX_ROWS) -> str:
    lowered = sql.lower()
    if " limit " in lowered:
        return sql
    return f"{sql} LIMIT {row_limit}"


def _is_aggregate_query(sql: str) -> bool:
    lowered = sql.lower()
    return bool(
        re.search(r"\b(count|sum|avg|min|max)\s*\(", lowered)
        or re.search(r"\bgroup\s+by\b", lowered)
    )


def _is_out_of_scope_question(question: str) -> bool:
    text = question.lower().strip()
    if not text:
        return True
    db_signals = (
        "sku",
        "location",
        "order",
        "inventory",
        "forecast",
        "supplier",
        "node",
        "network",
        "exception",
        "recommendation",
        "parameter",
        "table",
        "column",
        "database",
        "nif",
        "sql",
        "count",
        "list",
        "show",
    )
    out_of_scope_signals = (
        "joke",
        "poem",
        "story",
        "weather",
        "news",
        "movie",
        "song",
        "translate",
        "email",
        "resume",
        "who are you",
        "hello",
        "hi ",
    )
    if any(signal in text for signal in db_signals):
        return False
    return any(signal in text for signal in out_of_scope_signals)


def _trim_text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _canonical_col(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _extract_apply_candidates(columns: list[str], rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    if not columns or not rows:
        return []
    by_canonical = {_canonical_col(column): column for column in columns}

    sku_key = None
    for candidate in ("sku", "productid", "productsku"):
        if candidate in by_canonical:
            sku_key = by_canonical[candidate]
            break

    location_key = None
    for candidate in ("location", "node", "shiptonodeid", "shipto", "locationcode"):
        if candidate in by_canonical:
            location_key = by_canonical[candidate]
            break

    if not sku_key or not location_key:
        return []

    unique: set[tuple[str, str]] = set()
    for row in rows:
        sku = _trim_text(row.get(sku_key))
        location = _trim_text(row.get(location_key))
        if not sku or not location:
            continue
        unique.add((sku, location))

    return [{"sku": sku, "location": location} for sku, location in sorted(unique)]


def _extract_apply_filters(columns: list[str], rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    if not columns or not rows:
        return {}
    by_canonical = {_canonical_col(column): column for column in columns}
    field_map: dict[str, tuple[str, bool]] = {
        "sku": ("sku", True),
        "productid": ("sku", True),
        "productsku": ("sku", True),
        "location": ("location", True),
        "node": ("location", True),
        "shiptonodeid": ("shipToNodeId", True),
        "shipfromnodeid": ("shipFromNodeId", True),
        "region": ("region", False),
        "category": ("category", False),
        "supplier": ("supplier", False),
        "runid": ("runId", False),
        "run_id": ("runId", False),
        "alertid": ("alertId", True),
        "alerttype": ("alertType", True),
        "severity": ("severity", True),
        "orderid": ("orderId", True),
        "ordertype": ("orderType", True),
        "status": ("orderStatus", True),
        "exceptionstatus": ("exceptionStatus", False),
        "exceptionreason": ("exceptionReason", True),
        "parametercode": ("parameterCode", True),
        "issuetype": ("parameterIssueType", True),
        "sourcemode": ("sourceMode", True),
        "nodetype": ("nodeType", True),
    }
    extracted: dict[str, set[str]] = {}
    for canonical_col, raw_col in by_canonical.items():
        mapped = field_map.get(canonical_col)
        if not mapped:
            continue
        key, _is_multi = mapped
        values = extracted.setdefault(key, set())
        for row in rows:
            value = _trim_text(row.get(raw_col))
            if value:
                values.add(value)
    return {key: sorted(values) for key, values in extracted.items() if values}


def _fallback_sql_for_question(question: str) -> str:
    text = question.lower()
    if "order" in text and "exception" in text:
        return (
            "SELECT o.alert_id AS alert_id, o.order_id, d.sku, d.ship_to_node_id AS location, o.status, o.exception_reason, "
            "d.order_qty "
            "FROM replenishment_orders o "
            "JOIN replenishment_order_details d ON d.order_id = o.order_id "
            "WHERE o.is_exception = 1 "
            "ORDER BY o.created_at DESC"
        )
    if "order" in text:
        return (
            "SELECT o.alert_id AS alert_id, o.order_id, d.sku, d.ship_to_node_id AS location, d.ship_from_node_id, d.order_qty, "
            "o.status, o.order_type "
            "FROM replenishment_orders o "
            "JOIN replenishment_order_details d ON d.order_id = o.order_id "
            "ORDER BY o.created_at DESC"
        )
    if "projection" in text or "inventory" in text:
        return (
            "SELECT product_id AS sku, location_code AS location, week_start_date, "
            "SUM(quantity) AS quantity "
            "FROM inventory_ledger GROUP BY product_id, location_code, week_start_date "
            "ORDER BY week_start_date DESC"
        )
    return "SELECT sku, location, parameter_code, effective_value FROM parameter_values ORDER BY sku, location"


def _follow_up_question_with_sql_context(question: str, last_sql: str | None) -> str:
    if not last_sql:
        return question
    return (
        "FOLLOW-UP MODE: The user is asking a follow-up question. "
        "You MUST refine/derive from the previous SQL context and keep prior scope/filters unless user explicitly changes them. "
        "Do not invent a fresh unrelated WHERE clause. "
        "If user asks for aggregation (sum/count/avg/etc), aggregate over the prior result scope.\n\n"
        f"Previous SQL:\n{last_sql}\n\n"
        f"Follow-up user request:\n{question}"
    )


def _schema_hint(schema: dict[str, list[str]]) -> str:
    if not schema:
        return (
            "Use only existing SQLite tables and columns from this app database. "
            "Return a single SELECT SQL statement only. Never use SELECT *. "
            "If LIMIT is needed, use LIMIT 2000 by default unless user asks for fewer rows."
        )
    table_descriptions: list[str] = []
    for table, columns in schema.items():
        if columns:
            table_descriptions.append(f"{table}({', '.join(columns)})")
        else:
            table_descriptions.append(table)
    return (
        "Use ONLY these tables and columns. Do not invent identifiers. "
        + " | ".join(table_descriptions)
        + " Return exactly one SELECT/CTE SQL statement. Never use SELECT *. "
        + "For list/detail outputs, include alert_id and recommendation_id columns whenever applicable and present in schema. "
        + "If LIMIT is needed, use LIMIT 2000 by default unless user explicitly asks for fewer rows. "
        + "For list/detail outputs (non-aggregate), include the Link column when present in schema. "
        + "Column alias alignment for filter apply (mandatory where applicable): use aliases matching global-filter names in SQL output columns "
        + "such as sku, location, alert_id, alert_type, severity, order_id, order_type, status, exception_reason, "
        + "ship_from_node_id, ship_to_node_id, parameter_code, issue_type, source_mode, node_type, run_id, region, category, supplier, exception_status. "
        + "Superlative intent rule: if user asks for most/top/highest/lowest/least/bottom/maximum/minimum/biggest/smallest, "
        + "you MUST use ORDER BY on the relevant metric and apply LIMIT. "
        + "Use DESC for most/top/highest/maximum/biggest; use ASC for least/lowest/bottom/minimum/smallest. "
        + "Use LIMIT 1 for singular asks and LIMIT N for top N/bottom N asks. "
        + "If no rows, do one broader rewrite attempt only; then return no matching records found. "
        + "Text match guidance: for text comparisons in WHERE, use wildcard contains LIKE '%value%'. "
        + "For case-insensitive search use LOWER(COALESCE(<col>, '')) LIKE '%value%'. "
        + "For categorical/text filters (including severity, alert_type, status, exception_reason, order_type, region), "
        + "ALWAYS use LOWER(COALESCE(<col>, '')) LIKE '%value%' and NEVER use equality (=) for text matching. "
        + "For description search, check both \"Brief Material Description\" and \"Material_Description\" when those columns exist. "
        + "Disambiguation rule (mandatory): phrases like created by month/year refer to date column \"Created\" and "
        + "date grouping (strftime), not person column \"Created_By\". "
        + "Use \"Created_By\" only when prompt clearly asks for creator/requestor identity. "
        + "Date comparison guidance: reference date for relative comparisons is 2026-03-02. "
        + "Use half-open intervals [start, end) to avoid overlap. "
        + "Interpret last/next month|quarter|year|week as complete periods. "
        + "Interpret past/future N units as rolling windows relative to the reference date. "
        + "SQLite date filter form: date(<date_col>) >= date('YYYY-MM-DD') AND date(<date_col>) < date('YYYY-MM-DD'). "
        + "For quarter/month/year grouping use strftime('%Y', ...), strftime('%m', ...), and month arithmetic. "
        + "For count by month and year use: strftime('%Y', date(\"Created\")) AS year, "
        + "strftime('%m', date(\"Created\")) AS month, COUNT(*) AS nif_count, then GROUP BY year, month and ORDER BY year, month. "
        + "If question has no clear date expression, avoid assuming date filters. "
        + "Support date range filters for past/future, multiple months/quarters/years, and numeric spans (for example: last 2 years, next 2 quarters). "
        + "Arithmetic and function guidance: arithmetic operators allowed +, -, *, /. "
        + "Arithmetic on table columns must use numeric columns only. "
        + "HAVING and WHERE may compare arithmetic expressions if source columns follow numeric/date rules. "
        + "Do not invent derived expressions when required source columns are missing. "
        + "If requested expression cannot be mapped confidently to schema columns, return empty SQL with low confidence. "
        + "Allowed SQLite functions only: ABS, AVG, CAST, COALESCE, COUNT, DATE, DATETIME, JULIANDAY, LOWER, MAX, MIN, NULLIF, ROUND, STRFTIME, SUM, TIME, UPPER. "
        + "GROUP BY sort default (mandatory): queries with GROUP BY must include ORDER BY. "
        + "Default ORDER BY direction must be DESC unless user explicitly asks for ascending/increasing/oldest/lowest-first ordering. "
        + "For time-grouped outputs (month/year), default latest periods first (ORDER BY year DESC, month DESC) unless prompt says otherwise. "
        + "Allowed date-shift units: day, week, month, quarter, year; quarter shift = 3 months. "
        + "SQLite date-shift forms: date(<date_col>, '+N day|month|year'); week => '+(7*N) day'; quarter => '+(3*N) month'. "
        + "WHERE/HAVING compare form: date(<date_col>, '+N month') >= date('YYYY-MM-DD'). "
        + "Date grouping form: strftime('%Y', <date_col>), strftime('%m', <date_col>). "
        + "For grouped who has the most/least/lowest/bottom questions: GROUP BY entity column, ORDER BY aggregate by intent, then LIMIT 1 (or N). "
        + "For out-of-scope questions, respond exactly: "
        + f"\"{OUT_OF_SCOPE_MESSAGE}\""
    )


def _latency_scope_guidance() -> str:
    return (
        "Scope: Only handle questions answerable from this Inventory Planning and Optimization database. "
        "LATENCY MODE (MANDATORY): Do not greet. "
        "For in-scope database questions, first action must be exactly one call to asc.db. "
        "Do not ask clarifying questions before first query unless impossible to map to schema. "
        "Never SELECT *; select only required columns. "
        "If LIMIT is needed, use LIMIT 2000 by default unless user explicitly asks for fewer rows. "
        "If no rows, do one broader rewrite attempt only; then return no matching records found. "
        "Final user answer: max 10 lines, no SQL, no internal reasoning, no repeated rows, and no fabricated values. "
        "Do not claim display limits unless tool output explicitly says results were truncated. "
        "Text matching, disambiguation, arithmetic, date, superlative, and grouping rules are mandatory."
    )


def _build_prompt_used_text(schema_hint_text: str) -> str:
    return (
        "You generate safe read-only SQLite SQL.\n"
        "Output ONLY SQL. One statement. Use SELECT or WITH. No markdown fences.\n"
        f"{schema_hint_text}\n"
        f"{_latency_scope_guidance()}"
    )


def _validate_sql_against_db(sql: str) -> tuple[bool, str | None]:
    lowered = sql.lower()
    if re.search(r"\bsqlite_\w+\b", lowered):
        return False, "SQLite internal tables are not allowed."
    try:
        with _read_only_connect() as conn:
            conn.execute(f"EXPLAIN QUERY PLAN {sql}")
    except sqlite3.Error as exc:
        return False, f"SQL does not match current DB schema: {exc}"
    return True, None


def _extract_missing_column(schema_reason: str | None) -> str | None:
    if not schema_reason:
        return None
    match = re.search(r"no such column:\s*([A-Za-z0-9_\.\"']+)", schema_reason, re.IGNORECASE)
    if not match:
        return None
    raw = match.group(1).strip().strip("'").strip('"')
    return raw.split(".")[-1].strip() if raw else None


def _schema_column_suggestions(schema: dict[str, list[str]], missing_column: str | None) -> list[str]:
    if not missing_column:
        return []
    target = _canonical_col(missing_column)
    suggestions: list[str] = []
    for table_name, cols in schema.items():
        for col in cols:
            canonical = _canonical_col(col)
            if canonical == target or target in canonical or canonical in target:
                suggestions.append(f"{table_name}.{col}")
    deduped: list[str] = []
    for item in suggestions:
        if item not in deduped:
            deduped.append(item)
    return deduped[:5]


def _extract_openai_text(body: dict[str, Any]) -> str:
    direct = _trim_text(body.get("output_text"))
    if direct:
        return direct
    chunks: list[str] = []
    for item in body.get("output", []) or []:
        for content in item.get("content", []) or []:
            text = _trim_text(content.get("text"))
            if text:
                chunks.append(text)
    return "\n".join(chunks).strip()


def _extract_anthropic_text(body: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in body.get("content", []) or []:
        if item.get("type") != "text":
            continue
        text = _trim_text(item.get("text"))
        if text:
            chunks.append(text)
    return "\n".join(chunks).strip()


def _normalize_anthropic_model(model: str) -> str:
    candidate = _trim_text(model)
    if candidate.startswith("us.anthropic."):
        candidate = candidate.split("us.anthropic.", 1)[1]
    if candidate.startswith("anthropic."):
        candidate = candidate.split("anthropic.", 1)[1]
    if candidate.endswith(":0"):
        candidate = candidate[:-2]
    candidate = re.sub(r"-v\d+$", "", candidate)
    return candidate or "claude-3-5-sonnet-20241022"


def _detect_ambiguity(question: str) -> list[str]:
    text = question.strip().lower()
    if not text:
        return ["Please ask a question about orders, inventory, exceptions, or parameters."]
    reasons: list[str] = []
    weak_prompts = {"help", "analyze", "summary", "insights", "status", "show data"}
    if text in weak_prompts or len(text.split()) <= 2:
        reasons.append("Your question is too broad.")
    if any(token in text for token in ("top", "best", "worst", "highest", "lowest")) and not any(
        metric in text for metric in ("count", "qty", "quantity", "cost", "stock", "inventory", "orders")
    ):
        reasons.append("Ranking intent is present but metric is unclear.")
    if "compare" in text and "vs" not in text and "between" not in text:
        reasons.append("Comparison target is missing.")
    return reasons


def _default_follow_up_questions(question: str, columns: list[str], rows: list[dict[str, Any]]) -> list[str]:
    lowered = question.lower()
    suggestions: list[str] = []
    if "exception" not in lowered:
        suggestions.append("Should I narrow this to exceptions only?")
    if not any(token in lowered for token in ("count", "trend", "group", "aggregate", "sum", "avg", "average")):
        suggestions.append("Do you want this aggregated by week or month?")
    if any("location" in col.lower() or "node" in col.lower() for col in columns):
        suggestions.append("Should I break this down by location/node?")
    if rows:
        suggestions.append("Do you want top 10 rows by highest quantity/cost?")
    suggestions.append("Should I apply these results to global filters?")
    return suggestions[:3]


def _reason_over_results_with_openai(
    *,
    question: str,
    sql: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    conversation_history: list[dict[str, str]],
    api_key: str,
    llm_model: str,
) -> tuple[str | None, list[str] | None, str | None, float | None, str | None]:
    preview_rows = rows[:40]
    prompt = {
        "question": question,
        "sql": sql,
        "columns": columns,
        "row_count": len(rows),
        "rows_preview": preview_rows,
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are a data analyst assistant. Use only the supplied SQL result to answer. "
                "Do not invent facts. Return JSON only with keys: "
                "answer_text (string), follow_up_questions (array of 2-4 strings), "
                "reasoning_summary (string, max 240 chars), confidence_score (number between 0 and 1)."
            ),
        },
    ]
    for item in conversation_history[-6:]:
        messages.append({"role": item.get("role", "user"), "content": item.get("content", "")})
    messages.append({"role": "user", "content": json.dumps(prompt)})
    payload = {
        "model": llm_model,
        "input": messages,
        "temperature": 0.2,
        "max_output_tokens": 450,
    }
    req = urllib_request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=18) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        return None, None, None, None, f"OpenAI result reasoning failed ({exc.code}): {message[:200]}"
    except Exception as exc:  # pragma: no cover
        return None, None, None, None, f"OpenAI result reasoning failed: {exc}"

    raw = _extract_openai_text(body)
    if not raw:
        return None, None, None, None, "OpenAI result reasoning returned empty output."
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip(), None, None, None, "OpenAI result reasoning returned non-JSON output."

    answer = _trim_text(parsed.get("answer_text"))
    followups = parsed.get("follow_up_questions")
    reasoning_summary = _trim_text(parsed.get("reasoning_summary"))
    confidence_raw = parsed.get("confidence_score")
    confidence_score: float | None = None
    try:
        if confidence_raw is not None:
            confidence_score = float(confidence_raw)
    except (TypeError, ValueError):
        confidence_score = None
    if confidence_score is not None:
        confidence_score = max(0.0, min(1.0, confidence_score))
    normalized_followups: list[str] = []
    if isinstance(followups, list):
        normalized_followups = [_trim_text(item) for item in followups if _trim_text(item)]
    if not answer:
        return None, normalized_followups or None, reasoning_summary or None, confidence_score, "OpenAI result reasoning did not provide answer_text."
    return answer, normalized_followups or None, reasoning_summary or None, confidence_score, None


def _reason_over_results_with_anthropic(
    *,
    question: str,
    sql: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    conversation_history: list[dict[str, str]],
    api_key: str,
    llm_model: str,
) -> tuple[str | None, list[str] | None, str | None, float | None, str | None]:
    preview_rows = rows[:40]
    prompt = {
        "question": question,
        "sql": sql,
        "columns": columns,
        "row_count": len(rows),
        "rows_preview": preview_rows,
    }
    history_lines: list[str] = []
    for item in conversation_history[-6:]:
        role = _trim_text(item.get("role")) or "user"
        content = _trim_text(item.get("content"))
        if content:
            history_lines.append(f"{role.upper()}: {content}")
    user_content = (
        "Conversation context:\n"
        + ("\n".join(history_lines) if history_lines else "(none)")
        + "\n\nAnalyze this SQL result and return JSON only.\n"
        + json.dumps(prompt)
    )
    payload = {
        "model": _normalize_anthropic_model(llm_model),
        "max_tokens": 450,
        "temperature": 0.2,
        "system": (
            "You are a data analyst assistant. Use only supplied SQL results and do not invent facts. "
            "Return JSON only with keys: answer_text (string), follow_up_questions (array of 2-4 strings), "
            "reasoning_summary (string, max 240 chars), confidence_score (number between 0 and 1)."
        ),
        "messages": [{"role": "user", "content": user_content}],
    }
    req = urllib_request.Request(
        ANTHROPIC_MESSAGES_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=18) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        return None, None, None, None, f"Anthropic result reasoning failed ({exc.code}): {message[:220]}"
    except Exception as exc:  # pragma: no cover
        return None, None, None, None, f"Anthropic result reasoning failed: {exc}"

    raw = _extract_anthropic_text(body)
    if not raw:
        return None, None, None, None, "Anthropic result reasoning returned empty output."
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip(), None, None, None, "Anthropic result reasoning returned non-JSON output."

    answer = _trim_text(parsed.get("answer_text"))
    followups = parsed.get("follow_up_questions")
    reasoning_summary = _trim_text(parsed.get("reasoning_summary"))
    confidence_raw = parsed.get("confidence_score")
    confidence_score: float | None = None
    try:
        if confidence_raw is not None:
            confidence_score = float(confidence_raw)
    except (TypeError, ValueError):
        confidence_score = None
    if confidence_score is not None:
        confidence_score = max(0.0, min(1.0, confidence_score))
    normalized_followups: list[str] = []
    if isinstance(followups, list):
        normalized_followups = [_trim_text(item) for item in followups if _trim_text(item)]
    if not answer:
        return None, normalized_followups or None, reasoning_summary or None, confidence_score, "Anthropic result reasoning did not provide answer_text."
    return answer, normalized_followups or None, reasoning_summary or None, confidence_score, None


def _fallback_confidence_score(*, rows: list[dict[str, Any]], warnings: list[str], llm_invoked: bool) -> float:
    score = 0.45
    if llm_invoked:
        score += 0.2
    if rows:
        score += 0.2
    if len(rows) >= 20:
        score += 0.05
    if warnings:
        score -= min(0.2, len(warnings) * 0.06)
    return max(0.1, min(0.95, score))


def _generate_sql_with_openai(
    *,
    question: str,
    conversation_history: list[dict[str, str]],
    api_key: str,
    llm_model: str,
    schema_hint_text: str,
) -> tuple[str | None, str | None]:
    latency_scope_text = _latency_scope_guidance()
    messages = [
        {"role": "system", "content": "You generate safe read-only SQLite SQL."},
        {
            "role": "system",
            "content": (
                "Output ONLY SQL. One statement. Use SELECT or WITH. "
                "No markdown fences. " + schema_hint_text
            ),
        },
        {
            "role": "system",
            "content": latency_scope_text,
        },
    ]
    for item in conversation_history[-8:]:
        messages.append({"role": item.get("role", "user"), "content": item.get("content", "")})
    messages.append({"role": "user", "content": question})

    payload = {
        "model": llm_model,
        "input": messages,
        "temperature": 0,
        "max_output_tokens": 300,
    }
    req = urllib_request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        return None, f"OpenAI request failed ({exc.code}): {message[:200]}"
    except Exception as exc:  # pragma: no cover - defensive for transient network/runtime failures
        return None, f"OpenAI request failed: {exc}"

    sql = _extract_openai_text(body)
    if not sql:
        status = _trim_text(body.get("status")) or "unknown"
        return None, f"OpenAI did not return SQL output (status: {status})."
    return sql, None


def _generate_sql_with_anthropic(
    *,
    question: str,
    conversation_history: list[dict[str, str]],
    api_key: str,
    llm_model: str,
    schema_hint_text: str,
) -> tuple[str | None, str | None]:
    latency_scope_text = _latency_scope_guidance()
    history_lines: list[str] = []
    for item in conversation_history[-8:]:
        role = _trim_text(item.get("role")) or "user"
        content = _trim_text(item.get("content"))
        if content:
            history_lines.append(f"{role.upper()}: {content}")
    user_prompt = (
        "Generate one safe read-only SQLite SQL query.\n"
        "Output ONLY SQL. One statement. Use SELECT or WITH. No markdown fences.\n"
        f"{schema_hint_text}\n"
        f"{latency_scope_text}\n\n"
        "Conversation history:\n"
        + ("\n".join(history_lines) if history_lines else "(none)")
        + f"\n\nUser question:\n{question}"
    )
    payload = {
        "model": _normalize_anthropic_model(llm_model),
        "max_tokens": 300,
        "temperature": 0,
        "system": "You generate safe read-only SQLite SQL.",
        "messages": [{"role": "user", "content": user_prompt}],
    }
    req = urllib_request.Request(
        ANTHROPIC_MESSAGES_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        return None, f"Anthropic request failed ({exc.code}): {message[:220]}"
    except Exception as exc:  # pragma: no cover
        return None, f"Anthropic request failed: {exc}"

    sql = _extract_anthropic_text(body)
    if not sql:
        return None, "Anthropic did not return SQL output."
    return sql, None


def _generate_sql_with_provider(
    *,
    provider: str,
    question: str,
    conversation_history: list[dict[str, str]],
    api_key: str,
    llm_model: str,
    schema_hint_text: str,
) -> tuple[str | None, str | None]:
    if provider == "openai":
        return _generate_sql_with_openai(
            question=question,
            conversation_history=conversation_history,
            api_key=api_key,
            llm_model=llm_model,
            schema_hint_text=schema_hint_text,
        )
    if provider == "aws-bedrock-anthropic":
        return _generate_sql_with_anthropic(
            question=question,
            conversation_history=conversation_history,
            api_key=api_key,
            llm_model=llm_model,
            schema_hint_text=schema_hint_text,
        )
    return None, f"Unsupported LLM provider: {provider}"


def _reason_over_results_with_provider(
    *,
    provider: str,
    question: str,
    sql: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    conversation_history: list[dict[str, str]],
    api_key: str,
    llm_model: str,
) -> tuple[str | None, list[str] | None, str | None, float | None, str | None]:
    if provider == "openai":
        return _reason_over_results_with_openai(
            question=question,
            sql=sql,
            columns=columns,
            rows=rows,
            conversation_history=conversation_history,
            api_key=api_key,
            llm_model=llm_model,
        )
    if provider == "aws-bedrock-anthropic":
        return _reason_over_results_with_anthropic(
            question=question,
            sql=sql,
            columns=columns,
            rows=rows,
            conversation_history=conversation_history,
            api_key=api_key,
            llm_model=llm_model,
        )
    return None, None, None, None, f"Unsupported LLM provider: {provider}"


class ChatbotService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _get_session(self, assistant_mode: str | None, conversation_id: str | None) -> ChatSessionState:
        mode = _canonical_col(_trim_text(assistant_mode) or "default")
        session_key = f"{mode}:{conversation_id}" if conversation_id else None
        if session_key and session_key in CHAT_SESSIONS:
            state = CHAT_SESSIONS[session_key]
            if not hasattr(state, "sql_history") or state.sql_history is None:
                state.sql_history = []
            return state
        new_id = conversation_id or str(uuid.uuid4())
        session_key = f"{mode}:{new_id}"
        state = ChatSessionState(conversation_id=new_id, history=[])
        CHAT_SESSIONS[session_key] = state
        if len(CHAT_SESSIONS) > CHAT_SESSION_LIMIT:
            oldest = next(iter(CHAT_SESSIONS.keys()))
            CHAT_SESSIONS.pop(oldest, None)
        return state

    def _execute_sql(self, sql: str) -> tuple[list[str], list[dict[str, Any]]]:
        limited_sql = _with_limit(sql)
        with _read_only_connect() as conn:
            cursor = conn.execute(limited_sql)
            columns = [item[0] for item in (cursor.description or [])]
            raw_rows = cursor.fetchall()
        rows = [dict(zip(columns, row, strict=False)) for row in raw_rows]
        return columns, rows

    def _response_diagnostics(
        self,
        *,
        state: ChatbotResponseFlowState,
        row_count: int,
        generated_sql: str | None,
        extra_warnings: list[str] | None = None,
    ) -> dict[str, Any]:
        warnings = list(state.get("warnings", []))
        if extra_warnings:
            warnings.extend(extra_warnings)
        return {
            "intent": state.get("intent", "db-query"),
            "generated_sql": generated_sql,
            "prompt_used": state.get("prompt_used"),
            "confidence_score": state.get("confidence_score"),
            "reasoning_summary": state.get("reasoning_summary"),
            "warnings": warnings,
            "row_count": row_count,
            "llm_invoked": state.get("llm_invoked", False),
            "conversation_id": state["session_state"].conversation_id,
        }

    def _short_circuit_response(
        self,
        *,
        state: ChatbotResponseFlowState,
        answer_text: str,
        follow_up_questions: list[str],
        generated_sql: str | None,
        extra_warnings: list[str] | None = None,
        citations_limit: int = 2,
    ) -> dict[str, Any]:
        return {
            "answer_text": answer_text,
            "follow_up_questions": follow_up_questions,
            "table": {"columns": [], "rows": []},
            "apply_candidates": [],
            "apply_filters": {},
            "can_apply_filters": False,
            "diagnostics": self._response_diagnostics(
                state=state,
                row_count=0,
                generated_sql=generated_sql,
                extra_warnings=extra_warnings,
            ),
            "citations": retrieve_policy_context(self.db, state["question"], limit=citations_limit),
        }

    def _schema_clarification_response(
        self,
        *,
        state: ChatbotResponseFlowState,
        sql: str,
        schema_reason: str | None,
    ) -> dict[str, Any]:
        missing_column = _extract_missing_column(schema_reason)
        suggestions = _schema_column_suggestions(state.get("schema", {}), missing_column)
        if missing_column:
            if suggestions:
                answer_text = (
                    f"I could not map `{missing_column}` to the current schema. "
                    "Please confirm which field you want, or pick one of the closest available columns."
                )
            else:
                answer_text = (
                    f"I could not find `{missing_column}` in the current schema. "
                    "Please clarify the exact field name or table you want me to use."
                )
        else:
            answer_text = (
                "I could not map part of the request to the current schema. "
                "Please clarify the exact table/column names, and I can rerun it."
            )

        follow_up: list[str] = []
        if suggestions:
            follow_up.extend([f"Use `{item}` instead." for item in suggestions[:3]])
        follow_up.extend(
            [
                "Should I use `alert_id` and omit recommendation id fields if unavailable?",
                "Do you want me to list available columns for the relevant table first?",
            ]
        )
        return self._short_circuit_response(
            state=state,
            answer_text=answer_text,
            follow_up_questions=follow_up[:4],
            generated_sql=sql,
            extra_warnings=None,
        )

    def _rsp_prepare_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        warnings: list[str] = []
        schema: dict[str, list[str]] = {}
        schema_hint_text = ""
        prompt_used: str | None = None
        try:
            schema = _sqlite_schema()
            schema_hint_text = _schema_hint(schema)
            prompt_used = _build_prompt_used_text(schema_hint_text)
        except Exception as exc:
            warnings.append(f"Unable to prepare schema-aware prompt details: {exc}")
        return {
            "warnings": warnings,
            "schema": schema,
            "schema_hint_text": schema_hint_text,
            "prompt_used": prompt_used,
            "llm_invoked": False,
            "short_circuit": False,
            "confidence_score": None,
            "reasoning_summary": None,
        }

    def _rsp_intent_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        intent = "db-query"
        lowered = state["question"].lower()
        if "summary" in lowered and "executive" in lowered:
            intent = "exec-summary"
        elif "summary" in lowered:
            intent = "summary"
        return {"intent": intent}

    def _rsp_generate_sql_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        sql = ""
        warnings = list(state.get("warnings", []))
        llm_invoked = False
        last_sql = state["session_state"].last_sql
        is_follow_up = bool(state["session_state"].history and last_sql)
        question_for_sql = _follow_up_question_with_sql_context(state["question"], last_sql) if is_follow_up else state["question"]
        if state["api_key"]:
            generated_sql, generation_error = _generate_sql_with_provider(
                provider=state.get("selected_provider", "openai"),
                question=question_for_sql,
                conversation_history=state["session_state"].history,
                api_key=state["api_key"],
                llm_model=state["selected_model"],
                schema_hint_text=state.get("schema_hint_text") or _schema_hint(state.get("schema", {})),
            )
            llm_invoked = generated_sql is not None
            if generated_sql:
                sql = generated_sql
            elif generation_error:
                warnings.append(generation_error)
        if not sql:
            if is_follow_up and last_sql:
                sql = _normalize_sql(last_sql)
                warnings.append("Reusing previous SQL context for follow-up because no LLM SQL was available.")
            else:
                sql = _fallback_sql_for_question(state["question"])
                warnings.append("Using deterministic fallback SQL because no LLM SQL was available.")
        return {"sql": sql, "warnings": warnings, "llm_invoked": llm_invoked}

    def _rsp_validate_sql_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        sql = _normalize_sql(state["sql"])
        warnings = list(state.get("warnings", []))
        sql, rewritten = _enforce_case_insensitive_text_matching(sql)
        if rewritten:
            warnings.append("Adjusted SQL for case-insensitive text matching on both sides (including IN subqueries when applicable).")
        safe, reason = _is_safe_select_sql(sql)
        if not safe:
            response = self._short_circuit_response(
                state=state,
                answer_text="I could not run that query safely. Please rephrase as a read-only question.",
                follow_up_questions=[
                    "Do you want order details by SKU and location?",
                    "Should I only include exception orders?",
                    "Do you want a weekly trend instead of raw rows?",
                ],
                generated_sql=sql,
                extra_warnings=[reason] if reason else None,
            )
            return {"short_circuit": True, "response": response, "sql": sql, "warnings": warnings}

        valid_for_schema, schema_reason = _validate_sql_against_db(sql)
        if not valid_for_schema:
            if state.get("llm_invoked"):
                sql = _normalize_sql(_fallback_sql_for_question(state["question"]))
                safe, reason = _is_safe_select_sql(sql)
                if not safe:
                    schema_reason = reason
                else:
                    valid_for_schema, schema_reason = _validate_sql_against_db(sql)
            if (not state.get("llm_invoked")) or (not valid_for_schema):
                response = self._schema_clarification_response(
                    state=state,
                    sql=sql,
                    schema_reason=schema_reason,
                )
                return {"short_circuit": True, "response": response, "sql": sql, "warnings": warnings}

        return {"sql": sql, "warnings": warnings}

    def _rsp_execute_sql_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        try:
            columns, rows = self._execute_sql(state["sql"])
            return {"columns": columns, "rows": rows}
        except Exception as exc:
            exc_text = str(exc)
            if "no such column" in exc_text.lower() or "no such table" in exc_text.lower():
                response = self._schema_clarification_response(
                    state=state,
                    sql=state["sql"],
                    schema_reason=f"SQL does not match current DB schema: {exc_text}",
                )
                return {"short_circuit": True, "response": response}
            response = self._short_circuit_response(
                state=state,
                answer_text=(
                    "I could not execute the generated query. Try narrowing by SKU, location, "
                    "or asking for fewer columns."
                ),
                follow_up_questions=[
                    "Which SKU do you want to focus on?",
                    "Should I scope to one location/node?",
                ],
                generated_sql=state["sql"],
                extra_warnings=[str(exc)],
            )
            return {"short_circuit": True, "response": response}

    def _rsp_postprocess_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        warnings = list(state.get("warnings", []))
        columns = state.get("columns", [])
        rows = state.get("rows", [])
        apply_filters = _extract_apply_filters(columns, rows)
        apply_candidates = _extract_apply_candidates(columns, rows)
        can_apply = bool(apply_filters)
        answer = f"Retrieved {len(rows)} row(s)." if rows else "I did not find matching rows for that question."
        follow_up = _default_follow_up_questions(state["question"], columns, rows)
        return {
            "warnings": warnings,
            "apply_filters": apply_filters,
            "apply_candidates": apply_candidates,
            "can_apply": can_apply,
            "answer": answer,
            "follow_up": follow_up,
        }

    def _rsp_reason_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        if not state["api_key"] or not state.get("rows"):
            return {}
        warnings = list(state.get("warnings", []))
        reasoned_answer, reasoned_follow_up, reasoned_summary, reasoned_confidence, reason_error = _reason_over_results_with_provider(
            provider=state.get("selected_provider", "openai"),
            question=state["question"],
            sql=state["sql"],
            columns=state.get("columns", []),
            rows=state.get("rows", []),
            conversation_history=state["session_state"].history,
            api_key=state["api_key"],
            llm_model=state["selected_model"],
        )
        updates: ChatbotResponseFlowState = {"warnings": warnings}
        if reason_error:
            warnings.append(reason_error)
        if reasoned_answer:
            updates["answer"] = reasoned_answer
        if reasoned_follow_up:
            updates["follow_up"] = reasoned_follow_up[:4]
        if reasoned_summary:
            updates["reasoning_summary"] = reasoned_summary
        if reasoned_confidence is not None:
            updates["confidence_score"] = reasoned_confidence
        return updates

    def _rsp_finalize_node(self, state: ChatbotResponseFlowState) -> ChatbotResponseFlowState:
        rows = state.get("rows", [])
        columns = state.get("columns", [])
        confidence_score = state.get("confidence_score")
        if confidence_score is None:
            confidence_score = _fallback_confidence_score(
                rows=rows,
                warnings=state.get("warnings", []),
                llm_invoked=state.get("llm_invoked", False),
            )
        reasoning_summary = state.get("reasoning_summary")
        if reasoning_summary is None:
            if rows:
                reasoning_summary = (
                    f"Based on {len(rows)} returned row(s), interpreted using columns: "
                    + ", ".join(columns[:6])
                    + ("..." if len(columns) > 6 else "")
                )
            else:
                reasoning_summary = "No matching rows were found for the interpreted query."
        response = {
            "answer_text": state.get("answer", "No answer available."),
            "follow_up_questions": state.get("follow_up", []),
            "table": {"columns": columns, "rows": rows},
            "apply_candidates": state.get("apply_candidates", []),
            "apply_filters": state.get("apply_filters", {}),
            "can_apply_filters": state.get("can_apply", False),
            "diagnostics": {
                "intent": state.get("intent", "db-query"),
                "generated_sql": state.get("sql"),
                "prompt_used": state.get("prompt_used"),
                "confidence_score": confidence_score,
                "reasoning_summary": reasoning_summary,
                "warnings": state.get("warnings", []),
                "row_count": len(rows),
                "llm_invoked": state.get("llm_invoked", False),
                "conversation_id": state["session_state"].conversation_id,
            },
            "citations": retrieve_policy_context(self.db, state["question"], limit=3),
        }
        return {"confidence_score": confidence_score, "reasoning_summary": reasoning_summary, "response": response}

    def _rsp_route_if_short_circuit(self, state: ChatbotResponseFlowState) -> str:
        return "done" if state.get("short_circuit") else "continue"

    def _run_response_langgraph(
        self,
        *,
        question: str,
        session_state: ChatSessionState,
        selected_provider: str,
        selected_model: str,
        api_key: str,
    ) -> dict[str, Any]:
        graph = StateGraph(ChatbotResponseFlowState)
        graph.add_node("prepare", self._rsp_prepare_node)
        graph.add_node("intent", self._rsp_intent_node)
        graph.add_node("generate_sql", self._rsp_generate_sql_node)
        graph.add_node("validate_sql", self._rsp_validate_sql_node)
        graph.add_node("execute_sql", self._rsp_execute_sql_node)
        graph.add_node("postprocess", self._rsp_postprocess_node)
        graph.add_node("reason", self._rsp_reason_node)
        graph.add_node("finalize", self._rsp_finalize_node)

        graph.add_edge(START, "prepare")
        graph.add_edge("prepare", "intent")
        graph.add_edge("intent", "generate_sql")
        graph.add_edge("generate_sql", "validate_sql")
        graph.add_conditional_edges(
            "validate_sql",
            self._rsp_route_if_short_circuit,
            {"done": END, "continue": "execute_sql"},
        )
        graph.add_conditional_edges(
            "execute_sql",
            self._rsp_route_if_short_circuit,
            {"done": END, "continue": "postprocess"},
        )
        graph.add_edge("postprocess", "reason")
        graph.add_edge("reason", "finalize")
        graph.add_edge("finalize", END)
        compiled = graph.compile()
        final_state = compiled.invoke(
            {
                "question": question,
                "session_state": session_state,
                "selected_provider": selected_provider,
                "selected_model": selected_model,
                "api_key": api_key,
            }
        )
        return final_state["response"]

    def _unavailable_response(self, *, conversation_id: str) -> dict[str, Any]:
        return {
            "answer_text": "Bot is not available due to missing API key.",
            "follow_up_questions": [],
            "table": {"columns": [], "rows": []},
            "apply_candidates": [],
            "apply_filters": {},
            "can_apply_filters": False,
            "diagnostics": {
                "intent": "unavailable",
                "generated_sql": None,
                "prompt_used": None,
                "confidence_score": None,
                "reasoning_summary": None,
                "warnings": ["Missing API key for selected LLM provider."],
                "row_count": 0,
                "llm_invoked": False,
                "conversation_id": conversation_id,
            },
            "citations": [],
        }

    def _resolve_context_node(self, state: ChatbotFlowState) -> ChatbotFlowState:
        selected_provider, selected_model = resolve_llm_selection(state.get("llm_provider"), state.get("llm_model"))
        session_state = self._get_session(state.get("assistant_mode"), state.get("conversation_id"))
        context_cursor = state.get("context_cursor")
        if isinstance(context_cursor, int):
            bounded_cursor = max(0, min(context_cursor, len(session_state.history)))
            if bounded_cursor % 2 == 1:
                bounded_cursor -= 1
            if bounded_cursor != len(session_state.history):
                session_state.history = session_state.history[:bounded_cursor]
                turn_count = bounded_cursor // 2
                session_state.sql_history = session_state.sql_history[:turn_count]
                session_state.last_sql = session_state.sql_history[-1] if session_state.sql_history else None
        return {
            "selected_provider": selected_provider,
            "selected_model": selected_model,
            "api_key": _trim_text(state.get("openai_api_key")),
            "session_state": session_state,
            "short_circuit": False,
        }

    def _guard_api_key_node(self, state: ChatbotFlowState) -> ChatbotFlowState:
        if state.get("api_key"):
            return {}
        session_state = state["session_state"]
        return {
            "short_circuit": True,
            "response": self._unavailable_response(conversation_id=session_state.conversation_id),
        }

    def _guard_scope_node(self, state: ChatbotFlowState) -> ChatbotFlowState:
        question = state["message"]
        if not _is_out_of_scope_question(question):
            return {}
        session_state = state["session_state"]
        return {
            "short_circuit": True,
            "response": {
                "answer_text": OUT_OF_SCOPE_MESSAGE,
                "follow_up_questions": [],
                "table": {"columns": [], "rows": []},
                "apply_candidates": [],
                "apply_filters": {},
                "can_apply_filters": False,
                "diagnostics": {
                    "intent": "out-of-scope",
                    "generated_sql": None,
                    "prompt_used": None,
                    "confidence_score": None,
                    "reasoning_summary": None,
                    "warnings": [],
                    "row_count": 0,
                    "llm_invoked": False,
                    "conversation_id": session_state.conversation_id,
                },
                "citations": [],
            },
        }

    def _guard_ambiguity_node(self, state: ChatbotFlowState) -> ChatbotFlowState:
        ambiguity_reasons = _detect_ambiguity(state["message"])
        if not ambiguity_reasons:
            return {}
        session_state = state["session_state"]
        return {
            "short_circuit": True,
            "response": {
                "answer_text": "Your question is a bit ambiguous. " + " ".join(ambiguity_reasons),
                "follow_up_questions": [
                    "Which metric should I optimize for (count, quantity, cost, or service level)?",
                    "What scope should I use (SKU, location/node, region, supplier, or time window)?",
                    "Do you want raw rows, top/bottom ranking, or an aggregate trend?",
                ],
                "table": {"columns": [], "rows": []},
                "apply_candidates": [],
                "apply_filters": {},
                "can_apply_filters": False,
                "diagnostics": {
                    "intent": "clarification-needed",
                    "generated_sql": None,
                    "prompt_used": None,
                    "confidence_score": None,
                    "reasoning_summary": None,
                    "warnings": [],
                    "row_count": 0,
                    "llm_invoked": False,
                    "conversation_id": session_state.conversation_id,
                },
                "citations": [],
            },
        }

    def _build_response_node(self, state: ChatbotFlowState) -> ChatbotFlowState:
        response = self._run_response_langgraph(
            question=state["message"],
            session_state=state["session_state"],
            selected_provider=state["selected_provider"],
            selected_model=state["selected_model"],
            api_key=state["api_key"],
        )
        return {"response": response}

    def _append_history_node(self, state: ChatbotFlowState) -> ChatbotFlowState:
        session_state = state["session_state"]
        response = state["response"]
        session_state.history.append({"role": "user", "content": state["message"]})
        session_state.history.append({"role": "assistant", "content": str(response.get("answer_text", ""))})
        generated_sql = response.get("diagnostics", {}).get("generated_sql")
        session_state.last_sql = generated_sql
        session_state.sql_history.append(generated_sql)
        diagnostics = response.setdefault("diagnostics", {})
        diagnostics["history_cursor"] = len(session_state.history)
        return {}

    def _route_if_short_circuit(self, state: ChatbotFlowState) -> str:
        return "done" if state.get("short_circuit") else "continue"

    def _run_langgraph_flow(
        self,
        *,
        message: str,
        conversation_id: str | None,
        context_cursor: int | None,
        assistant_mode: str | None,
        llm_provider: str | None,
        llm_model: str | None,
        openai_api_key: str | None,
    ) -> dict[str, Any]:
        graph = StateGraph(ChatbotFlowState)
        graph.add_node("resolve_context", self._resolve_context_node)
        graph.add_node("guard_api_key", self._guard_api_key_node)
        graph.add_node("guard_scope", self._guard_scope_node)
        graph.add_node("guard_ambiguity", self._guard_ambiguity_node)
        graph.add_node("build_response", self._build_response_node)
        graph.add_node("append_history", self._append_history_node)

        graph.add_edge(START, "resolve_context")
        graph.add_edge("resolve_context", "guard_api_key")
        graph.add_conditional_edges(
            "guard_api_key",
            self._route_if_short_circuit,
            {"done": END, "continue": "guard_scope"},
        )
        graph.add_conditional_edges(
            "guard_scope",
            self._route_if_short_circuit,
            {"done": END, "continue": "guard_ambiguity"},
        )
        graph.add_conditional_edges(
            "guard_ambiguity",
            self._route_if_short_circuit,
            {"done": END, "continue": "build_response"},
        )
        graph.add_edge("build_response", "append_history")
        graph.add_edge("append_history", END)
        compiled = graph.compile()
        final_state = compiled.invoke(
            {
                "message": message,
                "conversation_id": conversation_id,
                "context_cursor": context_cursor,
                "assistant_mode": assistant_mode,
                "llm_provider": llm_provider,
                "llm_model": llm_model,
                "openai_api_key": openai_api_key,
            }
        )
        return final_state["response"]

    def query(
        self,
        *,
        message: str,
        conversation_id: str | None,
        context_cursor: int | None,
        assistant_mode: str | None,
        llm_provider: str | None,
        llm_model: str | None,
        openai_api_key: str | None,
    ) -> dict[str, Any]:
        return self._run_langgraph_flow(
            message=message,
            conversation_id=conversation_id,
            context_cursor=context_cursor,
            assistant_mode=assistant_mode,
            llm_provider=llm_provider,
            llm_model=llm_model,
            openai_api_key=openai_api_key,
        )

    def follow_up(
        self,
        *,
        message: str,
        conversation_id: str,
        context_cursor: int | None,
        assistant_mode: str | None,
        llm_provider: str | None,
        llm_model: str | None,
        openai_api_key: str | None,
    ) -> dict[str, Any]:
        return self.query(
            message=message,
            conversation_id=conversation_id,
            context_cursor=context_cursor,
            assistant_mode=assistant_mode,
            llm_provider=llm_provider,
            llm_model=llm_model,
            openai_api_key=openai_api_key,
        )

    def save_feedback(
        self,
        *,
        conversation_id: str,
        vote: str,
        answer_text: str,
        generated_sql: str | None,
        user_message: str | None,
    ) -> dict[str, Any]:
        item = ChatbotFeedback(
            conversation_id=_trim_text(conversation_id),
            vote=_trim_text(vote) or "down",
            answer_text=_trim_text(answer_text),
            generated_sql=_trim_text(generated_sql) or None,
            user_message=_trim_text(user_message) or None,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        return {"status": "ok", "feedback_id": item.id}
