"""Map LLM-authored NPC intel JSON onto .charbin packages for human characters."""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Dict, List, Optional

_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_MARKDOWN_CITATION_RE = re.compile(r"\s*\(\s*\[[^\]]+\]\([^)]*\)\s*\)")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)

IDENTITY_TYPES = ("unique_character", "trainer_class", "generic_npc", "unknown")
POKEMON_ASSOCIATIONS = (
    "partner",
    "signature",
    "starter",
    "companion",
    "major_team_member",
    "recurring_team_member",
)
CONTINUITY_VALUES = ("game", "anime", "manga")

PARTNER_ASSOCIATIONS = {"partner", "signature", "starter", "companion"}


def _slug(raw: Any) -> str:
    text = str(raw or "").strip().lower()
    text = re.sub(r"[^a-z0-9_]+", "_", text)
    return text.strip("_") or "character"


def _clean_text(value: Any) -> Any:
    """Keep external citations out of portable game text."""
    if value is None:
        return None
    text = str(value).strip()
    text = _MARKDOWN_CITATION_RE.sub("", text)
    text = _MARKDOWN_LINK_RE.sub(r"\1", text)
    text = _URL_RE.sub("", text)
    return re.sub(r"\s{2,}", " ", text).strip(" \t\n-–()") or None


def empty_npc_intel() -> Dict[str, Any]:
    return {
        "id": None,
        "display_name": None,
        "names": [],
        "identity_type": "unknown",
        "role": None,
        "confidence": 0.0,
        "custom_or_edited": False,
        "source_game": None,
        "region": None,
        "guest_book_description": None,
        "availability": [],
        "pokemon": [],
        "relationships": [],
        "canon": [],
        "dialogue": [],
        "uncertainties": [],
    }


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_str_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for item in value:
        text = _clean_text(item)
        if text:
            out.append(text)
    return out


def _normalize_availability(rows: Any) -> List[Dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            {
                "game": _clean_text(row.get("game")),
                "badge_number": int(row.get("badge_number") or 0),
                "location": _clean_text(row.get("location")),
                "notes": _clean_text(row.get("notes")),
            }
        )
    return out


def _normalize_pokemon(rows: Any) -> List[Dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        assoc = str(row.get("association") or "companion").strip().lower()
        if assoc not in POKEMON_ASSOCIATIONS:
            assoc = "companion"
        continuity = str(row.get("continuity") or "game").strip().lower()
        if continuity not in CONTINUITY_VALUES:
            continuity = "game"
        out.append(
            {
                "name": _clean_text(row.get("name")),
                "primary": bool(row.get("primary")),
                "association": assoc,
                "continuity": continuity,
                "source": _clean_text(row.get("source")),
                "notes": _clean_text(row.get("notes")),
            }
        )
    return out


def _normalize_relationships(rows: Any) -> List[Dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        continuity = str(row.get("continuity") or "game").strip().lower()
        if continuity not in CONTINUITY_VALUES:
            continuity = "game"
        out.append(
            {
                "id": _clean_text(row.get("id")),
                "type": _clean_text(row.get("type")),
                "continuity": continuity,
                "source": _clean_text(row.get("source")),
                "notes": _clean_text(row.get("notes")),
            }
        )
    return out


def _normalize_canon(rows: Any) -> List[Dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        continuity = str(row.get("continuity") or "game").strip().lower()
        if continuity not in CONTINUITY_VALUES:
            continuity = "game"
        facts = row.get("facts")
        out.append(
            {
                "continuity": continuity,
                "source": _clean_text(row.get("source")),
                "facts": _as_str_list(facts),
            }
        )
    return out


def _normalize_dialogue(rows: Any) -> List[Dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if isinstance(row, str):
            line = _clean_text(row)
            if line:
                out.append({"context": None, "line": line})
            continue
        if not isinstance(row, dict):
            continue
        line = _clean_text(row.get("line"))
        if not line:
            continue
        out.append({"context": _clean_text(row.get("context")), "line": line})
    return out


def normalize_npc_intel(raw: Any) -> Dict[str, Any]:
    """Coerce arbitrary LLM JSON into the NPC intel schema."""
    data = raw if isinstance(raw, dict) else {}
    if "character_name" in data:
        main = _clean_text(data.get("main_pokemon"))
        extras = _as_str_list(data.get("additional_pokemon"))[:2]
        pokemon = ([{"name": main, "primary": True, "association": "partner", "continuity": "game", "source": None, "notes": None}] if main else [])
        pokemon.extend({"name": name, "primary": False, "association": "companion", "continuity": "game", "source": None, "notes": None} for name in extras)
        return {
            "id": _slug(_clean_text(data.get("character_name"))),
            "display_name": _clean_text(data.get("character_name")),
            "names": [], "identity_type": "unknown", "role": _clean_text(data.get("role")), "confidence": 0.0,
            "custom_or_edited": False, "source_game": _clean_text(data.get("source_game")), "region": _clean_text(data.get("source_region")),
            "guest_book_description": _clean_text(data.get("description")),
            "availability": [{"game": _clean_text(data.get("source_game")), "badge_number": int(data.get("badge_requirement") or 0), "location": None, "notes": None}],
            "pokemon": pokemon,
            "relationships": [{"id": name, "type": None, "continuity": "game", "source": None, "notes": None} for name in _as_str_list(data.get("relationships"))[:3]],
            "canon": [],
            "dialogue": [{"context": "resort", "line": line} for line in _as_str_list(data.get("dialogue"))[:15]],
            "uncertainties": [],
        }
    identity = str(data.get("identity_type") or "unknown").strip().lower()
    if identity not in IDENTITY_TYPES:
        identity = "unknown"
    out = empty_npc_intel()
    out.update(
        {
            "id": _clean_text(data.get("id")),
            "display_name": _clean_text(data.get("display_name")),
            "names": _as_str_list(data.get("names")),
            "identity_type": identity,
            "role": _clean_text(data.get("role")),
            "confidence": _as_float(data.get("confidence"), 0.0),
            "custom_or_edited": bool(data.get("custom_or_edited")),
            "source_game": _clean_text(data.get("source_game")),
            "region": _clean_text(data.get("region")),
            "guest_book_description": _clean_text(data.get("guest_book_description")),
            "availability": _normalize_availability(data.get("availability")),
            "pokemon": _normalize_pokemon(data.get("pokemon")),
            "relationships": _normalize_relationships(data.get("relationships")),
            "canon": _normalize_canon(data.get("canon")),
            "dialogue": _normalize_dialogue(data.get("dialogue")),
            "uncertainties": _as_str_list(data.get("uncertainties")),
        }
    )
    return out


def intel_from_package(package: Dict[str, Any]) -> Dict[str, Any]:
    """Read intel from a charbin package, falling back to mirrored native fields."""
    meta = package.get("metadata") or {}
    custom = meta.get("custom") or {}
    stored = custom.get("npcIntel")
    if isinstance(stored, dict) and stored:
        return normalize_npc_intel(stored)

    intel = empty_npc_intel()
    intel["id"] = package.get("id")
    intel["display_name"] = package.get("displayName")
    intel["guest_book_description"] = meta.get("description") or ""
    intel["source_game"] = meta.get("originGame")
    intel["region"] = meta.get("region")
    intel["role"] = meta.get("role")
    if meta.get("identityType"):
        intel["identity_type"] = meta.get("identityType")

    lines = (package.get("dialogue") or {}).get("lines") or []
    intel["dialogue"] = [{"context": None, "line": str(line)} for line in lines if str(line).strip()]

    partner = meta.get("partnerPokemon")
    extras = meta.get("extraPartnerPokemon") or []
    pokemon_rows: List[Dict[str, Any]] = []
    if isinstance(partner, dict) and partner.get("pokemonId"):
        pokemon_rows.append(
            {
                "name": partner.get("pokemonId"),
                "association": "partner",
                "continuity": "game",
                "source": None,
                "notes": partner.get("nickname"),
            }
        )
    for extra in extras:
        if not isinstance(extra, dict) or not extra.get("pokemonId"):
            continue
        pokemon_rows.append(
            {
                "name": extra.get("pokemonId"),
                "association": str(extra.get("relationship") or "companion"),
                "continuity": "game",
                "source": None,
                "notes": extra.get("nickname"),
            }
        )
    intel["pokemon"] = _normalize_pokemon(pokemon_rows)

    rels = package.get("relationships")
    if isinstance(rels, list):
        intel["relationships"] = _normalize_relationships(rels)

    tags = meta.get("tags") or []
    likes = meta.get("likes") or []
    personality = meta.get("personality") or []
    intel["uncertainties"] = []
    if personality:
        intel["canon"].append(
            {"continuity": "game", "source": "charbin.personality", "facts": list(personality)}
        )
    if likes:
        intel["canon"].append({"continuity": "game", "source": "charbin.likes", "facts": list(likes)})
    if tags:
        intel["canon"].append({"continuity": "game", "source": "charbin.tags", "facts": list(tags)})
    return intel


def _partner_from_pokemon_rows(rows: List[Dict[str, Any]]) -> tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    partner: Optional[Dict[str, Any]] = None
    extras: List[Dict[str, Any]] = []
    ranked = sorted(enumerate(rows), key=lambda item: (not bool(item[1].get("primary")), item[0]))
    for _, row in ranked:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        slug = _slug(name)
        assoc = str(row.get("association") or "companion").lower()
        entry = {
            "pokemonId": slug,
            "formId": "default",
            "nickname": row.get("notes") or None,
            "relationship": assoc,
        }
        if partner is None and assoc in PARTNER_ASSOCIATIONS:
            entry["relationship"] = "main_partner"
            partner = entry
        else:
            extras.append(entry)
    return partner, extras


def _dialogue_lines(intel: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    for row in intel.get("dialogue") or []:
        if not isinstance(row, dict):
            continue
        line = str(row.get("line") or "").strip()
        if line:
            lines.append(line)
    return lines


def _personality_from_intel(intel: Dict[str, Any]) -> List[str]:
    role = str(intel.get("role") or "").strip()
    traits: List[str] = []
    if role:
        traits.append(role)
    identity = str(intel.get("identity_type") or "").strip()
    if identity and identity != "unknown":
        traits.append(identity.replace("_", " "))
    return traits


def _tags_from_intel(intel: Dict[str, Any]) -> List[str]:
    tags: List[str] = []
    region = str(intel.get("region") or "").strip()
    if region:
        tags.append(region)
    source = str(intel.get("source_game") or "").strip()
    if source:
        tags.append(source)
    for row in intel.get("availability") or []:
        loc = str((row or {}).get("location") or "").strip()
        if loc and loc not in tags:
            tags.append(loc)
    return tags


def apply_intel_to_package(
    package: Dict[str, Any],
    intel: Dict[str, Any],
    *,
    replace_id: bool = False,
) -> Dict[str, Any]:
    """Merge normalized intel into a charbin package for human NPCs."""
    normalized = normalize_npc_intel(intel)
    out = deepcopy(package)
    meta = out.setdefault("metadata", {})
    meta.setdefault("custom", {})

    display = str(normalized.get("display_name") or out.get("displayName") or out.get("id") or "").strip()
    if display:
        out["displayName"] = display

    slug = _slug(normalized.get("id") or display or out.get("id"))
    if replace_id or not out.get("id"):
        out["id"] = slug
        out["internalName"] = slug
    elif not out.get("internalName"):
        out["internalName"] = out.get("id")

    meta["characterType"] = "npc"
    meta["description"] = str(normalized.get("guest_book_description") or "").strip()
    meta["originGame"] = normalized.get("source_game") or meta.get("originGame") or ""
    meta["region"] = normalized.get("region")
    meta["role"] = normalized.get("role")
    meta["identityType"] = normalized.get("identity_type")
    meta["intelConfidence"] = normalized.get("confidence")
    meta["intelCustomOrEdited"] = bool(normalized.get("custom_or_edited"))
    meta["personality"] = _personality_from_intel(normalized)
    meta["likes"] = []
    meta["tags"] = _tags_from_intel(normalized)

    partner, extras = _partner_from_pokemon_rows(normalized.get("pokemon") or [])
    meta["partnerPokemon"] = partner
    meta["extraPartnerPokemon"] = extras

    meta["custom"]["npcIntel"] = normalized
    out["metadata"] = meta
    out["baseProfile"] = out.get("baseProfile") or "character"

    out["dialogue"] = {
        **(out.get("dialogue") or {}),
        "lines": _dialogue_lines(normalized),
        "packs": (out.get("dialogue") or {}).get("packs") or [],
        "custom": (out.get("dialogue") or {}).get("custom") or {},
    }

    rels = normalized.get("relationships") or []
    out["relationships"] = rels if isinstance(rels, list) else []

    return out


def validate_intel_for_package(intel: Dict[str, Any]) -> Dict[str, Any]:
    """Return {ok, errors[], warnings[]} for intel JSON."""
    normalized = normalize_npc_intel(intel)
    errors: List[str] = []
    warnings: List[str] = []

    slug = _slug(normalized.get("id") or normalized.get("display_name"))
    if slug and not _ID_RE.match(slug):
        warnings.append(f"id/display_name slug {slug!r} will be normalized for charbin id")

    if not str(normalized.get("display_name") or "").strip():
        errors.append("display_name is required")

    if normalized.get("identity_type") == "unknown":
        warnings.append("identity_type is unknown")

    dialogue_count = len(normalized.get("dialogue") or [])
    if not 10 <= dialogue_count <= 15:
        errors.append(f"dialogue must contain 10 to 15 lines (received {dialogue_count})")

    if normalized.get("confidence", 0) < 0.5:
        warnings.append("low confidence — review before publishing")

    return {"ok": len(errors) == 0, "errors": errors, "warnings": warnings, "intel": normalized}
