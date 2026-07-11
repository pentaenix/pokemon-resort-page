"""Local OpenAI-compatible LLM bridge for structured character authoring."""
from __future__ import annotations

import base64
import io
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image

from spmk_app.npc_intel import validate_intel_for_package
from spmk_app.npc_intel_schema import provider_output_schema

DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_MAX_TOKENS = 8000
MAX_OUTPUT_TOKENS = 128000
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_SPRITE_EDGE = 512
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


class LlmServiceError(ValueError):
    """A user-facing provider failure with safe local diagnostics."""

    def __init__(self, message: str, diagnostics: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.diagnostics = diagnostics or {}

SPRITE_SYSTEM_PROMPT = """You are a Pokemon character identification and resort-dialogue assistant.

SPRITE CONTEXT

Every supplied image is a 4 by 4 Pokemon-style overworld sprite sheet made in the
Nintendo DS Generation 4 visual language. It may be an original DS-era sprite, or a
fan-made Generation 4-style reinterpretation of a canonical character from any main
Pokemon game, including games released after the DS era. The DS sprite format is an
art-direction constraint, never evidence that a later-game character is impossible.

Identify the intended character, trainer class, or generic NPC from hair, clothing,
silhouette, palette, and recognizable character design. Treat custom or edited art as
compatible with a canonical identity when the intended character is clear. Do not
spend effort deciding whether a sprite is official, whether newer games used 3D
models, or whether the source game originally had overworld sprites.

Use game continuity as primary. Use the provided web search tool to verify the leading
canonical candidate before answering. Decide on one best identity, then return only
the JSON object required by the configured structured-output schema.

FIELD RULES

- `character_name`: the character's display name, with normal capitalization.
- `description`: one or two natural sentences explaining who the resort guest is.
- `role`: choose only an enum value permitted by the schema.
- `main_pokemon`: exactly one most relevant Pokemon species, or null. For Cynthia it
  is Garchomp. Never choose a roster member over an established signature Pokemon.
- `additional_pokemon`: zero to two other meaningful species, in relevance order.
- `source_game` and `source_region`: the game version and region represented by this
  character where identifiable.
- `badge_requirement`: the number of badges needed before the first normal encounter
  in that source game. Use 0 where none are required; for Elite Four or Champion use
  the post-champion requirement specified by the project schema/authoring guidance.
- `relationships`: zero to three plain character names that are genuinely useful for
  dialogue. Do not add relationship types or explanations.
- `dialogue`: produce the schema-required number of short, original resort-ambient
  lines. They are selected individually and can appear in any order, so never write a
  greeting, farewell, battle challenge, quest instruction, turn-taking reply, or a
  line that depends on a previous sentence. Each line should feel personal and specific
  to the guest's established interests, memories, companions, or way of seeing a calm
  Pokemon resort. Avoid generic motivational language and stock trainer dialogue.

Do not include URLs, citations, Markdown links, alternatives, sprite-analysis narration,
sources, confidence claims, or extra fields. Web research is internal verification only;
every JSON value must be plain game data with no source markup."""

IDENTIFICATION_SYSTEM_PROMPT = """You identify Pokemon characters from overworld sheets.
Every image is a 4 by 4 Nintendo DS Generation 4-style overworld sprite sheet. It may
be fan-made DS-style art for a canonical character from any Pokemon game, including
games released after the DS era. Never reject a candidate because newer games used 3D
models or because the sprite may be edited. Identify one best intended identity from
design cues, then use the provided web search tool to verify the leading canonical
candidate before returning the compact JSON. Use at most two focused searches and
prefer official Pokemon material, Bulbapedia, and Serebii. Do not discuss sprite
authenticity, game rendering technology, or alternate candidates in the output; put
genuine uncertainty in uncertainties. Never put links, citations, Markdown, or source
markup in a JSON value; web research remains internal verification only."""

PROMPT_DEFAULTS = {"profile": SPRITE_SYSTEM_PROMPT}
CORE_PROFILE_FIELDS = {"character_name", "description", "role", "main_pokemon", "additional_pokemon", "source_game", "source_region", "badge_requirement", "relationships", "dialogue"}


def _profile_schema_from_settings(raw: Any) -> Dict[str, Any]:
    schema = raw if isinstance(raw, dict) else provider_output_schema()["schema"]
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    required = set(schema.get("required") or [])
    missing = sorted(CORE_PROFILE_FIELDS - set(properties))
    if missing or not CORE_PROFILE_FIELDS.issubset(required):
        raise ValueError("Output schema must retain every core resort profile field")
    if schema.get("type") != "object":
        raise ValueError("Output schema root must be an object")
    return schema


def _settings_path(workspace: Path) -> Path:
    return workspace / "llm_settings.json"


def load_settings(workspace: Path) -> Dict[str, Any]:
    path = _settings_path(workspace)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raw = {}
    stored_prompts = raw.get("prompts") if isinstance(raw.get("prompts"), dict) else {}
    prompts = {
        key: str(stored_prompts.get(key) or default)
        for key, default in PROMPT_DEFAULTS.items()
    }
    schema = _profile_schema_from_settings(raw.get("profileSchema"))
    return {
        "vendor": str(raw.get("vendor") or "openai").strip(),
        "endpoint": str(raw.get("endpoint") or DEFAULT_ENDPOINT).strip(),
        "model": str(raw.get("model") or DEFAULT_MODEL).strip(),
        "maxTokens": max(2000, min(MAX_OUTPUT_TOKENS, int(raw.get("maxTokens") or DEFAULT_MAX_TOKENS))),
        "reasoningEnabled": bool(raw.get("reasoningEnabled")),
        "reasoningEffort": str(raw.get("reasoningEffort") or "low").lower(),
        "temperature": max(0.0, min(1.0, float(raw.get("temperature") if raw.get("temperature") is not None else 0.15))),
        "apiKey": str(raw.get("apiKey") or ""),
        "prompts": prompts,
        "profileSchema": schema,
    }


def public_settings(workspace: Path) -> Dict[str, Any]:
    settings = load_settings(workspace)
    return {
        "vendor": settings["vendor"],
        "endpoint": settings["endpoint"],
        "model": settings["model"],
        "maxTokens": settings["maxTokens"],
        "reasoningEnabled": settings["reasoningEnabled"],
        "reasoningEffort": settings["reasoningEffort"],
        "temperature": settings["temperature"],
        "configured": bool(settings["apiKey"]),
        "prompts": settings["prompts"],
        "schemas": {"profile": settings["profileSchema"]},
    }


def save_settings(workspace: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    current = load_settings(workspace)
    endpoint = str(payload.get("endpoint") or current["endpoint"]).strip()
    model = str(payload.get("model") or current["model"]).strip()
    vendor = str(payload.get("vendor") or current["vendor"]).strip().lower()
    reasoning_enabled = bool(payload["reasoningEnabled"]) if "reasoningEnabled" in payload else current["reasoningEnabled"]
    reasoning_effort = str(payload.get("reasoningEffort") or current["reasoningEffort"]).lower()
    if reasoning_effort not in {"minimal", "low", "medium", "high"}:
        raise ValueError("Reasoning effort must be minimal, low, medium, or high")
    try:
        temperature = float(payload.get("temperature") if payload.get("temperature") is not None else current["temperature"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Temperature must be a number") from exc
    temperature = max(0.0, min(1.0, temperature))
    try:
        max_tokens = int(payload.get("maxTokens") or current["maxTokens"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Max completion tokens must be a number") from exc
    max_tokens = max(2000, min(MAX_OUTPUT_TOKENS, max_tokens))
    key = str(payload.get("apiKey") or "").strip() or current["apiKey"]
    supplied_prompts = payload.get("prompts") if isinstance(payload.get("prompts"), dict) else {}
    prompts = {**current["prompts"]}
    for prompt_key, value in supplied_prompts.items():
        if prompt_key not in PROMPT_DEFAULTS:
            continue
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Prompt {prompt_key} must be non-empty text")
        if len(value) > 40000:
            raise ValueError(f"Prompt {prompt_key} is too long")
        prompts[prompt_key] = value.strip()
    profile_schema = _profile_schema_from_settings(payload.get("profileSchema", current["profileSchema"]))
    if not endpoint.startswith(("https://", "http://")):
        raise ValueError("LLM endpoint must be an http or https URL")
    if not model:
        raise ValueError("LLM model is required")
    path = _settings_path(workspace)
    path.write_text(json.dumps({"vendor": vendor, "endpoint": endpoint, "model": model, "maxTokens": max_tokens, "reasoningEnabled": reasoning_enabled, "reasoningEffort": reasoning_effort, "temperature": temperature, "apiKey": key, "prompts": prompts, "profileSchema": profile_schema}, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return public_settings(workspace)


def available_models(workspace: Path) -> Dict[str, Any]:
    settings = load_settings(workspace)
    if not settings["apiKey"]:
        return {"models": [], "warning": "Configure an API key to load available models"}
    models_url = _models_url(settings["endpoint"])
    try:
        with urlopen(Request(models_url, headers={"Authorization": f"Bearer {settings['apiKey']}"}), timeout=20) as response:
            rows = json.loads(response.read().decode("utf-8")).get("data") or []
    except Exception as exc:
        return {"models": [], "warning": f"Could not load model catalog: {exc}"}
    ids = sorted({str(row.get("id")) for row in rows if isinstance(row, dict) and str(row.get("id", "")).startswith(("gpt-", "o"))})
    return {"models": ids, "warning": ""}


def _json_content(content: Any) -> Dict[str, Any]:
    if isinstance(content, list):
        content = "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
    text = _FENCE.sub("", str(content or "").strip())
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("LLM response was not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("LLM response must be a JSON object")
    return parsed


def _models_url(endpoint: str) -> str:
    base = endpoint.rstrip("/")
    for suffix in ("/chat/completions", "/responses"):
        if base.endswith(suffix):
            return base[: -len(suffix)] + "/models"
    return base + "/models"


def _responses_url(endpoint: str) -> str:
    base = endpoint.rstrip("/")
    if base.endswith("/responses"):
        return base
    for suffix in ("/chat/completions", "/completions"):
        if base.endswith(suffix):
            return base[: -len(suffix)] + "/responses"
    return base + "/responses"


def _bounded_text(value: Any, limit: int = 24000) -> str:
    text = str(value or "")
    return text if len(text) <= limit else text[:limit] + "\n[truncated locally]"


def _response_diagnostics(raw: Dict[str, Any]) -> Dict[str, Any]:
    usage = raw.get("usage") if isinstance(raw.get("usage"), dict) else {}
    output_text = raw.get("output_text")
    summaries = []
    searches = []
    if not output_text:
        texts = []
        for item in raw.get("output") or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "reasoning":
                for summary in item.get("summary") or []:
                    if isinstance(summary, dict) and summary.get("text"):
                        summaries.append(str(summary["text"]))
            if item.get("type") == "web_search_call":
                action = item.get("action") or {}
                if isinstance(action, dict) and action.get("query"):
                    searches.append(str(action["query"]))
            for content in item.get("content") or []:
                if isinstance(content, dict) and content.get("type") == "output_text":
                    texts.append(str(content.get("text") or ""))
        output_text = "".join(texts)
    model = str(raw.get("model") or "")
    input_tokens = usage.get("input_tokens")
    output_tokens = usage.get("output_tokens")
    token_cost = None
    if model.startswith("gpt-5.4-mini") and isinstance(input_tokens, int) and isinstance(output_tokens, int):
        token_cost = round((input_tokens * 0.75 + output_tokens * 4.50) / 1_000_000, 6)
    return {
        "provider": "openai",
        "responseId": raw.get("id"),
        "status": raw.get("status"),
        "incompleteReason": (raw.get("incomplete_details") or {}).get("reason"),
        "model": model,
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "reasoningTokens": (usage.get("output_tokens_details") or {}).get("reasoning_tokens"),
        },
        "reasoningSummary": _bounded_text("\n".join(summaries), 8000),
        "webSearches": searches[:2],
        "estimatedTokenCostUsd": token_cost,
        "rawOutput": _bounded_text(output_text),
        "providerResponse": raw,
    }


def _normalized_sprite(image_bytes: bytes) -> bytes:
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("Sprite sheet is too large; use an image below 2 MB")
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            if image.width < 8 or image.height < 8:
                raise ValueError("Sprite sheet is too small to analyze")
            image.thumbnail((MAX_SPRITE_EDGE, MAX_SPRITE_EDGE), Image.Resampling.NEAREST)
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=True)
            return output.getvalue()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Sprite sheet must be a readable PNG or WebP image") from exc


def _compact_profile_errors(profile: Any) -> list[str]:
    """Reject retired intel payloads before they reach character authoring UI."""
    if not isinstance(profile, dict):
        return ["response must be a JSON object"]
    missing = sorted(CORE_PROFILE_FIELDS - set(profile))
    if missing:
        return [f"missing compact profile fields: {', '.join(missing)}"]
    errors: list[str] = []
    for field in ("character_name", "description", "role", "source_game", "source_region"):
        if not isinstance(profile.get(field), str) or not profile[field].strip():
            errors.append(f"{field} must be non-empty text")
    if profile.get("main_pokemon") is not None and not isinstance(profile.get("main_pokemon"), str):
        errors.append("main_pokemon must be text or null")
    for field, maximum in (("additional_pokemon", 2), ("relationships", 3), ("dialogue", 15)):
        value = profile.get(field)
        if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
            errors.append(f"{field} must be an array of non-empty text")
        elif len(value) > maximum:
            errors.append(f"{field} may contain at most {maximum} entries")
    dialogue = profile.get("dialogue")
    if isinstance(dialogue, list) and not 10 <= len(dialogue) <= 15:
        errors.append(f"dialogue must contain 10 to 15 lines (received {len(dialogue)})")
    if isinstance(profile.get("badge_requirement"), bool) or not isinstance(profile.get("badge_requirement"), int) or profile["badge_requirement"] < 0:
        errors.append("badge_requirement must be a non-negative integer")
    return errors


def generate_intel(workspace: Path, *, known_name: str = "", image_bytes: Optional[bytes] = None, image_type: str = "image/png", stage: str = "profile") -> Dict[str, Any]:
    settings = load_settings(workspace)
    if not settings["apiKey"]:
        raise ValueError("Configure an LLM API key first")
    known_name = known_name.strip()
    stage = "profile"
    if len(known_name) > 120:
        raise ValueError("Character name must be 120 characters or fewer")
    normalized_image = _normalized_sprite(image_bytes) if image_bytes else None
    if normalized_image:
        encoded = base64.b64encode(normalized_image).decode("ascii")
        user_content: Any = [
            {"type": "input_text", "text": (
                f"Confirmed identity: {known_name}. Fill this character's profile." if stage == "profile" and known_name
                else f"Known name hint: {known_name or 'none'}. Identify this sprite sheet."
            )},
            {"type": "input_image", "image_url": f"data:image/png;base64,{encoded}", "detail": "low"},
        ]
        system = settings["prompts"]["profile"]
    else:
        if not known_name:
            raise ValueError("Character name is required")
        user_content = [{"type": "input_text", "text": f"Character name: {known_name}"}]
        system = settings["prompts"]["profile"]
    request_body = {
        "model": settings["model"],
        "max_output_tokens": settings["maxTokens"],
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": system}]},
            {"role": "user", "content": user_content},
        ],
        "text": {"format": {**provider_output_schema(), "schema": settings["profileSchema"]}},
    }
    request_body["tools"] = [{"type": "web_search"}]
    if settings["reasoningEnabled"]:
        request_body["reasoning"] = {"effort": settings["reasoningEffort"], "summary": "auto"}
    else:
        request_body["reasoning"] = {"effort": "none"}
    request = Request(
        _responses_url(settings["endpoint"]),
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings['apiKey']}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise LlmServiceError(
            f"LLM request failed ({exc.code})",
            {"provider": "openai", "status": "failed", "httpStatus": exc.code, "rawOutput": _bounded_text(detail), "reasoningSummary": ""},
        ) from exc
    except URLError as exc:
        raise ValueError(f"LLM request failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise LlmServiceError(
            "LLM request timed out after 180 seconds",
            {"provider": "openai", "status": "timed_out", "rawOutput": "", "reasoningSummary": ""},
        ) from exc
    diagnostics = _response_diagnostics(raw)
    diagnostics["requestedMaxOutputTokens"] = settings["maxTokens"]
    if raw.get("status") != "completed":
        if diagnostics.get("incompleteReason") == "max_output_tokens":
            raise LlmServiceError(
                f"LLM response reached the {settings['maxTokens']}-token output budget before producing its profile",
                diagnostics,
            )
        raise LlmServiceError("LLM response did not complete", diagnostics)
    try:
        parsed = _json_content(diagnostics["rawOutput"])
    except ValueError as exc:
        raise LlmServiceError("LLM response was not valid JSON", diagnostics) from exc
    compact_errors = _compact_profile_errors(parsed)
    if compact_errors:
        diagnostics["validationErrors"] = compact_errors
        raise LlmServiceError("LLM response did not match the compact character profile schema", diagnostics)
    report = validate_intel_for_package(parsed)
    if not report.get("ok"):
        diagnostics["validationErrors"] = report.get("errors") or []
        raise LlmServiceError("LLM profile failed validation", diagnostics)
    report["trace"] = [
        f"Requested {settings['model']}",
        f"Reasoning: {settings['reasoningEffort']}" if settings["reasoningEnabled"] else "Reasoning: disabled",
        "Validated structured character profile",
    ]
    diagnostics["validationWarnings"] = report.get("warnings") or []
    report["diagnostics"] = diagnostics
    report["profile"] = parsed
    return report
