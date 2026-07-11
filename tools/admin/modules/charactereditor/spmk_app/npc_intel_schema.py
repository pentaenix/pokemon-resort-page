"""Strict provider schema for the portable NPC Intel profile."""
from __future__ import annotations

from typing import Any, Dict


def _object(properties: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


_nullable_string = {"type": ["string", "null"]}
_string_array = {"type": "array", "items": {"type": "string"}, "maxItems": 12}


NPC_INTEL_JSON_SCHEMA: Dict[str, Any] = _object({
    "character_name": {"type": "string", "minLength": 1},
    "description": {"type": "string", "minLength": 1},
    "role": {"type": "string", "enum": ["ambient", "mom", "story", "grunt", "team_leader", "gym_leader", "gym_assistant", "elite_four", "champion", "rival", "professor", "team_admin", "researcher", "caretaker", "unknown"]},
    "main_pokemon": _nullable_string,
    "additional_pokemon": {"type": "array", "maxItems": 2, "items": {"type": "string"}},
    "source_game": {"type": "string", "minLength": 1},
    "source_region": {"type": "string", "minLength": 1},
    "badge_requirement": {"type": "integer", "minimum": 0},
    "relationships": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
    "dialogue": {"type": "array", "minItems": 10, "maxItems": 15, "items": {"type": "string", "minLength": 1}},
})



def provider_output_schema() -> Dict[str, Any]:
    """OpenAI Structured Outputs descriptor for a Character Intel response."""
    return {
        "type": "json_schema",
        "name": "resort_character_profile",
        "description": "A concise validated Pokemon Resort guest profile.",
        "strict": True,
        "schema": NPC_INTEL_JSON_SCHEMA,
    }
