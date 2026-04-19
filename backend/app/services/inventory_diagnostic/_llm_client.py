"""Shared HTTP client for the three allowed LLM call sites.

Only intent_parser, followup_interpreter, and response_composer import this
module. A regression test enforces that boundary by scanning the package for
modules that import the provider facade.

The client is a thin urllib wrapper around OpenAI Responses + Anthropic
Messages — the same pattern chatbot_service.py uses. It returns
(text, error, metadata) tuples so callers always have a deterministic
fallback when a key is missing or a call fails.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error as urllib_error
import urllib.request as urllib_request
from dataclasses import dataclass
from typing import Any


OPENAI_ENDPOINT = "https://api.openai.com/v1/responses"
ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages"
DEFAULT_TIMEOUT_SECONDS = 15


def openai_supports_temperature(model: str | None) -> bool:
    """GPT-5 family and o-series reasoning models reject the `temperature`
    parameter (400 invalid_request_error). All other OpenAI models accept it."""
    if not model:
        return True
    m = model.strip().lower()
    if m.startswith("gpt-5"):
        return False
    if m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        return False
    return True


def resolve_api_key(
    *,
    provider: str | None,
    user_supplied: str | None = None,
) -> str | None:
    """Pick the API key for a given provider.

    Preference order:
    1. `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env var (primary — set once at
       startup; durable across sessions).
    2. Key the caller supplied from the UI (session-only fallback, used when
       the env var is unset or the operator needs a temporary override).
    """
    prov = (provider or "").lower()
    env_key: str | None = None
    if prov == "openai":
        env_key = (os.getenv("OPENAI_API_KEY") or "").strip() or None
    elif prov in ("anthropic", "bedrock-anthropic", "aws-bedrock-anthropic"):
        env_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip() or None
    if env_key:
        return env_key
    if user_supplied and user_supplied.strip():
        return user_supplied.strip()
    return None


@dataclass
class LlmResult:
    text: str | None
    error: str | None
    provider: str | None
    model: str | None
    latency_ms: int
    tokens_in: int | None = None
    tokens_out: int | None = None


def call_llm(
    *,
    provider: str | None,
    model: str | None,
    api_key: str | None,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.0,
    max_tokens: int = 600,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> LlmResult:
    """Single text-out LLM call. Returns `LlmResult(text=None, error=...)` on any failure.

    Callers should always have a deterministic fallback so a missing api_key
    or a network error never breaks the agent.
    """
    start = time.perf_counter()
    prov = (provider or "openai").lower()
    mdl = (model or "").strip()
    if not api_key:
        return LlmResult(
            text=None,
            error="no_api_key",
            provider=prov,
            model=mdl or None,
            latency_ms=0,
        )

    try:
        if prov == "openai":
            text, err, meta = _call_openai(
                api_key=api_key,
                model=mdl or "gpt-4.1-mini",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout_seconds,
            )
        elif prov in ("anthropic", "bedrock-anthropic", "aws-bedrock-anthropic"):
            text, err, meta = _call_anthropic(
                api_key=api_key,
                model=mdl or "claude-3-5-haiku",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout_seconds,
            )
        else:
            return LlmResult(
                text=None,
                error=f"unsupported_provider:{prov}",
                provider=prov,
                model=mdl or None,
                latency_ms=int((time.perf_counter() - start) * 1000),
            )
    except Exception as exc:  # pragma: no cover - defensive
        return LlmResult(
            text=None,
            error=str(exc),
            provider=prov,
            model=mdl or None,
            latency_ms=int((time.perf_counter() - start) * 1000),
        )

    elapsed = int((time.perf_counter() - start) * 1000)
    return LlmResult(
        text=text,
        error=err,
        provider=prov,
        model=mdl or None,
        latency_ms=elapsed,
        tokens_in=meta.get("tokens_in") if meta else None,
        tokens_out=meta.get("tokens_out") if meta else None,
    )


def extract_json_object(text: str | None) -> dict[str, Any] | None:
    """Pull the first {...} JSON object out of an LLM response.

    LLMs sometimes wrap JSON in prose or fenced code. We take the first balanced
    brace block and try to parse it.
    """
    if not text:
        return None
    cleaned = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1).strip()
    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    for idx in range(start, len(cleaned)):
        ch = cleaned[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                snippet = cleaned[start : idx + 1]
                try:
                    parsed = json.loads(snippet)
                except json.JSONDecodeError:
                    return None
                return parsed if isinstance(parsed, dict) else None
    return None


# ----------------------------------------------------------- provider calls

def _call_openai(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    timeout: int,
) -> tuple[str | None, str | None, dict[str, Any]]:
    payload: dict[str, Any] = {
        "model": model,
        "input": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_output_tokens": int(max_tokens),
    }
    if openai_supports_temperature(model):
        payload["temperature"] = float(temperature)
    req = urllib_request.Request(
        OPENAI_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        return None, f"openai_http_{exc.code}:{detail[:200]}", {}
    except urllib_error.URLError as exc:
        return None, f"openai_network_error:{exc}", {}

    text = _extract_openai_text(body)
    usage = body.get("usage") or {}
    meta = {
        "tokens_in": usage.get("input_tokens"),
        "tokens_out": usage.get("output_tokens"),
    }
    return text or None, None, meta


def _extract_openai_text(body: dict[str, Any]) -> str:
    direct = body.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    chunks: list[str] = []
    for item in body.get("output") or []:
        for content in item.get("content") or []:
            if isinstance(content, dict):
                text = content.get("text")
                if isinstance(text, str) and text.strip():
                    chunks.append(text.strip())
    return "\n".join(chunks).strip()


def _call_anthropic(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    timeout: int,
) -> tuple[str | None, str | None, dict[str, Any]]:
    payload = {
        "model": _normalize_anthropic_model(model),
        "max_tokens": int(max_tokens),
        "temperature": float(temperature),
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    req = urllib_request.Request(
        ANTHROPIC_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        return None, f"anthropic_http_{exc.code}:{detail[:200]}", {}
    except urllib_error.URLError as exc:
        return None, f"anthropic_network_error:{exc}", {}

    text = _extract_anthropic_text(body)
    usage = body.get("usage") or {}
    meta = {
        "tokens_in": usage.get("input_tokens"),
        "tokens_out": usage.get("output_tokens"),
    }
    return text or None, None, meta


def _extract_anthropic_text(body: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in body.get("content") or []:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                chunks.append(text.strip())
    return "\n".join(chunks).strip()


_ANTHROPIC_MODEL_MAP = {
    "claude-opus-4-6": "claude-opus-4-20250514",
    "claude-sonnet-4-6": "claude-sonnet-4-20250514",
    "claude-sonnet-4-5": "claude-sonnet-4-20250514",
    "claude-3-5-haiku": "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
}


def _normalize_anthropic_model(model: str) -> str:
    return _ANTHROPIC_MODEL_MAP.get(model, model)


def ping_provider(provider: str, api_key: str | None) -> dict[str, Any]:
    """Lightweight 1-token ping per provider — used by the health endpoint.

    Returns `{status: ok|error|no_key, detail, model, latency_ms}`.
    """
    import time as _time

    provider = (provider or "").lower()
    effective = resolve_api_key(provider=provider, user_supplied=api_key)
    if not effective:
        return {"status": "no_key", "detail": "No API key configured or provided.", "provider": provider}
    start = _time.perf_counter()
    result = call_llm(
        provider=provider,
        model="gpt-4.1-mini" if provider == "openai" else "claude-3-5-haiku",
        api_key=effective,
        system_prompt="You are a health check. Reply with the single word: ok",
        user_prompt="ping",
        temperature=0.0,
        max_tokens=5,
        timeout_seconds=8,
    )
    latency = int((_time.perf_counter() - start) * 1000)
    if result.error:
        return {
            "status": "error",
            "detail": result.error,
            "provider": provider,
            "model": result.model,
            "latency_ms": latency,
        }
    return {
        "status": "ok",
        "provider": provider,
        "model": result.model,
        "latency_ms": latency,
        "response_preview": (result.text or "")[:40],
    }
