from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request


DEFAULT_OPENAI_MODEL = os.getenv("TEXT2SQL_DEFAULT_LLM_MODEL") or os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"
DEFAULT_BEDROCK_ANTHROPIC_MODELS = [
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "us.anthropic.claude-opus-4-6-v1",
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "anthropic.claude-3-opus-20240229-v1:0",
    "anthropic.claude-3-haiku-20240307-v1:0",
]


def _parse_models(env_name: str, fallback: str) -> list[dict[str, str]]:
    raw = os.getenv(env_name, "").strip()
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if not values:
        values = [fallback]
    return [{"id": model, "label": model} for model in values]

def _parse_models_multi_fallback(env_name: str, fallbacks: list[str]) -> list[dict[str, str]]:
    raw = os.getenv(env_name, "").strip()
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if not values:
        values = [item for item in fallbacks if item.strip()]
    return [{"id": model, "label": model} for model in values]


def llm_options_payload() -> dict[str, Any]:
    providers = [
        {
            "id": "openai",
            "label": "OpenAI",
            "models": _parse_models("TEXT2SQL_OPENAI_MODELS", DEFAULT_OPENAI_MODEL),
        },
        {
            "id": "aws-bedrock-anthropic",
            "label": "AWS Bedrock (Anthropic Claude)",
            "models": _parse_models_multi_fallback("TEXT2SQL_BEDROCK_ANTHROPIC_MODELS", DEFAULT_BEDROCK_ANTHROPIC_MODELS),
        },
    ]
    return {
        "providers": providers,
        "defaults": {
            "provider": "openai",
            "model": providers[0]["models"][0]["id"],
        },
    }


def resolve_llm_selection(provider: str | None, model: str | None) -> tuple[str, str]:
    options = llm_options_payload()
    provider_id = provider or options["defaults"]["provider"]
    provider_entry = next((item for item in options["providers"] if item["id"] == provider_id), options["providers"][0])
    allowed_models = {entry["id"] for entry in provider_entry["models"]}
    resolved_model = model if model in allowed_models else provider_entry["models"][0]["id"]
    return provider_entry["id"], resolved_model


def _normalize_anthropic_model(model: str) -> str:
    candidate = model.strip()
    if candidate.startswith("us.anthropic."):
        candidate = candidate.split("us.anthropic.", 1)[1]
    if candidate.startswith("anthropic."):
        candidate = candidate.split("anthropic.", 1)[1]
    if candidate.endswith(":0"):
        candidate = candidate[:-2]
    candidate = re.sub(r"-v\d+$", "", candidate)
    return candidate or "claude-3-5-sonnet-20241022"


def test_llm_connection(provider: str, model: str, api_key: str) -> dict[str, Any]:
    key = api_key.strip()
    if not key:
        return {"ok": False, "message": "API key is required for connection test."}
    if provider == "openai":
        payload = {
            "model": model,
            "input": [{"role": "user", "content": "Reply with exactly: OK"}],
            "max_output_tokens": 16,
            "temperature": 0,
        }
        req = urllib_request.Request(
            "https://api.openai.com/v1/responses",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
        )
    elif provider == "aws-bedrock-anthropic":
        payload = {
            "model": _normalize_anthropic_model(model),
            "max_tokens": 16,
            "temperature": 0,
            "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        }
        req = urllib_request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
        )
    else:
        return {"ok": False, "message": f"Unsupported provider: {provider}"}
    try:
        with urllib_request.urlopen(req, timeout=12) as response:
            response.read()
        return {"ok": True, "message": "Connection successful."}
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        if provider == "aws-bedrock-anthropic" and exc.code == 401 and "invalid x-api-key" in detail:
            return {
                "ok": False,
                "message": (
                    "Connection failed (401): invalid Anthropic x-api-key. "
                    "Use an Anthropic API key for this provider path."
                ),
            }
        return {"ok": False, "message": f"Connection failed ({exc.code}): {detail[:220]}"}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "message": f"Connection failed: {exc}"}

