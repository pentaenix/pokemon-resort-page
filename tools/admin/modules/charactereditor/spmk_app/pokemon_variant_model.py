"""Structured Pokémon forms, appearance modifiers, and behaviors for .charbin packages."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

DEFAULT_FORM_ID = "default"

APPEARANCE_MODIFIERS: Tuple[str, ...] = ("shiny",)
APPEARANCE_MODIFIER_ORDER: Tuple[str, ...] = ("shiny", "female", "male")

POKEMON_BEHAVIORS: Tuple[str, ...] = ("idle", "walk", "sleep", "swim", "eating")
SHEET_BEHAVIORS: Tuple[str, ...] = ("walk", "sleep", "swim", "eating")

FORM_KINDS: Tuple[str, ...] = ("default", "indexed", "named", "regional", "decoration")

_BEHAVIOR_ANIM = {
    "idle": "walk",
    "walk": "walk",
    "sleep": "sleep",
    "swim": "swim",
    "eating": "eating",
}


def normalize_form_id(raw: Optional[str]) -> str:
    if raw is None or str(raw).strip() == "":
        return DEFAULT_FORM_ID
    return str(raw).strip().lower()


def normalize_appearance_modifiers(mods: Sequence[str]) -> Tuple[str, ...]:
    seen: Set[str] = set()
    ordered: List[str] = []
    for m in mods:
        key = str(m or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return tuple(m for m in APPEARANCE_MODIFIER_ORDER if m in seen) + tuple(
        m for m in ordered if m not in APPEARANCE_MODIFIER_ORDER
    )


def normalize_behavior(raw: str) -> str:
    behavior = (raw or "walk").strip().lower()
    if behavior in SHEET_BEHAVIORS:
        return behavior
    if behavior == "idle":
        return "walk"
    raise ValueError(f"unsupported pokemon behavior {raw!r}")


def variant_suffix(form_id: str, modifiers: Sequence[str]) -> Optional[str]:
    parts: List[str] = []
    fid = normalize_form_id(form_id)
    if fid != DEFAULT_FORM_ID:
        parts.append(fid)
    parts.extend(normalize_appearance_modifiers(modifiers))
    return "_".join(parts) if parts else None


def sheet_id_for_variant(form_id: str, modifiers: Sequence[str], behavior: str) -> str:
    behavior = normalize_behavior(behavior)
    suffix = variant_suffix(form_id, modifiers)
    if behavior == "walk":
        return "walk" if not suffix else f"walk_{suffix}"
    if behavior == "sleep":
        return "sleep" if not suffix else f"sleep_{suffix}"
    return behavior if not suffix else f"{behavior}_{suffix}"


def walk_sheet_id_for_variant(form_id: str, modifiers: Sequence[str]) -> str:
    return sheet_id_for_variant(form_id, modifiers, "walk")


def action_id_for_variant(form_id: str, modifiers: Sequence[str], behavior: str) -> str:
    b = (behavior or "walk").strip().lower()
    fid = normalize_form_id(form_id)
    mods = normalize_appearance_modifiers(modifiers)
    if b == "idle":
        if fid == DEFAULT_FORM_ID and not mods:
            return "idle"
        suffix = variant_suffix(fid, mods)
        return f"idle_{suffix}" if suffix else "idle"
    if b == "walk":
        if fid == DEFAULT_FORM_ID and not mods:
            return "walk"
        suffix = variant_suffix(fid, mods)
        return f"walk_{suffix}" if suffix else "walk"
    suffix = variant_suffix(fid, mods)
    if b == "sleep":
        return "sleep" if not suffix else f"sleep_{suffix}"
    return b if not suffix else f"{b}_{suffix}"


def pokemon_variant_block(package: Dict[str, Any]) -> Dict[str, Any]:
    meta = package.get("metadata") or {}
    block = meta.get("pokemonVariant")
    return block if isinstance(block, dict) else {}


def ensure_pokemon_variant_block(package: Dict[str, Any]) -> Dict[str, Any]:
    out = deepcopy(package)
    meta = out.setdefault("metadata", {})
    block = meta.get("pokemonVariant")
    if not isinstance(block, dict):
        block = {}
    block.setdefault("formKind", "default")
    block.setdefault("defaultFormId", DEFAULT_FORM_ID)
    block.setdefault("forms", [])
    block.setdefault("modifierDefs", [{"id": "shiny", "name": "Shiny"}])
    block.setdefault(
        "behaviorDefs",
        [
            {"id": "idle", "movementDriven": False, "usesWalkSheet": True},
            {"id": "walk", "movementDriven": True},
            {"id": "sleep", "southOnly": True},
            {"id": "swim", "movementDriven": True},
            {"id": "eating", "movementDriven": False},
        ],
    )
    meta["pokemonVariant"] = block
    return out


def _form_entry(form_id: str, name: str = "") -> Dict[str, Any]:
    fid = normalize_form_id(form_id)
    label = name.strip() or (fid if fid != DEFAULT_FORM_ID else "Default")
    return {"id": fid, "name": label}


def register_pokemon_form(
    package: Dict[str, Any],
    form_id: str,
    *,
    name: str = "",
    form_kind: Optional[str] = None,
) -> Dict[str, Any]:
    out = ensure_pokemon_variant_block(package)
    block = out["metadata"]["pokemonVariant"]
    fid = normalize_form_id(form_id)
    forms: List[Dict[str, Any]] = list(block.get("forms") or [])
    if not any(f.get("id") == fid for f in forms):
        forms.append(_form_entry(fid, name))
    forms.sort(key=lambda f: (f.get("id") != block.get("defaultFormId", DEFAULT_FORM_ID), f.get("id") or ""))
    block["forms"] = forms
    if form_kind:
        block["formKind"] = form_kind
    return out


def register_pokemon_modifier_def(
    package: Dict[str, Any], modifier_id: str, *, name: str = ""
) -> Dict[str, Any]:
    out = ensure_pokemon_variant_block(package)
    block = out["metadata"]["pokemonVariant"]
    mid = str(modifier_id or "").strip().lower()
    if not mid:
        return out
    defs_list: List[Dict[str, Any]] = list(block.get("modifierDefs") or [])
    if not any(d.get("id") == mid for d in defs_list):
        defs_list.append({"id": mid, "name": name.strip() or mid.title()})
    block["modifierDefs"] = defs_list
    return out


def sheet_display_name(form_id: str, modifiers: Sequence[str], behavior: str) -> str:
    fid = normalize_form_id(form_id)
    mods = normalize_appearance_modifiers(modifiers)
    behavior = normalize_behavior(behavior)
    bits: List[str] = []
    if fid != DEFAULT_FORM_ID:
        bits.append(f"form {fid}")
    if mods:
        bits.append(" ".join(mods))
    title = behavior.replace("_", " ").title()
    if not bits:
        return title
    return f"{title} ({', '.join(bits)})"


def attach_variant_fields(
    sheet: Dict[str, Any],
    *,
    form_id: str,
    modifiers: Sequence[str],
    behavior: str,
) -> Dict[str, Any]:
    out = dict(sheet)
    fid = normalize_form_id(form_id)
    mods = list(normalize_appearance_modifiers(modifiers))
    behavior = normalize_behavior(behavior)
    out["formId"] = fid
    out["modifiers"] = mods
    out["behavior"] = behavior
    return out


def pokemon_action(
    form_id: str,
    modifiers: Sequence[str],
    behavior: str,
    *,
    sheet_id: str,
) -> Dict[str, Any]:
    b = (behavior or "walk").strip().lower()
    anim = _BEHAVIOR_ANIM.get(b, b)
    movement = b in ("walk", "swim")
    return {
        "id": action_id_for_variant(form_id, modifiers, b),
        "formId": normalize_form_id(form_id),
        "modifiers": list(normalize_appearance_modifiers(modifiers)),
        "behavior": b,
        "type": "movement" if movement else "idle",
        "sheetId": sheet_id,
        "animationName": anim,
        "movementDriven": movement,
    }


def stance_action_id(form_id: str, modifiers: Sequence[str], sheet_behavior: str) -> str:
    """Standing pose action id for a sheet behavior (walk → ``idle``, swim → ``idle_swim``)."""
    if sheet_behavior == "walk":
        return action_id_for_variant(form_id, modifiers, "idle")
    suffix = variant_suffix(form_id, modifiers)
    base = f"idle_{sheet_behavior}"
    return base if not suffix else f"{base}_{suffix}"


def pokemon_stance_action(
    form_id: str,
    modifiers: Sequence[str],
    sheet_behavior: str,
    sheet_id: str,
) -> Dict[str, Any]:
    """Hold frame 0 on the same sheet as movement (walk idle, swim idle, …)."""
    anim = _BEHAVIOR_ANIM.get(sheet_behavior, sheet_behavior)
    return {
        "id": stance_action_id(form_id, modifiers, sheet_behavior),
        "formId": normalize_form_id(form_id),
        "modifiers": list(normalize_appearance_modifiers(modifiers)),
        "behavior": "idle",
        "sheetBehavior": sheet_behavior,
        "type": "idle",
        "sheetId": sheet_id,
        "animationName": anim,
        "movementDriven": False,
    }


def pokemon_idle_action(form_id: str, modifiers: Sequence[str], walk_sheet_id: str) -> Dict[str, Any]:
    return {
        "id": action_id_for_variant(form_id, modifiers, "idle"),
        "formId": normalize_form_id(form_id),
        "modifiers": list(normalize_appearance_modifiers(modifiers)),
        "behavior": "idle",
        "sheetBehavior": "walk",
        "type": "idle",
        "sheetId": walk_sheet_id,
        "animationName": "walk",
        "movementDriven": False,
    }


def pokemon_walk_action(form_id: str, modifiers: Sequence[str], walk_sheet_id: str) -> Dict[str, Any]:
    return {
        "id": action_id_for_variant(form_id, modifiers, "walk"),
        "formId": normalize_form_id(form_id),
        "modifiers": list(normalize_appearance_modifiers(modifiers)),
        "behavior": "walk",
        "sheetBehavior": "walk",
        "type": "movement",
        "sheetId": walk_sheet_id,
        "animationName": "walk",
        "movementDriven": True,
    }


def pokemon_sleep_action(form_id: str, modifiers: Sequence[str], sleep_sheet_id: str) -> Dict[str, Any]:
    return {
        "id": action_id_for_variant(form_id, modifiers, "sleep"),
        "formId": normalize_form_id(form_id),
        "modifiers": list(normalize_appearance_modifiers(modifiers)),
        "behavior": "sleep",
        "sheetBehavior": "sleep",
        "type": "idle",
        "sheetId": sleep_sheet_id,
        "animationName": "sleep",
        "movementDriven": False,
    }


def pokemon_behavior_action(
    form_id: str,
    modifiers: Sequence[str],
    behavior: str,
    sheet_id: str,
) -> Dict[str, Any]:
    behavior = normalize_behavior(behavior)
    if behavior == "walk":
        return pokemon_walk_action(form_id, modifiers, sheet_id)
    if behavior == "sleep":
        return pokemon_sleep_action(form_id, modifiers, sheet_id)
    movement = behavior == "swim"
    return {
        "id": action_id_for_variant(form_id, modifiers, behavior),
        "formId": normalize_form_id(form_id),
        "modifiers": list(normalize_appearance_modifiers(modifiers)),
        "behavior": behavior,
        "sheetBehavior": behavior,
        "type": "movement" if movement else "idle",
        "sheetId": sheet_id,
        "animationName": behavior,
        "movementDriven": movement,
    }


def actions_for_sheet_import(
    form_id: str,
    modifiers: Sequence[str],
    behavior: str,
    sheet_id: str,
) -> List[Dict[str, Any]]:
    behavior = normalize_behavior(behavior)
    if behavior == "walk":
        return [
            pokemon_idle_action(form_id, modifiers, sheet_id),
            pokemon_walk_action(form_id, modifiers, sheet_id),
        ]
    if behavior in ("swim", "eating"):
        return [
            pokemon_stance_action(form_id, modifiers, behavior, sheet_id),
            pokemon_behavior_action(form_id, modifiers, behavior, sheet_id),
        ]
    return [pokemon_behavior_action(form_id, modifiers, behavior, sheet_id)]


def action_ids_for_sheet_import(
    form_id: str, modifiers: Sequence[str], behavior: str
) -> Set[str]:
    behavior = normalize_behavior(behavior)
    if behavior == "walk":
        return {
            action_id_for_variant(form_id, modifiers, "idle"),
            action_id_for_variant(form_id, modifiers, "walk"),
        }
    if behavior in ("swim", "eating"):
        return {
            stance_action_id(form_id, modifiers, behavior),
            action_id_for_variant(form_id, modifiers, behavior),
        }
    return {action_id_for_variant(form_id, modifiers, behavior)}


def sync_sheet_variant_fields(sheet: Dict[str, Any]) -> Dict[str, Any]:
    """Fill formId/modifiers/behavior from legacy sheet ids when missing."""
    out = dict(sheet)
    if out.get("formId") and out.get("behavior"):
        out["formId"] = normalize_form_id(out.get("formId"))
        out["modifiers"] = list(normalize_appearance_modifiers(out.get("modifiers") or []))
        out["behavior"] = normalize_behavior(str(out.get("behavior")))
        return out
    sid = str(out.get("id") or "")
    if sid == "walk":
        out.update(formId=DEFAULT_FORM_ID, modifiers=[], behavior="walk")
    elif sid.startswith("walk_"):
        from spmk_app.pokemon_batch_parse import parse_variant_suffix

        form_key, mods = parse_variant_suffix(sid[5:])
        out.update(
            formId=normalize_form_id(form_key),
            modifiers=list(mods),
            behavior="walk",
        )
    elif sid == "sleep":
        out.update(formId=DEFAULT_FORM_ID, modifiers=[], behavior="sleep")
    elif sid.startswith("sleep_"):
        from spmk_app.pokemon_batch_parse import parse_variant_suffix

        form_key, mods = parse_variant_suffix(sid[6:])
        out.update(
            formId=normalize_form_id(form_key),
            modifiers=list(mods),
            behavior="sleep",
        )
    elif "_" in sid:
        head, rest = sid.split("_", 1)
        if head in SHEET_BEHAVIORS:
            from spmk_app.pokemon_batch_parse import parse_variant_suffix

            form_key, mods = parse_variant_suffix(rest)
            out.update(
                formId=normalize_form_id(form_key),
                modifiers=list(mods),
                behavior=head,
            )
    return out


def sync_action_variant_fields(action: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(action)
    if out.get("formId") is not None and out.get("behavior"):
        out["formId"] = normalize_form_id(out.get("formId"))
        out["modifiers"] = list(normalize_appearance_modifiers(out.get("modifiers") or []))
        return out
    aid = str(out.get("id") or "")
    if aid in ("idle", "walk", "pause"):
        behavior = aid if aid != "pause" else "idle"
        sheet_behavior = "walk" if behavior in ("idle", "walk", "pause") else behavior
        out.update(formId=DEFAULT_FORM_ID, modifiers=[], behavior=behavior, sheetBehavior=sheet_behavior)
        return out
    for sheet_beh in ("swim", "eating"):
        solo = f"idle_{sheet_beh}"
        if aid == solo:
            out.update(formId=DEFAULT_FORM_ID, modifiers=[], behavior="idle", sheetBehavior=sheet_beh)
            return out
        prefix = f"{solo}_"
        if aid.startswith(prefix):
            from spmk_app.pokemon_batch_parse import parse_variant_suffix

            form_key, mods = parse_variant_suffix(aid[len(prefix) :])
            out.update(
                formId=normalize_form_id(form_key),
                modifiers=list(mods),
                behavior="idle",
                sheetBehavior=sheet_beh,
            )
            return out
    for prefix, behavior in (
        ("idle_", "idle"),
        ("walk_", "walk"),
        ("pause_", "idle"),
        ("sleep_", "sleep"),
        ("swim_", "swim"),
        ("eating_", "eating"),
    ):
        if aid.startswith(prefix):
            from spmk_app.pokemon_batch_parse import parse_variant_suffix

            form_key, mods = parse_variant_suffix(aid[len(prefix) :])
            sheet_behavior = "walk" if behavior in ("idle", "walk") else behavior
            out.update(
                formId=normalize_form_id(form_key),
                modifiers=list(mods),
                behavior=behavior,
                sheetBehavior=sheet_behavior,
            )
            return out
    if aid in ("swim", "sleep", "eating"):
        out.update(formId=DEFAULT_FORM_ID, modifiers=[], behavior=aid, sheetBehavior=aid)
    return out


def migrate_package_variant_model(package: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure pokemonVariant metadata and per-sheet/action variant fields."""
    if not (package.get("metadata") or {}).get("characterType") == "pokemon":
        return package
    out = ensure_pokemon_variant_block(package)
    sheets = []
    for sheet in out.get("spriteSheets") or []:
        synced = sync_sheet_variant_fields(sheet)
        sheets.append(synced)
        register_pokemon_form(out, synced.get("formId") or DEFAULT_FORM_ID)
        for mod in synced.get("modifiers") or []:
            register_pokemon_modifier_def(out, mod)
    out["spriteSheets"] = sheets
    actions = [sync_action_variant_fields(a) for a in (out.get("actions") or [])]
    out["actions"] = actions
    return out


def list_pokemon_forms(package: Dict[str, Any]) -> List[Dict[str, Any]]:
    block = pokemon_variant_block(package)
    forms = block.get("forms") or []
    if forms:
        return list(forms)
    custom = (package.get("metadata") or {}).get("custom") or {}
    ids = custom.get("overworldFormIds") or []
    if ids:
        return [_form_entry(fid) for fid in ids]
    return [_form_entry(DEFAULT_FORM_ID)]


def list_modifier_defs(package: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(pokemon_variant_block(package).get("modifierDefs") or [])


def variant_matrix_summary(package: Dict[str, Any]) -> Dict[str, Any]:
    """Counts forms × modifier combos × behaviors present in sheets."""
    forms: Set[str] = set()
    combos: Set[Tuple[str, Tuple[str, ...]]] = set()
    behaviors: Set[str] = set()
    for sheet in package.get("spriteSheets") or []:
        if not sheet.get("assetId"):
            continue
        synced = sync_sheet_variant_fields(sheet)
        fid = normalize_form_id(synced.get("formId"))
        mods = tuple(normalize_appearance_modifiers(synced.get("modifiers") or []))
        behavior = str(synced.get("behavior") or "walk")
        forms.add(fid)
        combos.add((fid, mods))
        behaviors.add(behavior)
    return {
        "formCount": len(forms),
        "variantCombos": len(combos),
        "behaviors": sorted(behaviors),
        "actionCount": len(package.get("actions") or []),
    }
