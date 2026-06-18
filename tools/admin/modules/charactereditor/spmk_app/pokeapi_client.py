"""PokéAPI lookup and fuzzy name suggestions for Pokémon packages."""
from __future__ import annotations

import difflib
import json
import re
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

_BASE = "https://pokeapi.co/api/v2"
_CACHE_TTL_S = 3600
_name_cache: Dict[str, Any] = {"at": 0.0, "names": []}
_item_name_cache: Dict[str, Any] = {"at": 0.0, "names": []}


def _get_json(url: str, timeout: float = 12.0) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "SPMK/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _named_en(entries: List[Dict[str, Any]], field: str = "name") -> str:
    for block in entries or []:
        if (block.get("language") or {}).get("name") == "en":
            val = (block.get(field) or block.get("name") or "").strip()
            if val:
                return val
    return ""


def _resource_name(obj: Any) -> str:
    if not obj:
        return ""
    if isinstance(obj, dict):
        return (obj.get("name") or "").strip()
    return ""


def _evolution_chain_id(url: str) -> Optional[int]:
    m = re.search(r"/evolution-chain/(\d+)/?", url or "")
    return int(m.group(1)) if m else None


def _all_pokemon_names() -> List[str]:
    now = time.time()
    if _name_cache.get("names") and now - float(_name_cache.get("at") or 0) < _CACHE_TTL_S:
        return list(_name_cache["names"])
    names: List[str] = []
    offset = 0
    while True:
        data = _get_json(f"{_BASE}/pokemon?limit=200&offset={offset}")
        for row in data.get("results") or []:
            n = (row.get("name") or "").strip().lower()
            if n:
                names.append(n)
        if not data.get("next"):
            break
        offset += 200
    _name_cache["names"] = names
    _name_cache["at"] = now
    return names


def slug_from_filename_stem(stem: str) -> str:
    """Package id from filename stem (e.g. ``PSYDUCK`` → ``psyduck``)."""
    s = re.sub(r"[^a-z0-9_]+", "_", (stem or "").lower().strip())
    return s.strip("_") or "asset"


def pokeapi_slug_from_stem(stem: str) -> str:
    """PokéAPI slug: ``master_ball`` → ``master-ball``."""
    return (stem or "").lower().strip().replace("_", "-").replace(" ", "-")


def _all_item_names() -> List[str]:
    now = time.time()
    if _item_name_cache.get("names") and now - float(_item_name_cache.get("at") or 0) < _CACHE_TTL_S:
        return list(_item_name_cache["names"])
    names: List[str] = []
    offset = 0
    while True:
        data = _get_json(f"{_BASE}/item?limit=200&offset={offset}")
        for row in data.get("results") or []:
            n = (row.get("name") or "").strip().lower()
            if n:
                names.append(n)
        if not data.get("next"):
            break
        offset += 200
    _item_name_cache["names"] = names
    _item_name_cache["at"] = now
    return names


def suggest_item_name(query: str, n: int = 3) -> Optional[str]:
    q = pokeapi_slug_from_stem(query)
    if not q:
        return None
    names = _all_item_names()
    if q in names:
        return q
    hits = difflib.get_close_matches(q, names, n=n, cutoff=0.55)
    return hits[0] if hits else None


def _effect_en_item(item: Dict[str, Any]) -> Dict[str, str]:
    for block in item.get("effect_entries") or []:
        if (block.get("language") or {}).get("name") == "en":
            return {
                "effect": (block.get("effect") or "").strip(),
                "short_effect": (block.get("short_effect") or "").strip(),
            }
    return {"effect": "", "short_effect": ""}


def _flavor_en_item(item: Dict[str, Any]) -> str:
    for block in item.get("flavor_text_entries") or []:
        if (block.get("language") or {}).get("name") == "en":
            text = (block.get("text") or "").replace("\n", " ").replace("\f", " ").strip()
            if text:
                return text
    return ""


def build_item_api_snapshot(item: Dict[str, Any], slug: str) -> Dict[str, Any]:
    effects = _effect_en_item(item)
    return {
        "kind": "item",
        "fetchedAt": int(time.time() * 1000),
        "slug": slug,
        "itemId": item.get("id"),
        "pokeapiItemUrl": f"{_BASE}/item/{slug}",
        "category": _resource_name(item.get("category")),
        "cost": int(item.get("cost") or 0),
        "attributes": [_resource_name(a) for a in (item.get("attributes") or []) if _resource_name(a)],
        "flingPower": item.get("fling_power"),
        "flingEffect": _resource_name(item.get("fling_effect")),
        "shortEffect": effects["short_effect"],
        "effect": effects["effect"],
        "flavorText": _flavor_en_item(item),
        "heldByPokemonCount": len(item.get("held_by_pokemon") or []),
    }


def build_item_fill_payload(item: Dict[str, Any], slug: str) -> Dict[str, Any]:
    en_name = _named_en(item.get("names") or []) or slug.replace("-", " ").title()
    return {
        "id": slug_from_filename_stem(slug.replace("-", "_")),
        "displayName": en_name,
        "internalName": slug.replace("-", "_"),
        "category": _resource_name(item.get("category")),
        "description": _flavor_en_item(item) or _effect_en_item(item)["short_effect"],
        "itemApi": build_item_api_snapshot(item, slug),
    }


def lookup_item(query: str) -> Dict[str, Any]:
    """Resolve item by name; returns found flag, optional suggestion, and fill payload."""
    raw = (query or "").strip()
    slug = pokeapi_slug_from_stem(raw)
    if not slug:
        return {"found": False, "query": raw, "suggestion": None, "data": None}

    names = _all_item_names()
    if slug not in names:
        suggestion = suggest_item_name(slug)
        return {"found": False, "query": raw, "suggestion": suggestion, "data": None}

    try:
        item = _get_json(f"{_BASE}/item/{slug}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            suggestion = suggest_item_name(slug)
            return {"found": False, "query": raw, "suggestion": suggestion, "data": None}
        raise

    data = build_item_fill_payload(item, slug)
    return {"found": True, "query": raw, "suggestion": None, "data": data}


def suggest_pokemon_name(query: str, n: int = 3) -> Optional[str]:
    q = (query or "").strip().lower().replace(" ", "-")
    if not q:
        return None
    names = _all_pokemon_names()
    if q in names:
        return q
    hits = difflib.get_close_matches(q, names, n=n, cutoff=0.55)
    return hits[0] if hits else None


def _flavor_en(species: Dict[str, Any]) -> str:
    for block in species.get("flavor_text_entries") or []:
        if (block.get("language") or {}).get("name") == "en":
            text = (block.get("flavor_text") or "").replace("\n", " ").replace("\f", " ").strip()
            if text:
                return text
    return ""


def _origin_game(species: Dict[str, Any]) -> str:
    for block in species.get("genera") or []:
        if (block.get("language") or {}).get("name") == "en":
            return (block.get("genus") or "").strip()
    return ""


def build_pokeapi_snapshot(pokemon: Dict[str, Any], species: Dict[str, Any], slug: str) -> Dict[str, Any]:
    """Rich species snapshot stored in charbin metadata.pokeapi (no refetch needed)."""
    dex = species.get("id") or pokemon.get("id")
    stats: Dict[str, int] = {}
    for row in pokemon.get("stats") or []:
        key = (row.get("stat") or {}).get("name") or ""
        if key:
            stats[key] = int(row.get("base_stat") or 0)

    abilities: List[Dict[str, Any]] = []
    for row in pokemon.get("abilities") or []:
        aname = _resource_name(row.get("ability"))
        if aname:
            abilities.append(
                {
                    "id": aname,
                    "name": aname.replace("-", " ").title(),
                    "isHidden": bool(row.get("is_hidden")),
                    "slot": int(row.get("slot") or 0),
                }
            )

    return {
        "fetchedAt": int(time.time() * 1000),
        "slug": slug,
        "speciesId": dex,
        "pokeapiPokemonUrl": f"{_BASE}/pokemon/{slug}",
        "pokeapiSpeciesUrl": (species.get("url") or f"{_BASE}/pokemon-species/{dex}"),
        "generation": _resource_name(species.get("generation")),
        "color": _resource_name(species.get("color")),
        "shape": _resource_name(species.get("shape")),
        "habitat": _resource_name(species.get("habitat")),
        "eggGroups": [_resource_name(g) for g in (species.get("egg_groups") or []) if _resource_name(g)],
        "growthRate": _resource_name(species.get("growth_rate")),
        "captureRate": int(species.get("capture_rate") or 0),
        "baseHappiness": int(species.get("base_happiness") or 0),
        "genderRate": int(species.get("gender_rate") if species.get("gender_rate") is not None else -1),
        "isLegendary": bool(species.get("is_legendary")),
        "isMythical": bool(species.get("is_mythical")),
        "isBaby": bool(species.get("is_baby")),
        "height": int(pokemon.get("height") or 0),
        "weight": int(pokemon.get("weight") or 0),
        "baseExperience": int(pokemon.get("base_experience") or 0),
        "baseStats": stats,
        "abilities": abilities,
        "evolutionChainId": _evolution_chain_id((species.get("evolution_chain") or {}).get("url") or ""),
    }


def sanitize_pokeapi_snapshot(snapshot: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Drop image URLs / sprite blobs; keep text and numeric species data only."""
    if not snapshot or not isinstance(snapshot, dict):
        return snapshot
    out = dict(snapshot)
    out.pop("sprites", None)
    return out


def build_pokemon_fill_payload(pokemon: Dict[str, Any], species: Dict[str, Any], slug: str) -> Dict[str, Any]:
    dex = species.get("id") or pokemon.get("id")
    en_name = _named_en(species.get("names") or []) or slug.replace("-", " ").title()

    types = [t.get("type", {}).get("name", "") for t in pokemon.get("types") or []]
    forms = [{"id": "default", "name": "Default"}]
    for v in species.get("varieties") or []:
        if not v.get("is_default"):
            fname = ((v.get("pokemon") or {}).get("name") or "").strip()
            if fname and fname != slug:
                label = fname.replace(slug, "").strip("-").title() or fname
                forms.append({"id": fname, "name": label})

    return {
        "id": slug,
        "displayName": en_name,
        "internalName": slug,
        "pokemonId": dex,
        "speciesName": en_name,
        "types": [t for t in types if t],
        "forms": forms,
        "selectedFormId": "default",
        "originGame": _origin_game(species),
        "pokedexEntry": _flavor_en(species),
        "pokeapi": build_pokeapi_snapshot(pokemon, species, slug),
    }


def lookup_pokemon_for_import(species_stem: str) -> Tuple[Dict[str, Any], str]:
    """
    Resolve PokéAPI data for batch import / autofill.

    Tries the filename stem slug first (``hooh``), then the fuzzy suggestion
    (``ho-oh``) — same behavior as the UI Fetch button.
    """
    slug = pokeapi_slug_from_stem(species_stem)
    lookup = lookup_pokemon(slug)
    if lookup.get("found"):
        return lookup, slug
    suggestion = lookup.get("suggestion")
    if suggestion:
        retry = lookup_pokemon(suggestion)
        if retry.get("found"):
            return retry, suggestion
    return lookup, slug


def lookup_pokemon(query: str) -> Dict[str, Any]:
    """Resolve species by name; returns found flag, optional suggestion, and fill payload."""
    raw = (query or "").strip()
    slug = raw.lower().replace(" ", "-")
    if not slug:
        return {"found": False, "query": raw, "suggestion": None, "data": None}

    names = _all_pokemon_names()
    if slug not in names:
        suggestion = suggest_pokemon_name(slug)
        return {
            "found": False,
            "query": raw,
            "suggestion": suggestion,
            "data": None,
        }

    try:
        pokemon = _get_json(f"{_BASE}/pokemon/{slug}")
        species = _get_json((pokemon.get("species") or {}).get("url") or f"{_BASE}/pokemon-species/{slug}")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            suggestion = suggest_pokemon_name(slug)
            return {"found": False, "query": raw, "suggestion": suggestion, "data": None}
        raise

    data = build_pokemon_fill_payload(pokemon, species, slug)
    return {"found": True, "query": raw, "suggestion": None, "data": data}
