"""Parse Pokémon batch-import filenames into species id, form, and animation modifiers."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

# Animation layers (combinable). Canonical order is used in sheet / action suffixes.
_MODIFIER_ALIASES = {
    "shiny": "shiny",
    "swim": "swim",
    "swimming": "swim",
    "eating": "eating",
    "eat": "eating",
}
_MODIFIER_ORDER: Tuple[str, ...] = ("shiny", "swim", "eating")

# Appearance / dex forms — stay on the same species charbin (not separate packages).
_FORM_TOKENS = frozenset({"female", "male", "f", "m"})


@dataclass(frozen=True)
class ParsedPokemonImport:
    """Result of parsing a sprite filename (+ optional UI modifier field)."""

    species_id: str
    form_key: Optional[str]  # e.g. female, 1, 42 — None = default appearance
    modifiers: Tuple[str, ...]  # e.g. (shiny, swim)
    sheet_suffix: Optional[str]  # e.g. 42_shiny_swim — None = base walk only

    @property
    def sheet_id(self) -> str:
        return pokemon_sheet_id_for_suffix(self.sheet_suffix)

    @property
    def is_base_walk(self) -> bool:
        return self.sheet_suffix is None


def _tokenize_stem(stem: str) -> List[str]:
    s = re.sub(r"[^a-z0-9_]+", "_", (stem or "").lower()).strip("_")
    return [t for t in s.split("_") if t]


def _canonicalize_modifiers(mods: Sequence[str]) -> Tuple[str, ...]:
    seen: set[str] = set()
    ordered: List[str] = []
    for m in mods:
        canon = _MODIFIER_ALIASES.get(m, m)
        if canon in _MODIFIER_ALIASES.values() and canon not in seen:
            seen.add(canon)
            ordered.append(canon)
    return tuple(m for m in _MODIFIER_ORDER if m in seen)


def parse_animation_modifiers(raw: str) -> Tuple[str, ...]:
    """Parse UI field: ``shiny swim``, ``shiny_swimming eating``, etc."""
    if not (raw or "").strip():
        return ()
    parts = re.split(r"[\s,+/]+", raw.strip().lower())
    tokens = []
    for p in parts:
        tokens.extend(t for t in p.split("_") if t)
    return _canonicalize_modifiers(tokens)


def _peel_modifiers_from_tokens(tokens: List[str]) -> Tuple[List[str], Tuple[str, ...]]:
    mods: List[str] = []
    work = list(tokens)
    while work:
        canon = _MODIFIER_ALIASES.get(work[-1])
        if not canon:
            break
        mods.append(canon)
        work.pop()
    return work, _canonicalize_modifiers(reversed(mods))


def _normalize_form_token(token: str) -> str:
    if token in ("f", "female"):
        return "female"
    if token in ("m", "male"):
        return "male"
    if token.isdigit():
        return str(int(token))  # 042 → 42 for stable keys
    return token


def _extract_form(tokens: List[str]) -> Tuple[List[str], Optional[str]]:
    if len(tokens) <= 1:
        return tokens, None
    last = tokens[-1]
    if last in _FORM_TOKENS:
        return tokens[:-1], _normalize_form_token(last)
    if last.isdigit():
        return tokens[:-1], _normalize_form_token(last)
    return tokens, None


def pokemon_sheet_suffix(form_key: Optional[str], modifiers: Sequence[str]) -> Optional[str]:
    parts: List[str] = []
    if form_key and form_key != "default":
        parts.append(form_key)
    parts.extend(m for m in _MODIFIER_ORDER if m in modifiers)
    return "_".join(parts) if parts else None


def pokemon_sheet_id_for_suffix(suffix: Optional[str]) -> str:
    s = (suffix or "").strip().lower()
    return "walk" if not s else f"walk_{s}"


def pokemon_sheet_id_for_variant(variant: Optional[str]) -> str:
    """Backward-compatible alias (variant = full sheet suffix after ``walk_``)."""
    return pokemon_sheet_id_for_suffix(variant)


def parse_walk_variant_label(raw: str) -> Tuple[Optional[str], Tuple[str, ...], Optional[str]]:
    """
  Parse a UI label (no species prefix) into form, modifiers, and sheet suffix.

  ``female`` → form ``female``, suffix ``female``.
  ``shiny swim`` → modifiers only, suffix ``shiny_swim``.
  ``42 shiny`` → form ``42``, modifiers ``shiny``, suffix ``42_shiny``.
  """
    tokens = _tokenize_stem(raw)
    if not tokens:
        raise ValueError("label required for walk variant")
    tokens, mods = _peel_modifiers_from_tokens(list(tokens))
    tokens, form_key = _extract_form(tokens)
    if tokens:
        rest = "_".join(tokens)
        form_key = f"{rest}_{form_key}" if form_key else rest
    suffix = pokemon_sheet_suffix(form_key, mods)
    return form_key, mods, suffix


def parse_pokemon_import(stem: str, ui_modifiers: Optional[str] = None) -> ParsedPokemonImport:
    """
    ``GARCHOMP_female`` → species ``garchomp``, form ``female``.
    ``ARCEUS_1`` → species ``arceus``, form ``1``.
    ``ALCREMIE_42_shiny_swim`` → species ``alcremie``, form ``42``, modifiers shiny+swim.
    UI modifiers apply on top of filename (e.g. ``ALCREMIE_5`` + ``shiny swim``).
    """
    tokens = _tokenize_stem(stem)
    tokens, file_mods = _peel_modifiers_from_tokens(tokens)
    ui_mods = parse_animation_modifiers(ui_modifiers or "")
    all_mods = _canonicalize_modifiers(list(file_mods) + list(ui_mods))
    tokens, form_key = _extract_form(tokens)
    if not tokens:
        raise ValueError(f"could not determine species from filename stem {stem!r}")
    species_id = "_".join(tokens)
    suffix = pokemon_sheet_suffix(form_key, all_mods)
    return ParsedPokemonImport(
        species_id=species_id,
        form_key=form_key,
        modifiers=all_mods,
        sheet_suffix=suffix,
    )


def merge_modifier_strings(existing: str, new: str) -> str:
    """Combine modifier lists for display (sorted canonical)."""
    combined = _canonicalize_modifiers(
        list(parse_animation_modifiers(existing)) + list(parse_animation_modifiers(new))
    )
    return " ".join(combined)
