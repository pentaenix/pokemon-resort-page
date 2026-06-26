"""Parse Pokémon batch-import filenames into species id, form, modifiers, and behavior."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from spmk_app.pokemon_variant_model import (
    DEFAULT_FORM_ID,
    normalize_appearance_modifiers,
    normalize_behavior,
    normalize_form_id,
    sheet_id_for_variant,
    variant_suffix,
)

# Appearance overlays (stack on a form).
_APPEARANCE_ALIASES = {
    "shiny": "shiny",
}
_APPEARANCE_ORDER: Tuple[str, ...] = ("shiny",)

# Separate sprite sheet behaviors (not appearance modifiers).
_BEHAVIOR_ALIASES = {
    "swim": "swim",
    "swimming": "swim",
    "eating": "eating",
    "eat": "eating",
    "sleep": "sleep",
    "walk": "walk",
}
_BEHAVIOR_ORDER: Tuple[str, ...] = ("walk", "sleep", "swim", "eating")

# Folder names in sprite packs: ``base``, ``base_shiny``, ``swimming``, ``swimming_shiny``.
_FOLDER_BEHAVIOR_ALIASES = {
    "base": "walk",
    "default": "walk",
    "walk": "walk",
    "sleep": "sleep",
    "sleeping": "sleep",
    "swim": "swim",
    "swimming": "swim",
    "eating": "eating",
    "eat": "eating",
}

# Appearance / dex forms — stay on the same species charbin (not separate packages).
_FORM_TOKENS = frozenset({"female", "male", "f", "m"})

# Legacy alias map kept for UI free-text field compatibility.
_MODIFIER_ALIASES = {**_APPEARANCE_ALIASES, **_BEHAVIOR_ALIASES}
_MODIFIER_ORDER: Tuple[str, ...] = _APPEARANCE_ORDER + ("swim", "eating")


@dataclass(frozen=True)
class ParsedPokemonImport:
    """Result of parsing a sprite filename (+ optional UI fields)."""

    species_id: str
    form_key: Optional[str]  # e.g. female, 1, 42 — None = default appearance
    modifiers: Tuple[str, ...]  # appearance only, e.g. (shiny,)
    behavior: str  # walk, sleep, swim, eating
    sheet_suffix: Optional[str]  # legacy suffix after walk_, e.g. 42_shiny

    @property
    def form_id(self) -> str:
        return normalize_form_id(self.form_key)

    @property
    def sheet_id(self) -> str:
        return sheet_id_for_variant(self.form_id, self.modifiers, self.behavior)

    @property
    def is_base_walk(self) -> bool:
        return (
            self.form_id == DEFAULT_FORM_ID
            and not self.modifiers
            and self.behavior == "walk"
        )


@dataclass(frozen=True)
class BatchUploadPath:
    """Relative upload path split into species folder, variant folder, and file stem."""

    relative_path: str
    stem: str
    species_hint: Optional[str]
    variant_folder: Optional[str]

    @property
    def uses_folder_layout(self) -> bool:
        return self.variant_folder is not None


def _tokenize_stem(stem: str) -> List[str]:
    s = re.sub(r"[^a-z0-9_]+", "_", (stem or "").lower()).strip("_")
    return [t for t in s.split("_") if t]


def _canonicalize_appearance(mods: Sequence[str]) -> Tuple[str, ...]:
    return normalize_appearance_modifiers(mods)


def _canonicalize_behaviors(tokens: Sequence[str]) -> str:
    seen: set[str] = set()
    ordered: List[str] = []
    for t in tokens:
        canon = _BEHAVIOR_ALIASES.get(t, t)
        if canon in _BEHAVIOR_ALIASES.values() and canon not in seen:
            seen.add(canon)
            ordered.append(canon)
    for b in _BEHAVIOR_ORDER:
        if b in seen:
            return b
    return "walk"


def parse_animation_modifiers(raw: str) -> Tuple[str, ...]:
    """Parse legacy UI field — appearance modifiers only (shiny, etc.)."""
    if not (raw or "").strip():
        return ()
    parts = re.split(r"[\s,+/]+", raw.strip().lower())
    tokens: List[str] = []
    for p in parts:
        tokens.extend(t for t in p.split("_") if t)
    return _canonicalize_appearance(
        _APPEARANCE_ALIASES.get(t, t) for t in tokens if _APPEARANCE_ALIASES.get(t, t)
    )


def parse_batch_behavior(raw: str) -> str:
    return normalize_behavior(raw or "walk")


def parse_variant_folder_name(folder_name: str) -> Tuple[str, Tuple[str, ...]]:
    """Parse ``base_shiny`` / ``swimming`` into behavior + appearance modifiers."""
    tokens = _tokenize_stem(folder_name)
    if not tokens:
        return "walk", ()
    head = tokens[0]
    behavior_raw = _FOLDER_BEHAVIOR_ALIASES.get(head, head)
    try:
        behavior = normalize_behavior(behavior_raw)
    except ValueError:
        behavior = "walk"
    mods = _canonicalize_appearance(
        _APPEARANCE_ALIASES.get(t, t) for t in tokens[1:] if _APPEARANCE_ALIASES.get(t, t)
    )
    return behavior, mods


def looks_like_variant_folder(name: str) -> bool:
    tokens = _tokenize_stem(name)
    if not tokens:
        return False
    return tokens[0] in _FOLDER_BEHAVIOR_ALIASES


def split_batch_upload_path(filename: str) -> BatchUploadPath:
    """Split ``venusaur/base_shiny/female.png`` into folder context + stem."""
    path = (filename or "").replace("\\", "/").strip("/")
    parts = [p for p in path.split("/") if p]
    stem = Path(parts[-1]).stem if parts else Path(filename or "sprite").stem
    species_hint: Optional[str] = None
    variant_folder: Optional[str] = None
    if len(parts) >= 3:
        species_hint = parts[-3].lower()
        variant_folder = parts[-2]
    elif len(parts) == 2:
        parent = parts[-2]
        if looks_like_variant_folder(parent):
            variant_folder = parent
        else:
            species_hint = parent.lower()
    return BatchUploadPath(
        relative_path=path or filename,
        stem=stem,
        species_hint=species_hint,
        variant_folder=variant_folder,
    )


def _is_form_only_stem(stem: str, species_hint: Optional[str]) -> bool:
    if not (species_hint or "").strip():
        return False
    tokens = _tokenize_stem(stem)
    if len(tokens) != 1:
        return False
    token = tokens[0]
    hint = species_hint.strip().lower()
    if token == hint:
        return False
    if token in _FORM_TOKENS or token.isdigit():
        return True
    if len(token) == 1 and token.isalnum():
        return True
    return False


def _peel_behaviors_from_tokens(tokens: List[str]) -> Tuple[List[str], str]:
    behaviors: List[str] = []
    work = list(tokens)
    while work:
        canon = _BEHAVIOR_ALIASES.get(work[-1])
        if not canon:
            break
        behaviors.append(canon)
        work.pop()
    behavior = _canonicalize_behaviors(reversed(behaviors)) if behaviors else "walk"
    return work, behavior


def _peel_appearance_from_tokens(tokens: List[str]) -> Tuple[List[str], Tuple[str, ...]]:
    mods: List[str] = []
    work = list(tokens)
    while work:
        canon = _APPEARANCE_ALIASES.get(work[-1])
        if not canon:
            break
        mods.append(canon)
        work.pop()
    return work, _canonicalize_appearance(reversed(mods))


def _normalize_form_token(token: str) -> str:
    if token in ("f", "female"):
        return "female"
    if token in ("m", "male"):
        return "male"
    if token.isdigit():
        return str(int(token))
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
    return variant_suffix(normalize_form_id(form_key), modifiers)


def pokemon_sheet_id_for_suffix(suffix: Optional[str]) -> str:
    """Legacy walk-only sheet id from suffix string."""
    s = (suffix or "").strip().lower()
    return "walk" if not s else f"walk_{s}"


def pokemon_sheet_id_for_variant(variant: Optional[str]) -> str:
    return pokemon_sheet_id_for_suffix(variant)


def parse_variant_suffix(raw: str) -> Tuple[Optional[str], Tuple[str, ...]]:
    """Parse ``42_shiny`` suffix into form key + appearance modifiers."""
    tokens = _tokenize_stem(raw)
    tokens, mods = _peel_appearance_from_tokens(tokens)
    tokens, form_key = _extract_form(tokens)
    if tokens:
        rest = "_".join(tokens)
        form_key = f"{rest}_{form_key}" if form_key else rest
    return form_key, mods


def parse_walk_variant_label(raw: str) -> Tuple[Optional[str], Tuple[str, ...], Optional[str]]:
    tokens = _tokenize_stem(raw)
    if not tokens:
        raise ValueError("label required for walk variant")
    tokens, _behavior = _peel_behaviors_from_tokens(list(tokens))
    tokens, mods = _peel_appearance_from_tokens(tokens)
    tokens, form_key = _extract_form(tokens)
    if tokens:
        rest = "_".join(tokens)
        form_key = f"{rest}_{form_key}" if form_key else rest
    suffix = pokemon_sheet_suffix(form_key, mods)
    return form_key, mods, suffix


def parse_pokemon_import_with_context(
    stem: str,
    ui_modifiers: Optional[str] = None,
    *,
    ui_behavior: Optional[str] = None,
    species_hint: Optional[str] = None,
    variant_folder: Optional[str] = None,
) -> ParsedPokemonImport:
    """Parse filename plus optional species / variant folder context from uploads."""
    folder_behavior: Optional[str] = None
    folder_mods: Tuple[str, ...] = ()
    if variant_folder:
        folder_behavior, folder_mods = parse_variant_folder_name(variant_folder)

    hint = (species_hint or "").strip().lower() or None

    if hint and _is_form_only_stem(stem, hint):
        token = _tokenize_stem(stem)[0]
        form_key = _normalize_form_token(token)
        all_mods = _canonicalize_appearance(
            list(folder_mods) + list(parse_animation_modifiers(ui_modifiers or ""))
        )
        if ui_behavior:
            behavior = parse_batch_behavior(ui_behavior)
        else:
            behavior = folder_behavior or "walk"
        suffix = pokemon_sheet_suffix(form_key, all_mods)
        return ParsedPokemonImport(
            species_id=hint,
            form_key=form_key,
            modifiers=all_mods,
            behavior=behavior,
            sheet_suffix=suffix,
        )

    parsed = parse_pokemon_import(stem, ui_modifiers, ui_behavior=ui_behavior)
    all_mods = _canonicalize_appearance(list(folder_mods) + list(parsed.modifiers))
    if ui_behavior:
        behavior = parse_batch_behavior(ui_behavior)
    elif variant_folder and folder_behavior:
        behavior = folder_behavior
    else:
        behavior = parsed.behavior
    suffix = pokemon_sheet_suffix(parsed.form_key, all_mods)
    return ParsedPokemonImport(
        species_id=parsed.species_id,
        form_key=parsed.form_key,
        modifiers=all_mods,
        behavior=behavior,
        sheet_suffix=suffix,
    )


def parse_pokemon_import(
    stem: str,
    ui_modifiers: Optional[str] = None,
    *,
    ui_behavior: Optional[str] = None,
) -> ParsedPokemonImport:
    ui_tokens = _tokenize_stem((ui_modifiers or "").replace(" ", "_"))
    ui_tokens, ui_behavior_from_field = _peel_behaviors_from_tokens(list(ui_tokens))
    ui_mods = _canonicalize_appearance(
        _APPEARANCE_ALIASES.get(t, t) for t in ui_tokens if _APPEARANCE_ALIASES.get(t, t)
    )

    tokens = _tokenize_stem(stem)
    tokens, file_behavior_tokens = _peel_behaviors_from_tokens(tokens)
    tokens, file_mods = _peel_appearance_from_tokens(tokens)
    all_mods = _canonicalize_appearance(list(file_mods) + list(ui_mods))
    tokens, form_key = _extract_form(tokens)
    if not tokens:
        raise ValueError(f"could not determine species from filename stem {stem!r}")
    species_id = "_".join(tokens)
    if ui_behavior:
        behavior = parse_batch_behavior(ui_behavior)
    elif ui_behavior_from_field != "walk":
        behavior = ui_behavior_from_field
    else:
        behavior = file_behavior_tokens
    suffix = pokemon_sheet_suffix(form_key, all_mods)
    return ParsedPokemonImport(
        species_id=species_id,
        form_key=form_key,
        modifiers=all_mods,
        behavior=behavior,
        sheet_suffix=suffix,
    )


def merge_modifier_strings(existing: str, new: str) -> str:
    combined = _canonicalize_appearance(
        list(parse_animation_modifiers(existing)) + list(parse_animation_modifiers(new))
    )
    return " ".join(combined)
