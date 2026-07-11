"""Object library categories (grouping in the character editor)."""
from __future__ import annotations

from typing import Any, Dict, List

OBJECT_CATEGORIES: List[Dict[str, str]] = [
    {"id": "interactables", "label": "Interactables"},
    {"id": "animations", "label": "Animations"},
    {"id": "ui", "label": "UI"},
    {"id": "others", "label": "Others"},
]

_OBJECT_CATEGORY_IDS = {row["id"] for row in OBJECT_CATEGORIES}
DEFAULT_OBJECT_CATEGORY = "others"


def normalize_object_category(value: Any) -> str:
    """Return a known category id; unknown values map to ``others``."""
    key = str(value or "").strip().lower().replace(" ", "_")
    if key in _OBJECT_CATEGORY_IDS:
        return key
    return DEFAULT_OBJECT_CATEGORY


def object_category_label(category_id: str) -> str:
    cid = normalize_object_category(category_id)
    for row in OBJECT_CATEGORIES:
        if row["id"] == cid:
            return row["label"]
    return "Others"
