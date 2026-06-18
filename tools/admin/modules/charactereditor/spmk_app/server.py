from __future__ import annotations

import argparse
import base64
import io
import json
import os
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

ROOT = Path(os.environ.get("SPMK_ROOT", Path(__file__).resolve().parents[1]))
WORKSPACE = ROOT / "workspace"
ASSETS = WORKSPACE / "assets"
EXPORTS = WORKSPACE / "exports"
PROJECT_FILE = WORKSPACE / "project.json"
STATIC = Path(__file__).resolve().parent / "static"

for p in [WORKSPACE, ASSETS, EXPORTS]:
    p.mkdir(parents=True, exist_ok=True)

BUILTIN_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "tpl_walk_cycle",
        "name": "Walk Cycle",
        "description": "For Platinum-style 4-direction sheets: rows are down, left, right, up; columns are animation frames. Defaults to scaling 64px source cells down to 32px output cells.",
        "steps": [
            "Use rows 0-3 as down, left, right, up",
            "Use every column as an animation frame",
            "Optionally create base sprites from column 0",
            "Create playable animations named with the chosen prefix",
            "Preserve the original sheet and save a prepared version when scaling"
        ],
        "templateKind": "row_cycle",
        "directions": ["down", "left", "right", "up"],
        "frameWidth": 64,
        "frameHeight": 64,
        "outputFrameWidth": 32,
        "outputFrameHeight": 32,
        "marginX": 0,
        "marginY": 0,
        "spacingX": 0,
        "spacingY": 0,
        "defaultOptions": {
            "prefix": "walk",
            "columnZeroRole": "base_and_frame",
            "scale": "down2",
            "duration": 120,
            "namingMode": "automatic"
        },
        "optionSchema": {
            "prefix": {"type": "text", "label": "Animation name", "placeholder": "walk, run, swim"},
            "columnZeroRole": {"type": "choice", "label": "Column 0 role", "choices": ["base_and_frame", "animation_only", "training_only"]},
            "scale": {"type": "choice", "label": "Scale before slicing", "choices": ["down2", "none", "up2"]}
        }
    },
    {
        "id": "tpl_general_row_cycle",
        "name": "General Row Cycle",
        "description": "For general row-based sheets from these games: directions stay in fixed rows and frames continue across columns. Use it for run, swim, bike, surf, fishing, or custom animations.",
        "steps": [
            "Use rows 0-3 as down, left, right, up",
            "Use every column as a frame",
            "Name frames with your prefix, like run_left_0",
            "Create animations for each direction",
            "Keep advanced options hidden until needed"
        ],
        "templateKind": "row_cycle",
        "directions": ["down", "left", "right", "up"],
        "frameWidth": 64,
        "frameHeight": 64,
        "outputFrameWidth": 32,
        "outputFrameHeight": 32,
        "marginX": 0,
        "marginY": 0,
        "spacingX": 0,
        "spacingY": 0,
        "defaultOptions": {
            "prefix": "action",
            "columnZeroRole": "animation_only",
            "scale": "down2",
            "duration": 120,
            "namingMode": "automatic"
        },
        "optionSchema": {
            "prefix": {"type": "text", "label": "Animation name", "placeholder": "run, swim, bike"},
            "columnZeroRole": {"type": "choice", "label": "Column 0 role", "choices": ["base_and_frame", "animation_only", "training_only"]},
            "scale": {"type": "choice", "label": "Scale before slicing", "choices": ["none", "down2", "up2"]}
        }
    }
]

DEFAULT_PROJECT: Dict[str, Any] = {
    "version": 1,
    "projectName": "Pokemon Platinum Trainer Actions",
    "createdAt": None,
    "updatedAt": None,
    "characters": [],
    "sheets": [],
    "templates": BUILTIN_TEMPLATES.copy(),
    "actions": [],
    "trainingPairs": [],
    "generated": [],
    "animations": [],
}


def now() -> int:
    return int(time.time() * 1000)


def ensure_builtin_templates(p: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure built-ins exist and keep their shipped defaults current.

    Custom templates remain untouched. Built-ins are refreshed so users upgrading
    from older project.json files get corrected defaults such as General Row
    Cycle using 64px source cells.
    """
    templates = p.setdefault("templates", [])
    by_id = {t.get("id"): t for t in templates}
    for builtin in BUILTIN_TEMPLATES:
        bid = builtin.get("id")
        if bid in by_id:
            existing = by_id[bid]
            preserved = {k: existing.get(k) for k in ["createdAt", "updatedAt"] if existing.get(k)}
            existing.clear()
            existing.update(json.loads(json.dumps(builtin)))
            existing.update(preserved)
        else:
            templates.append(json.loads(json.dumps(builtin)))
    return p

def load_project() -> Dict[str, Any]:
    if not PROJECT_FILE.exists():
        p = json.loads(json.dumps(DEFAULT_PROJECT))
        p["createdAt"] = now()
        p["updatedAt"] = now()
        save_project(p)
        return p
    try:
        return ensure_builtin_templates(json.loads(PROJECT_FILE.read_text(encoding="utf-8")))
    except Exception as e:
        raise HTTPException(500, f"Could not read project.json: {e}")


def save_project(p: Dict[str, Any]) -> None:
    p["updatedAt"] = now()
    PROJECT_FILE.write_text(json.dumps(p, indent=2), encoding="utf-8")


def asset_url(path: str) -> str:
    return f"/asset/{path}"


def normalize_png(img: Image.Image) -> Image.Image:
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    return img


def save_upload(file: UploadFile, folder: str) -> Dict[str, Any]:
    ext = Path(file.filename or "sprite.png").suffix.lower() or ".png"
    aid = uuid.uuid4().hex
    rel = f"{folder}/{aid}{ext}"
    dest = ASSETS / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    raw = file.file.read()
    if ext in [".png", ".gif", ".jpg", ".jpeg", ".webp"]:
        img = normalize_png(Image.open(io.BytesIO(raw)))
        dest = dest.with_suffix(".png")
        rel = str(Path(rel).with_suffix(".png")).replace("\\", "/")
        img.save(dest)
        w, h = img.size
    else:
        dest.write_bytes(raw)
        w = h = None
    return {"id": aid, "name": file.filename, "path": rel, "url": asset_url(rel), "width": w, "height": h}


def get_image_by_path(rel: str) -> Image.Image:
    p = ASSETS / rel
    if not p.exists():
        p = EXPORTS / rel
    if not p.exists():
        raise HTTPException(404, f"Image not found: {rel}")
    return normalize_png(Image.open(p))


def png_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def find_sprite(project: Dict[str, Any], image_id: str) -> Optional[Dict[str, Any]]:
    for c in project.get("characters", []):
        for s in c.get("sprites", []):
            if s.get("id") == image_id:
                return s
    for s in project.get("sheets", []):
        if s.get("id") == image_id:
            return s
    for g in project.get("generated", []):
        if g.get("id") == image_id:
            return g
    return None


def frame_from_sheet(sheet: Dict[str, Any], row: int, col: int, fw: int, fh: int, mx: int, my: int, sx: int, sy: int) -> Image.Image:
    img = get_image_by_path(sheet["path"])
    x = mx + col * (fw + sx)
    y = my + row * (fh + sy)
    return img.crop((x, y, x + fw, y + fh))


def extract_palette(img: Image.Image, limit: int = 32) -> List[str]:
    arr = np.array(img)
    flat = arr.reshape(-1, 4)
    colors, counts = np.unique(flat, axis=0, return_counts=True)
    pairs = sorted(zip(colors, counts), key=lambda x: -x[1])
    out = []
    for c, _ in pairs:
        if c[3] == 0:
            continue
        out.append("#%02x%02x%02x%02x" % tuple(c))
        if len(out) >= limit:
            break
    return out




def safe_name(name: str) -> str:
    return ''.join(ch if ch.isalnum() or ch in '-_.' else '_' for ch in (name or 'asset')).strip('_') or 'asset'

def resize_nearest(img: Image.Image, mode: str, factor: int) -> Image.Image:
    factor = max(1, int(factor or 1))
    if mode == 'down':
        w = max(1, img.width // factor)
        h = max(1, img.height // factor)
    else:
        w = max(1, img.width * factor)
        h = max(1, img.height * factor)
    return img.resize((w, h), Image.Resampling.NEAREST)

def attach_sheet_to_character(project: Dict[str, Any], sheet: Dict[str, Any], character_id: str) -> None:
    old_id = sheet.get('characterId')
    sheet['characterId'] = character_id
    for c in project.get('characters', []):
        if old_id and c.get('id') == old_id:
            c['sheetIds'] = [x for x in c.get('sheetIds', []) if x != sheet.get('id')]
        if c.get('id') == character_id:
            ids = c.setdefault('sheetIds', [])
            if sheet.get('id') not in ids:
                ids.append(sheet.get('id'))
            c['updatedAt'] = now()

def make_sprite_from_image(project: Dict[str, Any], character_id: str, img: Image.Image, label: str, direction: str = '', source: Optional[Dict[str, Any]] = None, replace_existing: bool = False) -> Dict[str, Any]:
    c = next((c for c in project.get('characters', []) if c.get('id') == character_id), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    if replace_existing:
        c['sprites'] = [s for s in c.get('sprites', []) if s.get('label') != label]
    sid = uuid.uuid4().hex
    rel = f"characters/{character_id}/{safe_name(label)}_{sid}.png"
    (ASSETS / f"characters/{character_id}").mkdir(parents=True, exist_ok=True)
    img = normalize_png(img)
    img.save(ASSETS / rel)
    sprite = {
        'id': sid, 'name': f"{label}.png", 'path': rel, 'url': asset_url(rel),
        'width': img.width, 'height': img.height, 'label': label, 'direction': direction,
        'kind': 'sprite', 'createdAt': now(), 'palette': extract_palette(img),
        'source': source or {},
    }
    c.setdefault('sprites', []).append(sprite)
    c['updatedAt'] = now()
    return sprite




def set_sheet_family_current(project: Dict[str, Any], family_id: str, current_id: str) -> None:
    """Mark one sheet version as the current/default version in its family."""
    for sheet in project.get('sheets', []):
        if (sheet.get('familyId') or sheet.get('id')) == family_id:
            sheet['currentVersionId'] = current_id
            sheet['isCurrentVersion'] = sheet.get('id') == current_id


def find_template(project: Dict[str, Any], template_id: str) -> Optional[Dict[str, Any]]:
    return next((t for t in project.get('templates', []) if t.get('id') == template_id), None)


def infer_base_label(label: str) -> str:
    """Infer the default base label from a target/action label suffix."""
    if not label:
        return 'base_right'
    direction = label.split('_')[-1] if '_' in label else 'right'
    if direction in {'up', 'down', 'left', 'right'}:
        return f'base_{direction}'
    return 'base_right'


def character_sprite_by_label(character: Dict[str, Any], label: str) -> Optional[Dict[str, Any]]:
    return next((s for s in character.get('sprites', []) if s.get('label') == label), None)


def sprite_is_generated(sprite: Optional[Dict[str, Any]]) -> bool:
    if not sprite:
        return False
    source_type = (sprite.get('source') or {}).get('type', '')
    return source_type in {'generated', 'behavior-generate'} or source_type.startswith('generated')


def sprite_training_eligible(sprite: Optional[Dict[str, Any]]) -> bool:
    """Imported/template/manual sprites are training-safe by default.

    Generated outputs are excluded unless the user explicitly opts them in. This
    prevents generated mistakes from feeding back into future behavior/action
    training runs.
    """
    if not sprite:
        return False
    if sprite_is_generated(sprite):
        return bool(sprite.get('useForTraining'))
    return True


def training_sprite_by_label(character: Dict[str, Any], label: str) -> Optional[Dict[str, Any]]:
    matches = [s for s in character.get('sprites', []) if s.get('label') == label]
    return next((s for s in matches if sprite_training_eligible(s)), None)


def sprite_provenance_label(sprite: Optional[Dict[str, Any]]) -> str:
    if not sprite:
        return 'missing'
    src = sprite.get('source') or {}
    if sprite_is_generated(sprite):
        return 'generated-edited' if src.get('edited') else 'generated'
    if src.get('sheetId'):
        return 'template-extracted'
    if src.get('edited') or src.get('type') == 'edited':
        return 'manual-edited'
    return 'imported'


def action_is_character_excluded(action: Dict[str, Any], character_id: str) -> bool:
    return character_id in (action.get('excludedTrainingCharacters') or [])


def action_training_source_rows(project: Dict[str, Any], action: Dict[str, Any]) -> List[Dict[str, Any]]:
    label = action.get('label') or action.get('targetLabel') or ''
    input_label = action.get('inputLabel') or infer_base_label(label)
    target_label = action.get('targetLabel') or label
    rows: List[Dict[str, Any]] = []
    for c in project.get('characters', []):
        cid = c.get('id')
        base_raw = character_sprite_by_label(c, input_label)
        target_raw = character_sprite_by_label(c, target_label)
        base = training_sprite_by_label(c, input_label)
        target = training_sprite_by_label(c, target_label)
        missing: List[str] = []
        if not base_raw:
            missing.append(f'missing {input_label}')
        if not target_raw:
            missing.append(f'missing {target_label}')
        generated_excluded = bool(
            (target_raw and sprite_is_generated(target_raw) and not sprite_training_eligible(target_raw))
            or (base_raw and sprite_is_generated(base_raw) and not sprite_training_eligible(base_raw))
        )
        if generated_excluded and not missing:
            missing.append('generated excluded')
        if action_is_character_excluded(action, cid):
            status = 'excluded'
        elif base and target:
            status = 'included'
        elif generated_excluded:
            status = 'excluded'
        elif missing:
            status = 'missing'
        else:
            status = 'incomplete'
        prov = sprite_provenance_label(target_raw or base_raw)
        rows.append({
            'characterId': cid,
            'characterName': c.get('name'),
            'status': status,
            'provenance': prov,
            'missingReason': ', '.join(missing) if missing else '',
            'base': base_raw,
            'target': target_raw,
            'ready': bool(base and target),
        })
    return rows


def sheet_populated_record(character: Dict[str, Any], sheet_id: str, template_id: str) -> Optional[Dict[str, Any]]:
    for rec in character.get('sheetImports', []):
        if rec.get('sheetId') == sheet_id and rec.get('templateId') == template_id:
            return rec
    return None


def clear_population(project: Dict[str, Any], character_id: str, sheet_id: str, template_id: str) -> None:
    """Remove sprites and animations created by a previous sheet/template population."""
    c = next((c for c in project.get('characters', []) if c.get('id') == character_id), None)
    if not c:
        return
    c['sprites'] = [
        sp for sp in c.get('sprites', [])
        if not (
            sp.get('source', {}).get('sheetId') == sheet_id
            and sp.get('source', {}).get('templateId') == template_id
        )
    ]
    project['animations'] = [
        a for a in project.get('animations', [])
        if not (
            a.get('characterId') == character_id
            and a.get('sourceSheetId') == sheet_id
            and a.get('templateId') == template_id
        )
    ]
    c['sheetImports'] = [
        rec for rec in c.get('sheetImports', [])
        if not (rec.get('sheetId') == sheet_id and rec.get('templateId') == template_id)
    ]
    c['updatedAt'] = now()


def merge_template_options(template: Dict[str, Any], options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Merge user-facing template options with safe defaults."""
    merged = dict(template.get('defaultOptions') or {})
    if options:
        for k, v in options.items():
            if v is not None and v != '':
                merged[k] = v
    merged.setdefault('prefix', 'walk')
    merged.setdefault('columnZeroRole', 'base_and_frame')
    merged.setdefault('scale', 'none')
    merged.setdefault('duration', 120)
    return merged


def scale_spec_from_option(scale: str) -> Dict[str, Any]:
    if scale == 'down2':
        return {'mode': 'down', 'factor': 2}
    if scale == 'up2':
        return {'mode': 'up', 'factor': 2}
    return {'mode': 'none', 'factor': 1}


def output_frame_size(template: Dict[str, Any], options: Dict[str, Any]) -> Dict[str, int]:
    spec = scale_spec_from_option(str(options.get('scale') or 'none'))
    fw = int(template.get('frameWidth') or 32)
    fh = int(template.get('frameHeight') or 32)
    if spec['mode'] == 'down' and spec['factor'] > 1:
        fw = max(1, fw // spec['factor']); fh = max(1, fh // spec['factor'])
    elif spec['mode'] == 'up' and spec['factor'] > 1:
        fw *= spec['factor']; fh *= spec['factor']
    return {'frameWidth': fw, 'frameHeight': fh}


def build_row_cycle_template(template: Dict[str, Any], sheet: Optional[Dict[str, Any]], options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return a concrete, extractable template from row-cycle options.

    This keeps the UI flexible without asking users to hand-write labels. The
    concrete template is also saved on the sheet so later population is stable.
    """
    opts = merge_template_options(template, options)
    directions = template.get('directions') or ['down', 'left', 'right', 'up']
    spec = scale_spec_from_option(str(opts.get('scale') or 'none'))
    source_fw = int(template.get('frameWidth') or 32)
    source_fh = int(template.get('frameHeight') or 32)
    out = output_frame_size(template, opts)
    cols = 4
    if sheet and sheet.get('width'):
        # Before template application, sheet is source-sized. After application,
        # the prepared sheet is output-sized and stores settings.
        width = int(sheet.get('width') or 0)
        if spec['mode'] == 'down' and spec['factor'] > 1:
            cols = max(1, width // source_fw)
        elif spec['mode'] == 'up' and spec['factor'] > 1:
            cols = max(1, width // source_fw)
        else:
            cols = max(1, width // source_fw)
    duration = int(opts.get('duration') or 120)
    prefix = safe_name(str(opts.get('prefix') or 'action')).lower() or 'action'
    column_zero_role = str(opts.get('columnZeroRole') or 'animation_only')
    base_cells = {}
    if column_zero_role == 'base_and_frame':
        base_cells = {d: {'row': i, 'col': 0} for i, d in enumerate(directions)}
    animations = {}
    frame_roles = {}
    for row, direction in enumerate(directions):
        anim_name = f'{prefix}_{direction}'
        frames = []
        for col in range(cols):
            label = f'{prefix}_{direction}_{col}'
            role = 'animation'
            if col == 0 and column_zero_role == 'training_only':
                role = 'training'
            frames.append({'row': row, 'col': col, 'duration': duration, 'label': label, 'kind': role})
        animations[anim_name] = frames
    concrete = {
        'id': template.get('id'),
        'sourceTemplateId': template.get('id'),
        'name': template.get('name'),
        'description': template.get('description', ''),
        'steps': template.get('steps') or [],
        'templateKind': template.get('templateKind'),
        'directions': directions,
        'frameWidth': out['frameWidth'],
        'frameHeight': out['frameHeight'],
        'marginX': int(template.get('marginX') or 0),
        'marginY': int(template.get('marginY') or 0),
        'spacingX': int(template.get('spacingX') or 0),
        'spacingY': int(template.get('spacingY') or 0),
        'baseCells': base_cells,
        'animations': animations,
        'options': opts,
        'defaultExtractScale': {'mode': 'none', 'factor': 1},
        'columnZeroRole': column_zero_role,
    }
    return concrete


def resolved_template(template: Dict[str, Any], sheet: Optional[Dict[str, Any]] = None, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if sheet and sheet.get('resolvedTemplate') and not options:
        return sheet['resolvedTemplate']
    if template.get('templateKind') == 'row_cycle':
        return build_row_cycle_template(template, sheet, options)
    return template


def template_plan(template: Dict[str, Any], sheet: Optional[Dict[str, Any]] = None, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    tpl = resolved_template(template, sheet, options)
    opts = merge_template_options(template, options or tpl.get('options'))
    bases = []
    for direction, cell in (tpl.get('baseCells') or {}).items():
        bases.append({'label': f'base_{direction}', 'direction': direction, 'row': int(cell.get('row') or 0), 'col': int(cell.get('col') or 0)})
    animations = []
    for name, frames in (tpl.get('animations') or {}).items():
        animations.append({'name': name, 'frameCount': len(frames), 'frames': frames[:12]})
    spec = scale_spec_from_option(str(opts.get('scale') or 'none'))
    source_w = sheet.get('width') if sheet else None
    source_h = sheet.get('height') if sheet else None
    out_w, out_h = source_w, source_h
    if source_w and source_h and spec['factor'] > 1:
        if spec['mode'] == 'down':
            out_w, out_h = max(1, source_w // spec['factor']), max(1, source_h // spec['factor'])
        elif spec['mode'] == 'up':
            out_w, out_h = source_w * spec['factor'], source_h * spec['factor']
    all_frames = sum(len(v) for v in (tpl.get('animations') or {}).values())
    base_cell_count = len(tpl.get('baseCells') or {})
    duplicate_bases = base_cell_count if opts.get('columnZeroRole') == 'base_and_frame' else 0
    return {
        'templateId': template.get('id'),
        'templateName': template.get('name'),
        'description': template.get('description', ''),
        'steps': template.get('steps') or [],
        'options': opts,
        'bases': bases,
        'animations': animations,
        'spriteCount': max(0, all_frames + base_cell_count - duplicate_bases),
        'animationCount': len(animations),
        'sourceSize': {'width': source_w, 'height': source_h},
        'outputSize': {'width': out_w, 'height': out_h},
        'frameWidth': int(tpl.get('frameWidth') or 32),
        'frameHeight': int(tpl.get('frameHeight') or 32),
        'preparesCopy': bool(spec['mode'] in {'up', 'down'} and spec['factor'] > 1),
        'columnZeroRole': opts.get('columnZeroRole'),
    }

def build_learned_from_pairs(project: Dict[str, Any], pairs: List[Dict[str, Any]], action_label: str, upsert_action: bool = True) -> Dict[str, Any]:
    """Learn a conservative pixel-change mask from paired examples.

    v11 deliberately avoids using one source character as a full overlay. Pixels
    that vary strongly in color across examples are marked uncertain and are not
    applied automatically. This keeps hats/faces from a training character from
    being pasted onto a target character.
    """
    if not pairs:
        raise HTTPException(400, "No training pairs for this action label.")
    adds: List[np.ndarray] = []
    removes: List[np.ndarray] = []
    action_arrays: List[np.ndarray] = []
    sizes: List[tuple[int, int]] = []
    count = 0
    for pair in pairs:
        base_sprite = find_sprite(project, pair.get("baseId"))
        action_sprite = find_sprite(project, pair.get("actionId"))
        if not base_sprite or not action_sprite:
            continue
        b = get_image_by_path(base_sprite["path"])
        a = get_image_by_path(action_sprite["path"])
        w = min(b.width, a.width); h = min(b.height, a.height)
        b = b.crop((0, 0, w, h)); a = a.crop((0, 0, w, h))
        ba = np.array(b); aa = np.array(a)
        diff = np.any(ba != aa, axis=2)
        add = np.logical_and(diff, aa[:, :, 3] > 0)
        rem = np.logical_and(diff, ba[:, :, 3] > 0)
        adds.append(add); removes.append(rem); action_arrays.append(aa); sizes.append((w, h)); count += 1
    if count == 0:
        raise HTTPException(400, "Training pairs could not be read.")
    w = min(x[0] for x in sizes); h = min(x[1] for x in sizes)
    add_stack = np.stack([x[:h, :w] for x in adds])
    rem_stack = np.stack([x[:h, :w] for x in removes])
    arr_stack = np.stack([x[:h, :w, :] for x in action_arrays])
    add_freq = add_stack.mean(axis=0)
    rem_freq = rem_stack.mean(axis=0)

    # Require majority agreement when possible. With one example, allow it but
    # clearly mark lower confidence through consistency stats.
    threshold = 1.0 if count == 1 else max(0.6, min(0.85, 2.5 / max(count, 1)))
    add_candidate = add_freq >= threshold
    # v12: removals are more dangerous than overlays; require stronger agreement
    # so target bodies are preserved unless many examples agree a pixel disappears.
    rem_threshold = 1.0 if count <= 2 else 0.85
    rem_mask = rem_freq >= rem_threshold

    # Detect color-stable added pixels. Shared props tend to have similar colors;
    # character details vary. We only auto-apply stable pixels.
    rgb = arr_stack[:, :, :, :3].astype(np.int16)
    alpha = arr_stack[:, :, :, 3]
    color_range = rgb.max(axis=0) - rgb.min(axis=0)
    color_stable = np.max(color_range, axis=2) <= 18
    alpha_stable = (alpha.max(axis=0) - alpha.min(axis=0)) <= 24
    overlay_mask = add_candidate & color_stable & alpha_stable
    uncertain_mask = add_candidate & ~overlay_mask

    overlay = np.zeros((h, w, 4), dtype=np.uint8)
    if count == 1:
        exemplar = arr_stack[0]
        overlay[overlay_mask] = exemplar[overlay_mask]
    else:
        avg = np.rint(arr_stack.astype(np.float32).mean(axis=0)).astype(np.uint8)
        overlay[overlay_mask] = avg[overlay_mask]
    overlay_img = Image.fromarray(overlay, 'RGBA')

    preview = np.zeros((h, w, 4), dtype=np.uint8)
    preview[rem_mask] = [255, 80, 80, 220]
    preview[overlay_mask] = [245, 245, 255, 235]
    preview[uncertain_mask] = [255, 210, 80, 160]
    preview_img = Image.fromarray(preview, 'RGBA')

    uncertain_img = np.zeros((h, w, 4), dtype=np.uint8)
    uncertain_img[uncertain_mask] = [255, 210, 80, 200]
    uncertain_img = Image.fromarray(uncertain_img, 'RGBA')

    lid = uuid.uuid4().hex
    safe_label = safe_name(action_label)
    (ASSETS / 'learned').mkdir(exist_ok=True)
    rel = f"learned/{safe_label}_{lid}.png"; overlay_img.save(ASSETS / rel)
    diffrel = f"learned/{safe_label}_{lid}_diff.png"; preview_img.save(ASSETS / diffrel)
    uncertain_rel = f"learned/{safe_label}_{lid}_uncertain.png"; uncertain_img.save(ASSETS / uncertain_rel)
    learned = {
        "id": lid,
        "label": action_label,
        "exampleCount": count,
        "width": w,
        "height": h,
        "overlayPath": rel,
        "overlayUrl": asset_url(rel),
        "diffPath": diffrel,
        "diffUrl": asset_url(diffrel),
        "uncertainPath": uncertain_rel,
        "uncertainUrl": asset_url(uncertain_rel),
        "removePixels": np.argwhere(rem_mask).tolist(),
        "addPixels": int(overlay_mask.sum()),
        "uncertainPixels": int(uncertain_mask.sum()),
        "removePixelCount": int(rem_mask.sum()),
        "protectedPixels": [],
        "createdAt": now(),
        "engine": "conservative-mask-overlay-v2",
        "consistency": "high" if count >= 4 and int(uncertain_mask.sum()) < int(max(1, overlay_mask.sum()) * 0.5) else ("medium" if count >= 2 else "low"),
    }
    if upsert_action:
        actions = project.setdefault('actions', [])
        existing = next((a for a in actions if a.get('label') == action_label), None)
        if existing:
            existing.update({"learned": learned, "updatedAt": now(), "targetLabel": existing.get("targetLabel") or action_label, "inputLabel": existing.get("inputLabel") or infer_base_label(action_label)})
        else:
            actions.append({"id": uuid.uuid4().hex, "type": "single", "label": action_label, "inputLabel": infer_base_label(action_label), "targetLabel": action_label, "direction": action_label.split('_')[-1] if '_' in action_label else '', "learned": learned, "createdAt": now(), "updatedAt": now()})
    return learned


def learn_transform(project: Dict[str, Any], action_label: str) -> Dict[str, Any]:
    pairs = [p for p in project.get("trainingPairs", []) if p.get("label") == action_label]
    learned = build_learned_from_pairs(project, pairs, action_label, upsert_action=True)
    save_project(project)
    return learned


def apply_transform(project: Dict[str, Any], target_id: str, label: str, name: str = "") -> Dict[str, Any]:
    target = find_sprite(project, target_id)
    if not target:
        raise HTTPException(404, "Target sprite not found.")
    action=next((a for a in project.get('actions', []) if a.get('label')==label), None)
    if not action or not action.get('learned'):
        raise HTTPException(400, "Action has not been trained yet.")
    learned=action['learned']
    base=get_image_by_path(target['path'])
    out=apply_learned_dict_to_image(base, learned)
    w, h = out.width, out.height
    gid=uuid.uuid4().hex
    safe = safe_name(name or f"{target.get('label','target')}_{label}")
    rel=f"generated/{safe}_{gid}.png"
    (ASSETS/'generated').mkdir(exist_ok=True)
    out.save(ASSETS/rel)
    item={"id": gid, "name": safe, "label": label, "targetId": target_id, "path": rel, "url": asset_url(rel), "width": w, "height": h, "createdAt": now(), "palette": extract_palette(out)}
    project.setdefault('generated', []).insert(0, item)
    save_project(project)
    return item

app = FastAPI(title="SPMK")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory=STATIC), name="static")

from spmk_app.package_api import init_package_api, router as package_router  # noqa: E402

init_package_api(ROOT, WORKSPACE, EXPORTS)
app.include_router(package_router)

@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC/"index.html").read_text(encoding="utf-8")

@app.get("/api/project")
def api_project():
    return load_project()

@app.post("/api/project")
async def api_save_project(payload: Dict[str, Any]):
    save_project(payload)
    return {"ok": True, "updatedAt": payload.get('updatedAt')}

@app.post("/api/character")
async def create_character(payload: Dict[str, Any]):
    p=load_project()
    c={"id": uuid.uuid4().hex, "name": payload.get('name') or 'Untitled Character', "tags": payload.get('tags', []), "sprites": [], "sheetIds": [], "createdAt": now(), "updatedAt": now()}
    p.setdefault('characters', []).insert(0,c)
    save_project(p)
    return c

@app.delete("/api/character/{cid}")
def delete_character(cid: str):
    p=load_project(); p['characters']=[c for c in p.get('characters', []) if c.get('id')!=cid]; save_project(p); return {"ok": True}

@app.post("/api/upload/sprite")
async def upload_sprite(file: UploadFile = File(...), characterId: str = Form(...), label: str = Form(...), direction: str = Form(""), kind: str = Form("sprite")):
    p=load_project(); c=next((c for c in p.get('characters', []) if c.get('id')==characterId), None)
    if not c: raise HTTPException(404, "Character not found")
    asset=save_upload(file, f"characters/{characterId}")
    sprite={**asset, "label": label, "direction": direction, "kind": kind, "createdAt": now(), "palette": extract_palette(get_image_by_path(asset['path']))}
    c.setdefault('sprites', []).append(sprite); c['updatedAt']=now(); save_project(p); return sprite

@app.post("/api/upload/sheet")
async def upload_sheet(file: UploadFile = File(...), characterId: str = Form(""), templateId: str = Form("")):
    p=load_project(); asset=save_upload(file, "sheets")
    family_id = uuid.uuid4().hex
    sheet={**asset, "characterId": characterId, "templateId": templateId, "mappings": [], "animations": [], "familyId": family_id, "versionName": "Original", "versionRole": "original", "createdAt": now(), "updatedAt": now()}
    p.setdefault('sheets', []).insert(0, sheet)
    set_sheet_family_current(p, family_id, sheet['id'])
    if characterId:
        c=next((c for c in p.get('characters', []) if c.get('id')==characterId), None)
        if c: c.setdefault('sheetIds', []).append(sheet['id'])
    save_project(p); return sheet

@app.patch("/api/sheet/{sid}")
async def update_sheet(sid: str, payload: Dict[str, Any]):
    p = load_project()
    sheet = next((s for s in p.get('sheets', []) if s.get('id') == sid), None)
    if not sheet:
        raise HTTPException(404, 'Sheet not found')
    if 'characterId' in payload:
        attach_sheet_to_character(p, sheet, payload.get('characterId') or '')
    for key in ['templateId', 'templateOptions', 'resolvedTemplate', 'templatePlan', 'settings', 'mappings', 'animations', 'name', 'versionName', 'versionRole', 'familyId']:
        if key in payload:
            sheet[key] = payload[key]
    sheet['updatedAt'] = now()
    set_sheet_family_current(p, sheet.get('familyId') or sheet.get('id'), sheet['id'])
    save_project(p)
    return sheet


@app.get("/api/templates")
def list_templates():
    return load_project().get('templates', [])


@app.get("/api/templates/{template_id}/plan")
def get_template_plan(template_id: str, sheetId: str = ""):
    p = load_project()
    template = find_template(p, template_id)
    if not template:
        raise HTTPException(404, 'Template not found')
    sheet = next((s for s in p.get('sheets', []) if s.get('id') == sheetId), None) if sheetId else None
    raw_options = {}
    # GET keeps the UI simple; options are accepted as a compact JSON string when needed.
    return template_plan(template, sheet, raw_options)

@app.post("/api/templates/{template_id}/plan")
async def post_template_plan(template_id: str, payload: Dict[str, Any]):
    p = load_project()
    template = find_template(p, template_id)
    if not template:
        raise HTTPException(404, 'Template not found')
    sheet = next((s for s in p.get('sheets', []) if s.get('id') == payload.get('sheetId')), None) if payload.get('sheetId') else None
    return template_plan(template, sheet, payload.get('options') or {})


@app.post("/api/templates/{template_id}/apply")
async def apply_template_to_sheet(template_id: str, payload: Dict[str, Any]):
    """Apply a reusable sheet template with user options.

    Row-cycle templates are resolved into a concrete template and saved on the
    sheet version. If scaling is requested, the original sheet remains untouched
    and a prepared version is created in the same sheet family.
    """
    p = load_project()
    sid = payload.get('sheetId')
    sheet = next((s for s in p.get('sheets', []) if s.get('id') == sid), None)
    if not sheet:
        raise HTTPException(404, 'Sheet not found')
    template = find_template(p, template_id)
    if not template:
        raise HTTPException(404, 'Template not found')
    options = merge_template_options(template, payload.get('options') or {})
    spec = scale_spec_from_option(str(options.get('scale') or 'none'))
    concrete = resolved_template(template, sheet, options)

    if spec['mode'] in {'up', 'down'} and int(spec.get('factor') or 1) > 1:
        source_img = get_image_by_path(sheet['path'])
        img = resize_nearest(source_img, spec['mode'], int(spec['factor']))
        new_id = uuid.uuid4().hex
        rel = f"sheets/{safe_name(sheet.get('name') or 'sheet')}_{safe_name(template.get('id'))}_{new_id}.png"
        (ASSETS / 'sheets').mkdir(parents=True, exist_ok=True)
        img.save(ASSETS / rel)
        concrete_prepared = dict(concrete)
        concrete_prepared['options'] = {**options, 'scale': 'none'}
        settings = {
            'frameWidth': int(concrete_prepared.get('frameWidth') or 32),
            'frameHeight': int(concrete_prepared.get('frameHeight') or 32),
            'marginX': int(concrete_prepared.get('marginX') or 0),
            'marginY': int(concrete_prepared.get('marginY') or 0),
            'spacingX': int(concrete_prepared.get('spacingX') or 0),
            'spacingY': int(concrete_prepared.get('spacingY') or 0),
        }
        prepared = {
            **sheet,
            'id': new_id,
            'name': f"{sheet.get('name', 'sheet')} ({template.get('name', 'prepared')})",
            'path': rel,
            'url': asset_url(rel),
            'width': img.width,
            'height': img.height,
            'templateId': template.get('id'),
            'appliedTemplateId': template.get('id'),
            'templateOptions': {**options, 'scale': 'none'},
            'resolvedTemplate': concrete_prepared,
            'settings': settings,
            'preparedFromSheetId': sid,
            'familyId': sheet.get('familyId') or sheet.get('id'),
            'versionName': f"Prepared · {template.get('name', 'template')} · {options.get('prefix')}",
            'versionRole': 'prepared',
            'mappings': [],
            'animations': [],
            'templatePlan': template_plan(template, {'width': img.width, 'height': img.height, 'resolvedTemplate': concrete_prepared}, {**options, 'scale': 'none'}),
            'createdAt': now(),
            'updatedAt': now(),
        }
        p.setdefault('sheets', []).insert(0, prepared)
        set_sheet_family_current(p, prepared['familyId'], prepared['id'])
        save_project(p)
        return {'ok': True, 'sheet': prepared, 'plan': prepared['templatePlan']}

    settings = {
        'frameWidth': int(concrete.get('frameWidth') or 32),
        'frameHeight': int(concrete.get('frameHeight') or 32),
        'marginX': int(concrete.get('marginX') or 0),
        'marginY': int(concrete.get('marginY') or 0),
        'spacingX': int(concrete.get('spacingX') or 0),
        'spacingY': int(concrete.get('spacingY') or 0),
    }
    sheet['templateId'] = template.get('id')
    sheet['templateOptions'] = options
    sheet['resolvedTemplate'] = concrete
    sheet['settings'] = settings
    sheet['templatePlan'] = template_plan(template, sheet, options)
    sheet['updatedAt'] = now()
    set_sheet_family_current(p, sheet.get('familyId') or sheet.get('id'), sheet['id'])
    save_project(p)
    return {'ok': True, 'sheet': sheet, 'plan': sheet['templatePlan']}


@app.post("/api/sheet/{sid}/prepare-platinum")
async def prepare_platinum_sheet(sid: str, payload: Dict[str, Any]):
    # Backward-compatible wrapper for older agents/UI.
    return await apply_template_to_sheet('tpl_walk_cycle', {'sheetId': sid})

@app.post("/api/sheet/{sid}/extract-cell")
async def extract_sheet_cell(sid: str, payload: Dict[str, Any]):
    p = load_project()
    sheet = next((s for s in p.get('sheets', []) if s.get('id') == sid), None)
    if not sheet:
        raise HTTPException(404, 'Sheet not found')
    character_id = payload.get('characterId') or sheet.get('characterId')
    if not character_id:
        raise HTTPException(400, 'Choose a character before extracting frames.')
    params = payload.get('settings') or sheet.get('settings') or {}
    fw = int(params.get('frameWidth') or 32); fh = int(params.get('frameHeight') or 32)
    mx = int(params.get('marginX') or 0); my = int(params.get('marginY') or 0)
    sx = int(params.get('spacingX') or 0); sy = int(params.get('spacingY') or 0)
    row = int(payload.get('row') or 0); col = int(payload.get('col') or 0)
    img = frame_from_sheet(sheet, row, col, fw, fh, mx, my, sx, sy)
    scale = payload.get('scale') or {}
    factor = int(scale.get('factor') or 1) if isinstance(scale, dict) else 1
    mode = scale.get('mode') if isinstance(scale, dict) else 'up'
    if factor > 1:
        img = resize_nearest(img, mode, factor)
    label = payload.get('label') or f'frame_r{row}_c{col}'
    direction = payload.get('direction') or (label.split('_')[-1] if '_' in label else '')
    source = {'sheetId': sid, 'row': row, 'col': col, 'settings': params}
    sprite = make_sprite_from_image(p, character_id, img, label, direction, source, bool(payload.get('replaceExisting')))
    mapping = {'row': row, 'col': col, 'label': label, 'direction': direction, 'characterId': character_id, 'spriteId': sprite['id'], 'updatedAt': now()}
    sheet.setdefault('mappings', []).append(mapping)
    if sheet.get('characterId') != character_id:
        attach_sheet_to_character(p, sheet, character_id)
    save_project(p)
    return sprite

@app.post("/api/sheet/{sid}/extract-template")
async def extract_template_frames(sid: str, payload: Dict[str, Any]):
    p = load_project()
    sheet = next((s for s in p.get('sheets', []) if s.get('id') == sid), None)
    if not sheet:
        raise HTTPException(404, 'Sheet not found')
    character_id = payload.get('characterId') or sheet.get('characterId')
    if not character_id:
        raise HTTPException(400, 'Choose a character before extracting frames.')
    character = next((c for c in p.get('characters', []) if c.get('id') == character_id), None)
    if not character:
        raise HTTPException(404, 'Character not found')
    template_id = payload.get('templateId') or sheet.get('templateId')
    base_template = next((t for t in p.get('templates', []) if t.get('id') == template_id), None)
    if not base_template:
        raise HTTPException(404, 'Template not found')
    template = sheet.get('resolvedTemplate') or resolved_template(base_template, sheet, sheet.get('templateOptions') or payload.get('options') or {})

    duplicate_mode = payload.get('duplicateMode') or 'block'
    existing_record = sheet_populated_record(character, sid, template_id)
    if existing_record and duplicate_mode == 'block':
        raise HTTPException(409, 'This sheet/template has already populated this character. Open the existing import, replace it, or duplicate as a new version.')
    if existing_record and duplicate_mode == 'replace':
        clear_population(p, character_id, sid, template_id)

    params = payload.get('settings') or sheet.get('settings') or template
    fw = int(params.get('frameWidth') or template.get('frameWidth') or 32); fh = int(params.get('frameHeight') or template.get('frameHeight') or 32)
    mx = int(params.get('marginX') or 0); my = int(params.get('marginY') or 0)
    sx = int(params.get('spacingX') or 0); sy = int(params.get('spacingY') or 0)
    scale = payload.get('scale') if isinstance(payload.get('scale'), dict) else template.get('defaultExtractScale', {})
    factor = int(scale.get('factor') or 1) if isinstance(scale, dict) else 1
    mode = scale.get('mode') if isinstance(scale, dict) else 'up'
    replace_existing = bool(payload.get('replaceExisting', duplicate_mode == 'replace'))
    include_bases = bool(payload.get('includeBases', True))
    include_animations = bool(payload.get('includeAnimations', True))
    created: List[Dict[str, Any]] = []
    mappings: List[Dict[str, Any]] = []
    base_sprite_by_cell: Dict[str, Dict[str, Any]] = {}

    def cell_key(cell: Dict[str, Any]) -> str:
        return f"{int(cell.get('row') or 0)}:{int(cell.get('col') or 0)}"

    def crop_make(cell: Dict[str, Any], label: str, direction: str, kind: str) -> Dict[str, Any]:
        img = frame_from_sheet(sheet, int(cell.get('row') or 0), int(cell.get('col') or 0), fw, fh, mx, my, sx, sy)
        if factor > 1:
            img = resize_nearest(img, mode, factor)
        source = {'sheetId': sid, 'row': int(cell.get('row') or 0), 'col': int(cell.get('col') or 0), 'settings': params, 'templateId': template_id, 'kind': kind}
        sprite = make_sprite_from_image(p, character_id, img, label, direction, source, replace_existing)
        created.append(sprite)
        mappings.append({'row': source['row'], 'col': source['col'], 'label': label, 'direction': direction, 'characterId': character_id, 'spriteId': sprite['id'], 'updatedAt': now()})
        return sprite

    if include_bases:
        for direction, cell in (template.get('baseCells') or {}).items():
            sprite = crop_make(cell, f'base_{direction}', direction, 'base')
            base_sprite_by_cell[cell_key(cell)] = sprite

    made_animations = []
    if include_animations:
        p.setdefault('animations', [])
        if replace_existing:
            p['animations'] = [a for a in p.get('animations', []) if not (a.get('characterId') == character_id and a.get('sourceSheetId') == sid and a.get('templateId') == template_id)]
        for anim_name, frames in (template.get('animations') or {}).items():
            anim_frames = []
            direction = anim_name.split('_')[-1] if '_' in anim_name else ''
            for idx, f in enumerate(frames):
                key = cell_key(f)
                if key in base_sprite_by_cell:
                    sprite = base_sprite_by_cell[key]
                    label = sprite.get('label')
                else:
                    label = f.get('label') or f'{anim_name}_{idx}'
                    sprite = crop_make(f, label, direction, f.get('kind') or 'animation')
                anim_frames.append({'spriteId': sprite['id'], 'label': label, 'duration': int(f.get('duration') or 120), 'row': int(f.get('row') or 0), 'col': int(f.get('col') or 0)})
            anim = {'id': uuid.uuid4().hex, 'name': anim_name, 'characterId': character_id, 'sourceSheetId': sid, 'templateId': template_id, 'frames': anim_frames, 'loop': True, 'createdAt': now()}
            p['animations'].append(anim)
            made_animations.append(anim)

    sheet.setdefault('mappings', []).extend(mappings)
    sheet['templateId'] = template_id
    sheet['settings'] = params
    sheet['lastPopulatedCharacterId'] = character_id
    if sheet.get('characterId') != character_id:
        attach_sheet_to_character(p, sheet, character_id)
    character.setdefault('sheetImports', []).append({
        'id': uuid.uuid4().hex,
        'sheetId': sid,
        'sheetName': sheet.get('name'),
        'templateId': template_id,
        'templateName': template.get('name'),
        'createdSpriteIds': [sp.get('id') for sp in created],
        'createdAnimationIds': [a.get('id') for a in made_animations],
        'createdAt': now(),
    })
    save_project(p)
    return {'ok': True, 'createdSprites': created, 'animations': made_animations, 'count': len(created), 'duplicateMode': duplicate_mode}


@app.post("/api/character/{cid}/animation")
async def create_character_animation(cid: str, payload: Dict[str, Any]):
    p = load_project()
    c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    frames = payload.get('frames') or []
    if not frames:
        raise HTTPException(400, 'Animation needs at least one frame')
    valid_ids = {s.get('id') for s in c.get('sprites', [])}
    anim_frames = []
    for f in frames:
        sid = f.get('spriteId')
        if sid not in valid_ids:
            raise HTTPException(400, 'Animation frames must come from this character')
        sp = next(s for s in c.get('sprites', []) if s.get('id') == sid)
        anim_frames.append({'spriteId': sid, 'label': sp.get('label'), 'duration': int(f.get('duration') or 120)})
    anim = {'id': uuid.uuid4().hex, 'name': payload.get('name') or 'new_animation', 'characterId': cid, 'frames': anim_frames, 'loop': bool(payload.get('loop', True)), 'createdAt': now(), 'source': {'type': 'manual'}}
    p.setdefault('animations', []).append(anim)
    c['updatedAt'] = now()
    save_project(p)
    return anim


@app.post("/api/generated/{gid}/save-to-character")
async def save_generated_to_character(gid: str, payload: Dict[str, Any]):
    p = load_project()
    g = next((x for x in p.get('generated', []) if x.get('id') == gid), None)
    if not g:
        raise HTTPException(404, 'Generated sprite not found')
    cid = payload.get('characterId')
    label = payload.get('label') or g.get('label') or g.get('name') or 'generated'
    c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    img = get_image_by_path(g['path'])
    sprite = make_sprite_from_image(p, cid, img, label, payload.get('direction') or '', {'type': 'generated', 'generatedId': gid}, bool(payload.get('replaceExisting')) )
    save_project(p)
    return sprite


@app.post("/api/actions/define")
async def define_action(payload: Dict[str, Any]):
    p = load_project()
    label = payload.get('label') or payload.get('targetLabel')
    if not label:
        raise HTTPException(400, 'Action label is required')
    action = next((a for a in p.setdefault('actions', []) if a.get('label') == label), None)
    data = {'label': label, 'inputLabel': payload.get('inputLabel') or infer_base_label(label), 'targetLabel': payload.get('targetLabel') or label, 'direction': (payload.get('targetLabel') or label).split('_')[-1] if '_' in (payload.get('targetLabel') or label) else '', 'updatedAt': now()}
    if action:
        action.update(data)
    else:
        action = {'id': uuid.uuid4().hex, 'createdAt': now(), **data}
        p['actions'].append(action)
    save_project(p)
    return action


@app.get("/api/actions/{label}/sources")
def action_sources(label: str):
    p = load_project()
    action = next((a for a in p.get('actions', []) if a.get('label') == label), None) or {'label': label, 'inputLabel': infer_base_label(label), 'targetLabel': label}
    rows = action_training_source_rows(p, action)
    ready = [r for r in rows if r.get('ready')]
    incomplete = [r for r in rows if r.get('status') in {'missing', 'incomplete'}]
    excluded = [r for r in rows if r.get('status') == 'excluded']
    return {'action': action, 'rows': rows, 'ready': ready, 'incomplete': incomplete, 'excluded': excluded}


@app.patch('/api/actions/{label}/training-source/{character_id}')
async def set_action_training_source(label: str, character_id: str, payload: Dict[str, Any]):
    p = load_project()
    action = next((a for a in p.get('actions', []) if a.get('label') == label), None)
    if not action:
        raise HTTPException(404, 'Action not found')
    c = next((x for x in p.get('characters', []) if x.get('id') == character_id), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    included = bool(payload.get('included'))
    excluded = list(action.get('excludedTrainingCharacters') or [])
    input_label = action.get('inputLabel') or infer_base_label(label)
    target_label = action.get('targetLabel') or label
    labels = {input_label, target_label}
    if included:
        if character_id in excluded:
            excluded.remove(character_id)
        for lab in labels:
            sp = character_sprite_by_label(c, lab)
            if sp and sprite_is_generated(sp):
                sp['useForTraining'] = True
                sp['updatedAt'] = now()
    else:
        if character_id not in excluded:
            excluded.append(character_id)
        for lab in labels:
            sp = character_sprite_by_label(c, lab)
            if sp and sprite_is_generated(sp):
                sp['useForTraining'] = False
                sp['updatedAt'] = now()
    action['excludedTrainingCharacters'] = excluded
    action['updatedAt'] = now()
    save_project(p)
    rows = action_training_source_rows(p, action)
    row = next((r for r in rows if r.get('characterId') == character_id), None)
    return {'ok': True, 'row': row, 'rows': rows, 'action': action}


def ensure_training_pairs_for_action(project: Dict[str, Any], action: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Create label-derived training pairs from characters with both sprites.

    The UI no longer asks users to manually type action labels in the Actions or
    Generate views. Training pairs can be derived safely from existing labels.
    """
    label = action.get('label') or action.get('targetLabel')
    input_label = action.get('inputLabel') or infer_base_label(label)
    target_label = action.get('targetLabel') or label
    existing_keys = {(p.get('baseId'), p.get('actionId'), p.get('label')) for p in project.setdefault('trainingPairs', [])}
    made = []
    excluded = set(action.get('excludedTrainingCharacters') or [])
    for c in project.get('characters', []):
        if c.get('id') in excluded:
            continue
        base = training_sprite_by_label(c, input_label)
        target = training_sprite_by_label(c, target_label)
        if not base or not target:
            continue
        key = (base.get('id'), target.get('id'), label)
        if key in existing_keys:
            continue
        pair = {'id': uuid.uuid4().hex, 'baseId': base.get('id'), 'actionId': target.get('id'), 'label': label, 'characterId': c.get('id'), 'source': 'label-scan', 'createdAt': now()}
        project['trainingPairs'].append(pair)
        made.append(pair)
        existing_keys.add(key)
    return made

@app.get("/api/template/schema")
def template_schema():
    return {
        'required': ['name', 'frameWidth', 'frameHeight'],
        'fields': {
            'id': 'optional stable id; generated when omitted',
            'name': 'human readable template name',
            'frameWidth': 'cell width in pixels',
            'frameHeight': 'cell height in pixels',
            'marginX': 'left margin before first cell',
            'marginY': 'top margin before first cell',
            'spacingX': 'horizontal spacing between cells',
            'spacingY': 'vertical spacing between cells',
            'directions': ['down', 'left', 'right', 'up'],
            'baseCells': {'down': {'row': 0, 'col': 0}},
            'animations': {'walk_down': [{'row': 0, 'col': 0, 'duration': 120}]},
            'defaultExtractScale': {'mode': 'down', 'factor': 2}
        }
    }

@app.post("/api/template/agent")
async def create_template_for_agents(payload: Dict[str, Any]):
    required = ['name', 'frameWidth', 'frameHeight']
    missing = [k for k in required if k not in payload]
    if missing:
        raise HTTPException(400, f'Missing required template fields: {", ".join(missing)}')
    t = payload.copy()
    t.setdefault('id', 'tpl_' + safe_name(str(t.get('name'))).lower())
    t.setdefault('marginX', 0); t.setdefault('marginY', 0); t.setdefault('spacingX', 0); t.setdefault('spacingY', 0)
    t.setdefault('directions', ['down', 'left', 'right', 'up'])
    t.setdefault('baseCells', {})
    t.setdefault('animations', {})
    p = load_project()
    templates = p.setdefault('templates', [])
    i = next((i for i, x in enumerate(templates) if x.get('id') == t['id']), None)
    t['updatedAt'] = now()
    if i is None:
        templates.insert(0, t)
    else:
        templates[i] = t
    save_project(p)
    return t

@app.post("/api/scale")
async def scale_asset(payload: Dict[str, Any]):
    p = load_project()
    source_id = payload.get('sourceId')
    mode = payload.get('mode') or 'up'
    factor = int(payload.get('factor') or 2)
    item = find_sprite(p, source_id)
    if not item:
        raise HTTPException(404, 'Source asset not found')
    img = resize_nearest(get_image_by_path(item['path']), mode, factor)
    kind = 'sheet' if any(s.get('id') == source_id for s in p.get('sheets', [])) else 'sprite'
    new_id = uuid.uuid4().hex
    suffix = f"x{factor}" if mode == 'up' else f"down{factor}"
    if kind == 'sheet':
        rel = f"sheets/{safe_name(item.get('name') or 'sheet')}_{suffix}_{new_id}.png"
        (ASSETS/'sheets').mkdir(parents=True, exist_ok=True)
        img.save(ASSETS/rel)
        original_settings = item.get('settings') or {}
        settings = dict(original_settings)
        if settings:
            if mode == 'up':
                for k in ['frameWidth','frameHeight','marginX','marginY','spacingX','spacingY']:
                    settings[k] = int(settings.get(k, 0)) * factor
            else:
                for k in ['frameWidth','frameHeight','marginX','marginY','spacingX','spacingY']:
                    settings[k] = max(0, int(settings.get(k, 0)) // factor)
                settings['frameWidth'] = max(1, settings.get('frameWidth', 1)); settings['frameHeight'] = max(1, settings.get('frameHeight', 1))
        sheet = {**item, 'id': new_id, 'name': f"{item.get('name','sheet')} ({suffix})", 'path': rel, 'url': asset_url(rel), 'width': img.width, 'height': img.height, 'settings': settings, 'createdAt': now(), 'updatedAt': now()}
        p.setdefault('sheets', []).insert(0, sheet)
        if sheet.get('characterId'):
            c = next((c for c in p.get('characters', []) if c.get('id') == sheet.get('characterId')), None)
            if c:
                ids = c.setdefault('sheetIds', [])
                if new_id not in ids: ids.append(new_id)
        save_project(p)
        return sheet
    else:
        rel = f"generated/{safe_name(item.get('label') or item.get('name') or 'sprite')}_{suffix}_{new_id}.png"
        (ASSETS/'generated').mkdir(parents=True, exist_ok=True)
        img.save(ASSETS/rel)
        generated = {'id': new_id, 'name': f"{item.get('label') or item.get('name','sprite')} ({suffix})", 'label': item.get('label','scaled'), 'targetId': source_id, 'path': rel, 'url': asset_url(rel), 'width': img.width, 'height': img.height, 'createdAt': now(), 'palette': extract_palette(img)}
        p.setdefault('generated', []).insert(0, generated)
        save_project(p)
        return generated



def remove_asset_file(rel: str) -> None:
    if not rel:
        return
    target = ASSETS / rel
    try:
        if target.exists() and target.is_file():
            target.unlink()
    except OSError:
        pass

@app.delete("/api/sheet-version/{sid}")
def delete_sheet_version(sid: str):
    p = load_project()
    sheet = next((s for s in p.get('sheets', []) if s.get('id') == sid), None)
    if not sheet:
        raise HTTPException(404, 'Sheet version not found')
    family_id = sheet.get('familyId') or sheet.get('id')
    versions = [s for s in p.get('sheets', []) if (s.get('familyId') or s.get('id')) == family_id and s.get('id') != sid]
    p['sheets'] = [s for s in p.get('sheets', []) if s.get('id') != sid]
    for c in p.get('characters', []):
        c['sheetIds'] = [x for x in c.get('sheetIds', []) if x != sid]
    remove_asset_file(sheet.get('path', ''))
    if versions:
        replacement = versions[0]
        set_sheet_family_current(p, family_id, replacement.get('id'))
    save_project(p)
    return {'ok': True, 'deletedId': sid, 'remainingVersions': len(versions)}

@app.delete("/api/sheet-family/{family_id}")
def delete_sheet_family(family_id: str):
    p = load_project()
    versions = [s for s in p.get('sheets', []) if (s.get('familyId') or s.get('id')) == family_id]
    if not versions:
        raise HTTPException(404, 'Sheet family not found')
    ids = {s.get('id') for s in versions}
    p['sheets'] = [s for s in p.get('sheets', []) if s.get('id') not in ids]
    for s in versions:
        remove_asset_file(s.get('path', ''))
    for c in p.get('characters', []):
        c['sheetIds'] = [x for x in c.get('sheetIds', []) if x not in ids]
    save_project(p)
    return {'ok': True, 'deletedVersions': len(ids)}

@app.patch("/api/actions/{label}")
async def update_action(label: str, payload: Dict[str, Any]):
    p = load_project()
    action = next((a for a in p.get('actions', []) if a.get('label') == label), None)
    if not action:
        raise HTTPException(404, 'Action not found')
    old_label = action.get('label')
    for key in ['label', 'name', 'description', 'inputLabel', 'targetLabel', 'referenceLabels', 'excludedTrainingCharacters', 'prefix', 'framesPerDirection', 'directions']:
        if key in payload:
            action[key] = payload[key]
    action['updatedAt'] = now()
    if action.get('label') != old_label:
        for tp in p.get('trainingPairs', []):
            if tp.get('label') == old_label:
                tp['label'] = action.get('label')
    save_project(p)
    return action

@app.get("/api/actions/{label}/stats")
def action_stats(label: str):
    p = load_project()
    action = next((a for a in p.get('actions', []) if a.get('label') == label), None)
    if not action:
        raise HTTPException(404, 'Action not found')
    ready = []
    incomplete = []
    inp = action.get('inputLabel') or infer_base_label(action.get('targetLabel') or label)
    tgt = action.get('targetLabel') or label
    for c in p.get('characters', []):
        b = training_sprite_by_label(c, inp)
        t = training_sprite_by_label(c, tgt)
        row = {'characterId': c.get('id'), 'characterName': c.get('name'), 'hasInput': bool(b), 'hasTarget': bool(t)}
        (ready if b and t else incomplete).append(row)
    pair_count = len([x for x in p.get('trainingPairs', []) if x.get('label') == label])
    learned = action.get('learned') or {}
    consistency = 'untrained'
    if learned.get('exampleCount', 0) >= 3:
        consistency = 'high'
    elif learned.get('exampleCount', 0) >= 1:
        consistency = 'medium'
    return {'ready': ready, 'incomplete': incomplete, 'pairCount': pair_count, 'learned': learned, 'consistency': consistency}


@app.patch("/api/template/{template_id}")
async def update_template(template_id: str, payload: Dict[str, Any]):
    p = load_project()
    templates = p.setdefault('templates', [])
    t = next((x for x in templates if x.get('id') == template_id), None)
    if not t:
        raise HTTPException(404, 'Template not found')
    if t.get('id') in {x.get('id') for x in BUILTIN_TEMPLATES} and not payload.get('allowBuiltinEdit'):
        raise HTTPException(400, 'Built-in templates are protected. Duplicate first, then edit the copy.')
    for key in ['name', 'description', 'steps', 'templateKind', 'directions', 'frameWidth', 'frameHeight', 'outputFrameWidth', 'outputFrameHeight', 'marginX', 'marginY', 'spacingX', 'spacingY', 'defaultOptions', 'optionSchema']:
        if key in payload:
            t[key] = payload[key]
    t['updatedAt'] = now()
    save_project(p)
    return t

@app.delete("/api/template/{template_id}")
def delete_template(template_id: str):
    if template_id in {x.get('id') for x in BUILTIN_TEMPLATES}:
        raise HTTPException(400, 'Built-in templates cannot be deleted.')
    p = load_project()
    before = len(p.get('templates', []))
    p['templates'] = [t for t in p.get('templates', []) if t.get('id') != template_id]
    if len(p['templates']) == before:
        raise HTTPException(404, 'Template not found')
    save_project(p)
    return {'ok': True}

@app.delete("/api/actions/{label}")
def delete_action(label: str):
    p = load_project()
    target = next((a for a in p.get('actions', []) if a.get('label') == label), None)
    owned_labels = {label}
    if target and target.get('type') == 'behavior':
        # Behavior frame transforms are internal; remove any legacy single-frame
        # actions/training pairs that match this behavior's generated labels.
        for labs in complete_behavior_labels(target).values():
            owned_labels.update(labs)
        behavior_id = target.get('id')
        p['actions'] = [a for a in p.get('actions', []) if a.get('label') not in owned_labels and a.get('ownerBehaviorId') != behavior_id]
    else:
        p['actions'] = [a for a in p.get('actions', []) if a.get('label') != label]
    p['trainingPairs'] = [tp for tp in p.get('trainingPairs', []) if tp.get('label') not in owned_labels]
    save_project(p)
    return {'ok': True, 'deletedLabels': sorted(owned_labels)}

@app.post("/api/template")
async def save_template(payload: Dict[str, Any]):
    p=load_project(); t=payload.copy(); t.setdefault('id', uuid.uuid4().hex); t['updatedAt']=now()
    templates=p.setdefault('templates', [])
    i=next((i for i,x in enumerate(templates) if x.get('id')==t['id']), None)
    if i is None: templates.insert(0,t)
    else: templates[i]=t
    save_project(p); return t

@app.post("/api/training-pair")
async def add_pair(payload: Dict[str, Any]):
    p=load_project(); pair={"id": uuid.uuid4().hex, "baseId": payload['baseId'], "actionId": payload['actionId'], "label": payload['label'], "anchors": payload.get('anchors', {}), "createdAt": now()}
    p.setdefault('trainingPairs', []).append(pair); save_project(p); return pair

@app.delete("/api/training-pair/{pid}")
def delete_pair(pid: str):
    p=load_project(); p['trainingPairs']=[x for x in p.get('trainingPairs', []) if x.get('id')!=pid]; save_project(p); return {"ok": True}

@app.post("/api/train/{label}")
def train(label: str):
    p=load_project()
    action = next((a for a in p.get('actions', []) if a.get('label') == label), None) or {'label': label, 'inputLabel': infer_base_label(label), 'targetLabel': label}
    made = ensure_training_pairs_for_action(p, action)
    result = learn_transform(p, label)
    result['autoPairsCreated'] = len(made)
    save_project(p)
    return result

@app.post("/api/generate")
async def generate(payload: Dict[str, Any]):
    p=load_project(); return apply_transform(p, payload['targetId'], payload['label'], payload.get('name',''))

@app.post("/api/save-edited")
async def save_edited(payload: Dict[str, Any]):
    p=load_project()
    data=payload.get('dataUrl','')
    if ',' in data: data=data.split(',',1)[1]
    raw=base64.b64decode(data)
    img=normalize_png(Image.open(io.BytesIO(raw)))
    gid=uuid.uuid4().hex; name=payload.get('name') or 'edited_sprite'
    rel=f"generated/{name}_{gid}.png"; (ASSETS/'generated').mkdir(exist_ok=True); img.save(ASSETS/rel)
    item={"id": gid, "name": name, "label": payload.get('label','edited'), "targetId": payload.get('sourceId',''), "path": rel, "url": asset_url(rel), "width": img.width, "height": img.height, "createdAt": now(), "palette": extract_palette(img)}
    p.setdefault('generated', []).insert(0,item); save_project(p); return item

@app.get("/asset/{path:path}")
def serve_asset(path: str):
    full=ASSETS/path
    if not full.exists(): raise HTTPException(404, "Asset not found")
    return FileResponse(full)



# --- v10 behavior/action-set helpers and asset cleanup endpoints ---
DIRECTION_ORDER = ['down', 'left', 'right', 'up']


def sprite_by_label(project: Dict[str, Any], character_id: str, label: str) -> Optional[Dict[str, Any]]:
    c = next((x for x in project.get('characters', []) if x.get('id') == character_id), None)
    if not c:
        return None
    return character_sprite_by_label(c, label)


def apply_learned_to_image(project: Dict[str, Any], base: Image.Image, action: Dict[str, Any]) -> Image.Image:
    learned = action.get('learned') or {}
    if not learned:
        raise HTTPException(400, f"Action {action.get('label')} has not been trained.")
    overlay = get_image_by_path(learned['overlayPath'])
    w = min(base.width, int(learned.get('width') or base.width))
    h = min(base.height, int(learned.get('height') or base.height))
    out = base.copy().crop((0, 0, w, h))
    arr = np.array(out)
    for y, x in learned.get('removePixels', []):
        if 0 <= y < h and 0 <= x < w:
            arr[y, x] = [0, 0, 0, 0]
    out = Image.fromarray(arr, 'RGBA')
    out.alpha_composite(overlay.crop((0, 0, w, h)), (0, 0))
    return out


def behavior_frame_labels(prefix: str, directions: Optional[List[str]] = None, frames_per_direction: int = 4) -> Dict[str, List[str]]:
    dirs = directions or DIRECTION_ORDER
    prefix = safe_name(prefix or 'behavior').lower() or 'behavior'
    return {d: [f'{prefix}_{d}_{i}' for i in range(int(frames_per_direction or 4))] for d in dirs}


def behavior_sources(project: Dict[str, Any], behavior: Dict[str, Any]) -> Dict[str, Any]:
    prefix = behavior.get('prefix') or behavior.get('label') or 'behavior'
    directions = behavior.get('directions') or DIRECTION_ORDER
    frames_per_direction = int(behavior.get('framesPerDirection') or 4)
    labels = behavior_frame_labels(prefix, directions, frames_per_direction)
    ready, incomplete, excluded_generated = [], [], []
    for c in project.get('characters', []):
        missing = []
        excluded = []
        for d in directions:
            base_label = f'base_{d}'
            if not training_sprite_by_label(c, base_label):
                raw = character_sprite_by_label(c, base_label)
                if raw and sprite_is_generated(raw) and not raw.get('useForTraining'):
                    excluded.append(base_label)
                else:
                    missing.append(base_label)
            for lab in labels[d]:
                if not training_sprite_by_label(c, lab):
                    raw = character_sprite_by_label(c, lab)
                    if raw and sprite_is_generated(raw) and not raw.get('useForTraining'):
                        excluded.append(lab)
                    else:
                        missing.append(lab)
        row = {'characterId': c.get('id'), 'characterName': c.get('name'), 'missing': missing, 'excludedGeneratedLabels': excluded}
        if not missing and not excluded:
            ready.append(row)
        else:
            incomplete.append(row)
            if excluded:
                excluded_generated.append(row)
    return {'ready': ready, 'incomplete': incomplete, 'excludedGenerated': excluded_generated, 'labels': labels}


def behavior_training_source_rows(project: Dict[str, Any], behavior: Dict[str, Any]) -> List[Dict[str, Any]]:
    src = behavior_sources(project, behavior)
    excluded_ids = set(behavior.get('excludedTrainingCharacters') or [])
    by_id = {}
    for bucket in ('ready', 'incomplete', 'excludedGenerated'):
        for row in src.get(bucket, []):
            by_id[row.get('characterId')] = {**row, '_bucket': bucket}
    rows: List[Dict[str, Any]] = []
    for c in project.get('characters', []):
        cid = c.get('id')
        base = by_id.get(cid, {'characterId': cid, 'characterName': c.get('name'), 'missing': [], 'excludedGeneratedLabels': []})
        missing = base.get('missing') or []
        gen_ex = base.get('excludedGeneratedLabels') or []
        if cid in excluded_ids:
            status = 'excluded'
            provenance = 'manual'
            missing_reason = 'excluded from training'
        elif base.get('_bucket') == 'ready':
            status = 'included'
            provenance = 'template-extracted'
            missing_reason = ''
        elif gen_ex and not missing:
            status = 'excluded'
            provenance = 'generated'
            missing_reason = 'generated excluded'
        elif missing:
            status = 'missing'
            provenance = 'imported'
            missing_reason = ', '.join(missing[:4]) + ('…' if len(missing) > 4 else '')
        else:
            status = 'incomplete'
            provenance = 'imported'
            missing_reason = 'incomplete source set'
        rows.append({
            'characterId': cid,
            'characterName': c.get('name'),
            'status': status,
            'provenance': provenance,
            'missingReason': missing_reason,
            'ready': status == 'included',
        })
    return rows

@app.delete('/api/character/{cid}/sprite/{sprite_id}')
def delete_character_sprite(cid: str, sprite_id: str):
    p = load_project()
    c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    sp = next((x for x in c.get('sprites', []) if x.get('id') == sprite_id), None)
    if not sp:
        raise HTTPException(404, 'Sprite not found')
    # Remove frame references but keep animations if they still have frames.
    for a in p.get('animations', []):
        if a.get('characterId') == cid:
            a['frames'] = [f for f in a.get('frames', []) if f.get('spriteId') != sprite_id]
    p['animations'] = [a for a in p.get('animations', []) if a.get('characterId') != cid or a.get('frames')]
    c['sprites'] = [x for x in c.get('sprites', []) if x.get('id') != sprite_id]
    c['updatedAt'] = now()
    save_project(p)
    return {'ok': True}


@app.delete('/api/animation/{animation_id}')
def delete_animation(animation_id: str):
    p = load_project()
    before = len(p.get('animations', []))
    p['animations'] = [a for a in p.get('animations', []) if a.get('id') != animation_id]
    if len(p['animations']) == before:
        raise HTTPException(404, 'Animation not found')
    save_project(p)
    return {'ok': True}


@app.patch('/api/animation/{animation_id}')
async def update_animation(animation_id: str, payload: Dict[str, Any]):
    p = load_project()
    a = next((x for x in p.get('animations', []) if x.get('id') == animation_id), None)
    if not a:
        raise HTTPException(404, 'Animation not found')
    if 'name' in payload:
        a['name'] = payload.get('name') or a.get('name')
    if 'loop' in payload:
        a['loop'] = bool(payload.get('loop'))
    if 'frames' in payload:
        cid = a.get('characterId')
        c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
        valid = {s.get('id'): s for s in (c or {}).get('sprites', [])}
        frames = []
        for f in payload.get('frames') or []:
            sid = f.get('spriteId')
            if sid not in valid:
                continue
            frames.append({'spriteId': sid, 'label': valid[sid].get('label'), 'duration': int(f.get('duration') or 120)})
        if frames:
            a['frames'] = frames
    a['updatedAt'] = now()
    save_project(p)
    return a




def complete_behavior_labels(behavior: Dict[str, Any]) -> Dict[str, List[str]]:
    return behavior_frame_labels(behavior.get('prefix') or behavior.get('label') or 'behavior', behavior.get('directions') or DIRECTION_ORDER, int(behavior.get('framesPerDirection') or 4))


def behavior_frame_pairs(project: Dict[str, Any], behavior: Dict[str, Any], direction: str, frame_label: str) -> List[Dict[str, Any]]:
    pairs = []
    base_label = f'base_{direction}'
    excluded = set(behavior.get('excludedTrainingCharacters') or [])
    for c in project.get('characters', []):
        if c.get('id') in excluded:
            continue
        base = training_sprite_by_label(c, base_label)
        target = training_sprite_by_label(c, frame_label)
        if base and target:
            pairs.append({'baseId': base.get('id'), 'actionId': target.get('id'), 'label': frame_label, 'characterId': c.get('id'), 'source': 'behavior-scan'})
    return pairs


def generated_behavior_records(character: Dict[str, Any]) -> List[Dict[str, Any]]:
    return character.setdefault('generatedBehaviors', [])

@app.post('/api/behaviors/define')
async def define_behavior(payload: Dict[str, Any]):
    p = load_project()
    prefix = safe_name(payload.get('prefix') or payload.get('label') or payload.get('name') or 'behavior').lower()
    label = payload.get('label') or prefix
    behavior = next((a for a in p.setdefault('actions', []) if a.get('label') == label), None)
    data = {
        'type': 'behavior',
        'label': label,
        'name': payload.get('name') or label.title(),
        'description': payload.get('description') or '',
        'prefix': prefix,
        'directions': payload.get('directions') or DIRECTION_ORDER,
        'framesPerDirection': int(payload.get('framesPerDirection') or 4),
        'inputMode': payload.get('inputMode') or 'base_directions',
        'updatedAt': now(),
    }
    if behavior:
        behavior.update(data)
    else:
        behavior = {'id': uuid.uuid4().hex, 'createdAt': now(), **data}
        p['actions'].append(behavior)
    save_project(p)
    return behavior


@app.get('/api/behaviors/{label}/sources')
def get_behavior_sources(label: str):
    p = load_project()
    behavior = next((a for a in p.get('actions', []) if a.get('label') == label and a.get('type') == 'behavior'), None)
    if not behavior:
        raise HTTPException(404, 'Behavior not found')
    src = behavior_sources(p, behavior)
    rows = behavior_training_source_rows(p, behavior)
    return {'behavior': behavior, 'rows': rows, **src}


@app.patch('/api/behaviors/{label}/training-source/{character_id}')
async def set_behavior_training_source(label: str, character_id: str, payload: Dict[str, Any]):
    p = load_project()
    behavior = next((a for a in p.get('actions', []) if a.get('label') == label and a.get('type') == 'behavior'), None)
    if not behavior:
        raise HTTPException(404, 'Behavior not found')
    c = next((x for x in p.get('characters', []) if x.get('id') == character_id), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    included = bool(payload.get('included'))
    excluded = list(behavior.get('excludedTrainingCharacters') or [])
    prefix = behavior.get('prefix') or behavior.get('label') or 'behavior'
    directions = behavior.get('directions') or DIRECTION_ORDER
    fpd = int(behavior.get('framesPerDirection') or 4)
    labels = behavior_frame_labels(prefix, directions, fpd)
    touch_labels = {f'base_{d}' for d in directions}
    for labs in labels.values():
        touch_labels.update(labs)
    if included:
        if character_id in excluded:
            excluded.remove(character_id)
        for lab in touch_labels:
            sp = character_sprite_by_label(c, lab)
            if sp and sprite_is_generated(sp):
                sp['useForTraining'] = True
                sp['updatedAt'] = now()
    else:
        if character_id not in excluded:
            excluded.append(character_id)
        for lab in touch_labels:
            sp = character_sprite_by_label(c, lab)
            if sp and sprite_is_generated(sp):
                sp['useForTraining'] = False
                sp['updatedAt'] = now()
    behavior['excludedTrainingCharacters'] = excluded
    behavior['updatedAt'] = now()
    save_project(p)
    rows = behavior_training_source_rows(p, behavior)
    row = next((r for r in rows if r.get('characterId') == character_id), None)
    return {'ok': True, 'row': row, 'rows': rows, 'behavior': behavior}


@app.post('/api/behaviors/{label}/train')
def train_behavior(label: str):
    p = load_project()
    behavior = next((a for a in p.get('actions', []) if a.get('label') == label and a.get('type') == 'behavior'), None)
    if not behavior:
        raise HTTPException(404, 'Behavior not found')
    src = behavior_sources(p, behavior)
    labels = src['labels']
    learned_frames: Dict[str, Any] = {}
    quality: Dict[str, Any] = {}
    for direction, frame_labels in labels.items():
        quality[direction] = []
        for frame_label in frame_labels:
            pairs = behavior_frame_pairs(p, behavior, direction, frame_label)
            if pairs:
                try:
                    learned = build_learned_from_pairs(p, pairs, f'{label}:{frame_label}', upsert_action=False)
                    learned['targetLabel'] = frame_label
                    learned['inputLabel'] = f'base_{direction}'
                    learned_frames.setdefault(direction, []).append(learned)
                    quality[direction].append({'label': frame_label, 'examples': learned.get('exampleCount', 0), 'consistency': learned.get('consistency'), 'uncertainPixels': learned.get('uncertainPixels', 0)})
                except HTTPException:
                    quality[direction].append({'label': frame_label, 'examples': 0, 'consistency': 'missing', 'uncertainPixels': 0})
            else:
                quality[direction].append({'label': frame_label, 'examples': 0, 'consistency': 'missing', 'uncertainPixels': 0})
    behavior['learnedFrames'] = learned_frames
    behavior['quality'] = quality
    behavior['updatedAt'] = now()
    behavior['trainedAt'] = now()
    behavior['trainingSourceCount'] = len(src['ready'])
    save_project(p)
    return {'ok': True, 'behavior': behavior, 'trainedFrameCount': sum(len(v) for v in learned_frames.values()), 'readySources': len(src['ready']), 'quality': quality}

@app.post('/api/behaviors/{label}/preview')
async def preview_behavior_generation(label: str, payload: Dict[str, Any]):
    """Generate behavior frames as temporary preview data URLs, without saving."""
    p = load_project()
    behavior = next((a for a in p.get('actions', []) if a.get('label') == label and a.get('type') == 'behavior'), None)
    if not behavior:
        raise HTTPException(404, 'Behavior not found')
    cid = payload.get('characterId')
    c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    learned_frames = behavior.get('learnedFrames') or {}
    previews = {}
    for direction in behavior.get('directions') or DIRECTION_ORDER:
        base = character_sprite_by_label(c, f'base_{direction}')
        if not base:
            continue
        base_img = get_image_by_path(base['path'])
        frames = []
        for learned in learned_frames.get(direction, []):
            out = apply_learned_dict_to_image(base_img, learned)
            frames.append({'label': learned.get('targetLabel'), 'dataUrl': png_data_url(out), 'duration': int(payload.get('duration') or 120)})
        previews[direction] = frames
    return {'ok': True, 'behavior': behavior, 'previews': previews}


def apply_learned_dict_to_image(base: Image.Image, learned: Dict[str, Any]) -> Image.Image:
    """Apply learned data conservatively.

    v12 preserves the target base in uncertain areas, clears only approved/high-
    confidence removal pixels, and never clears artist-protected pixels. This is
    intentionally cautious because extra pixels are easier to clean than a
    missing body.
    """
    overlay = get_image_by_path(learned['overlayPath'])
    w = min(base.width, int(learned.get('width') or base.width))
    h = min(base.height, int(learned.get('height') or base.height))
    out = base.copy().crop((0, 0, w, h))
    arr = np.array(out)
    protected = {tuple(p) for p in learned.get('protectedPixels', [])}
    suppressed_remove = {tuple(p) for p in learned.get('suppressedRemovePixels', [])}
    for y, x in learned.get('removePixels', []):
        pt = (y, x)
        if pt in protected or pt in suppressed_remove:
            continue
        if 0 <= y < h and 0 <= x < w:
            arr[y, x] = [0, 0, 0, 0]
    out = Image.fromarray(arr, 'RGBA')
    # Protected regions also suppress overlay changes.
    if protected:
        ov = np.array(overlay.crop((0, 0, w, h)))
        for y, x in protected:
            if 0 <= y < h and 0 <= x < w:
                ov[y, x] = [0, 0, 0, 0]
        overlay_img = Image.fromarray(ov, 'RGBA')
    else:
        overlay_img = overlay.crop((0, 0, w, h))
    out.alpha_composite(overlay_img, (0, 0))
    return out


@app.post('/api/behaviors/{label}/generate')
async def generate_behavior(label: str, payload: Dict[str, Any]):
    p = load_project()
    behavior = next((a for a in p.get('actions', []) if a.get('label') == label and a.get('type') == 'behavior'), None)
    if not behavior:
        raise HTTPException(404, 'Behavior not found')
    cid = payload.get('characterId')
    c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    prefix = behavior.get('prefix') or label
    directions = behavior.get('directions') or DIRECTION_ORDER
    replace = bool(payload.get('replaceExisting'))
    learned_frames = behavior.get('learnedFrames') or {}
    if not learned_frames:
        raise HTTPException(400, 'Train this behavior before generating it.')

    # If replacing a previous generated behavior, remove it as one package.
    if replace:
        remove_generated_behavior_from_character(p, cid, label)

    created = []
    made_animations = []
    created_ids = []
    animation_ids = []
    for d in directions:
        base = character_sprite_by_label(c, f'base_{d}')
        if not base:
            continue
        base_img = get_image_by_path(base['path'])
        anim_frames = []
        for idx, learned in enumerate(learned_frames.get(d, [])):
            out_label = learned.get('targetLabel') or f'{prefix}_{d}_{idx}'
            out_img = apply_learned_dict_to_image(base_img, learned)
            sp = make_sprite_from_image(p, cid, out_img, out_label, d, {'type': 'behavior-generate', 'behavior': label, 'behaviorId': behavior.get('id'), 'direction': d, 'frameIndex': idx}, True)
            created.append(sp); created_ids.append(sp['id'])
            anim_frames.append({'spriteId': sp['id'], 'label': sp.get('label'), 'duration': int(payload.get('duration') or 120)})
        if anim_frames:
            anim_name = f'{prefix}_{d}'
            p['animations'] = [a for a in p.get('animations', []) if not (a.get('characterId') == cid and a.get('source', {}).get('type') == 'behavior-generate' and a.get('source', {}).get('behavior') == label and a.get('name') == anim_name)]
            anim = {'id': uuid.uuid4().hex, 'name': anim_name, 'characterId': cid, 'frames': anim_frames, 'loop': True, 'source': {'type': 'behavior-generate', 'behavior': label, 'behaviorId': behavior.get('id')}, 'createdAt': now(), 'updatedAt': now()}
            p.setdefault('animations', []).append(anim)
            made_animations.append(anim); animation_ids.append(anim['id'])
    records = generated_behavior_records(c)
    records[:] = [r for r in records if r.get('behavior') != label]
    records.append({'id': uuid.uuid4().hex, 'behavior': label, 'behaviorId': behavior.get('id'), 'prefix': prefix, 'createdSpriteIds': created_ids, 'createdAnimationIds': animation_ids, 'createdAt': now(), 'updatedAt': now(), 'manualEdits': False})
    c['updatedAt'] = now()
    save_project(p)
    return {'ok': True, 'createdSprites': created, 'animations': made_animations, 'count': len(created), 'record': records[-1]}


def remove_generated_behavior_from_character(project: Dict[str, Any], character_id: str, behavior_label: str) -> Dict[str, Any]:
    c = next((x for x in project.get('characters', []) if x.get('id') == character_id), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    records = [r for r in c.get('generatedBehaviors', []) if r.get('behavior') == behavior_label]
    sprite_ids = {sid for r in records for sid in r.get('createdSpriteIds', [])}
    anim_ids = {aid for r in records for aid in r.get('createdAnimationIds', [])}
    # Also catch assets by source metadata for older records.
    for s in c.get('sprites', []):
        if s.get('source', {}).get('type') == 'behavior-generate' and s.get('source', {}).get('behavior') == behavior_label:
            sprite_ids.add(s.get('id'))
    for a in project.get('animations', []):
        if a.get('characterId') == character_id and a.get('source', {}).get('type') == 'behavior-generate' and a.get('source', {}).get('behavior') == behavior_label:
            anim_ids.add(a.get('id'))
    deleted_sprites = [s for s in c.get('sprites', []) if s.get('id') in sprite_ids]
    c['sprites'] = [s for s in c.get('sprites', []) if s.get('id') not in sprite_ids]
    project['animations'] = [a for a in project.get('animations', []) if a.get('id') not in anim_ids]
    c['generatedBehaviors'] = [r for r in c.get('generatedBehaviors', []) if r.get('behavior') != behavior_label]
    for sp in deleted_sprites:
        remove_asset_file(sp.get('path', ''))
    c['updatedAt'] = now()
    return {'deletedSprites': len(sprite_ids), 'deletedAnimations': len(anim_ids)}


@app.get('/api/character/{cid}/behaviors')
def list_character_behaviors(cid: str):
    p = load_project()
    c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    out = []
    for rec in c.get('generatedBehaviors', []):
        behavior = next((a for a in p.get('actions', []) if a.get('label') == rec.get('behavior')), None)
        out.append({**rec, 'behaviorName': (behavior or {}).get('name') or rec.get('behavior'), 'spriteCount': len(rec.get('createdSpriteIds', [])), 'animationCount': len(rec.get('createdAnimationIds', []))})
    return {'character': {'id': c.get('id'), 'name': c.get('name')}, 'behaviors': out}


@app.delete('/api/character/{cid}/behaviors/{behavior_label}')
def delete_character_behavior(cid: str, behavior_label: str):
    p = load_project()
    result = remove_generated_behavior_from_character(p, cid, behavior_label)
    save_project(p)
    return {'ok': True, **result}


def learned_refs_by_id(project: Dict[str, Any], learned_id: str) -> List[Dict[str, Any]]:
    refs: List[Dict[str, Any]] = []
    for a in project.get('actions', []):
        if (a.get('learned') or {}).get('id') == learned_id:
            refs.append(a['learned'])
        for frames in (a.get('learnedFrames') or {}).values():
            for lf in frames:
                if lf.get('id') == learned_id:
                    refs.append(lf)
    return refs


@app.post('/api/learned/{learned_id}/erase')
async def erase_learned_rect(learned_id: str, payload: Dict[str, Any]):
    """Backward-compatible overlay erase endpoint."""
    payload['layer'] = payload.get('layer') or 'overlay'
    return await edit_learned_rect(learned_id, payload)


@app.post('/api/learned/{learned_id}/edit-rect')
async def edit_learned_rect(learned_id: str, payload: Dict[str, Any]):
    """Artist-tune learned data by region.

    layer='overlay' clears added pixels; layer='remove' suppresses removals so
    the target base is preserved; layer='protect' prevents both removal and
    overlay changes in the region.
    """
    p = load_project()
    refs = learned_refs_by_id(p, learned_id)
    if not refs:
        raise HTTPException(404, 'Learned pattern not found')
    x = max(0, int(payload.get('x') or 0)); y = max(0, int(payload.get('y') or 0))
    w = max(1, int(payload.get('w') or 1)); h = max(1, int(payload.get('h') or 1))
    layer = payload.get('layer') or 'overlay'
    for learned in refs:
        if layer == 'overlay':
            img = get_image_by_path(learned['overlayPath'])
            arr = np.array(img)
            arr[y:y+h, x:x+w] = [0,0,0,0]
            Image.fromarray(arr, 'RGBA').save(ASSETS / learned['overlayPath'])
        elif layer == 'remove':
            blocked = {tuple(p) for p in learned.get('suppressedRemovePixels', [])}
            for yy in range(y, y+h):
                for xx in range(x, x+w):
                    blocked.add((yy, xx))
            learned['suppressedRemovePixels'] = [list(p) for p in sorted(blocked)]
        elif layer == 'protect':
            protected = {tuple(p) for p in learned.get('protectedPixels', [])}
            for yy in range(y, y+h):
                for xx in range(x, x+w):
                    protected.add((yy, xx))
            learned['protectedPixels'] = [list(p) for p in sorted(protected)]
        else:
            raise HTTPException(400, 'Unknown learned-data layer')
        learned['editedAt'] = now(); learned['edited'] = True
    save_project(p)
    return {'ok': True, 'edited': len(refs), 'layer': layer}

@app.get('/api/export/behavior-sheet/{character_id}/{behavior_label}')
def export_behavior_sheet(character_id: str, behavior_label: str, scale: int = 1):
    p = load_project()
    c = next((x for x in p.get('characters', []) if x.get('id') == character_id), None)
    behavior = next((a for a in p.get('actions', []) if a.get('label') == behavior_label and a.get('type') == 'behavior'), None)
    if not c or not behavior:
        raise HTTPException(404, 'Character or behavior not found')
    prefix = behavior.get('prefix') or behavior_label
    directions = behavior.get('directions') or DIRECTION_ORDER
    labels = behavior_frame_labels(prefix, directions, int(behavior.get('framesPerDirection') or 4))
    first = None
    for labs in labels.values():
        for lab in labs:
            sp = character_sprite_by_label(c, lab)
            if sp:
                first = sp; break
        if first: break
    if not first:
        raise HTTPException(404, 'No behavior sprites found on this character')
    sample = get_image_by_path(first['path'])
    fw, fh = sample.width, sample.height
    sheet = Image.new('RGBA', (fw * len(next(iter(labels.values()))), fh * len(directions)), (0,0,0,0))
    for r, d in enumerate(directions):
        for col, lab in enumerate(labels[d]):
            sp = character_sprite_by_label(c, lab)
            if sp:
                sheet.alpha_composite(get_image_by_path(sp['path']).crop((0,0,fw,fh)), (col*fw, r*fh))
    if int(scale or 1) > 1:
        sheet = sheet.resize((sheet.width*int(scale), sheet.height*int(scale)), Image.Resampling.NEAREST)
    out = EXPORTS / f"{safe_name(c.get('name','character'))}_{safe_name(prefix)}_sheet_{int(time.time())}.png"
    sheet.save(out)
    return FileResponse(out, filename=out.name)




@app.post('/api/batch/create-characters')
async def batch_create_characters(files: List[UploadFile] = File(...), templateId: str = Form('tpl_walk_cycle'), optionsJson: str = Form('{}'), nameMode: str = Form('filename')):
    """Create one character per uploaded sheet and populate via a chosen template.

    The frontend calls this for bulk walk-sheet projects. Default character names
    come from filenames and can be mass-renamed after import.
    """
    try:
        options = json.loads(optionsJson or '{}')
    except json.JSONDecodeError:
        options = {}
    results = []
    p = load_project()
    template = find_template(p, templateId)
    if not template:
        raise HTTPException(404, 'Template not found')
    existing_names = {c.get('name') for c in p.get('characters', [])}

    def unique_name(base: str) -> str:
        base = Path(base or 'Character').stem
        base = base.replace('_', ' ').replace('-', ' ').strip() or 'Character'
        if nameMode == 'title':
            base = base.title()
        candidate = base; n = 2
        while candidate in existing_names:
            candidate = f'{base} {n}'; n += 1
        existing_names.add(candidate)
        return candidate

    for file in files:
        char = {"id": uuid.uuid4().hex, "name": unique_name(file.filename or 'Character'), "tags": ["batch"], "sprites": [], "sheetIds": [], "createdAt": now(), "updatedAt": now()}
        p.setdefault('characters', []).insert(0, char)
        # Save upload using current project state.
        asset = save_upload(file, 'sheets')
        family_id = uuid.uuid4().hex
        sheet = {**asset, "characterId": char['id'], "templateId": templateId, "mappings": [], "animations": [], "familyId": family_id, "versionName": "Original", "versionRole": "original", "createdAt": now(), "updatedAt": now()}
        p.setdefault('sheets', []).insert(0, sheet)
        char.setdefault('sheetIds', []).append(sheet['id'])
        set_sheet_family_current(p, family_id, sheet['id'])
        save_project(p)
        # Apply template and populate. Re-load because called helper persists.
        applied = await apply_template_to_sheet(templateId, {'sheetId': sheet['id'], 'options': options})
        p = load_project()
        prepared_id = applied.get('sheet', {}).get('id') or sheet['id']
        populated = await extract_template_frames(prepared_id, {'characterId': char['id'], 'templateId': templateId, 'duplicateMode': 'replace', 'replaceExisting': True})
        results.append({'characterId': char['id'], 'characterName': char['name'], 'sheetId': prepared_id, 'spriteCount': populated.get('count', 0), 'animationCount': len(populated.get('animations', [])), 'status': 'created'})
        p = load_project()
    return {'ok': True, 'count': len(results), 'results': results}

@app.post('/api/batch/rename-characters')
async def batch_rename_characters(payload: Dict[str, Any]):
    p = load_project()
    changes = payload.get('changes') or []
    seen = {c.get('name') for c in p.get('characters', [])}
    changed = []
    for ch in changes:
        cid = ch.get('id'); new_name = (ch.get('name') or '').strip()
        if not cid or not new_name:
            continue
        c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
        if not c:
            continue
        old = c.get('name')
        if old in seen:
            seen.remove(old)
        candidate = new_name; n = 2
        while candidate in seen:
            candidate = f'{new_name} {n}'; n += 1
        c['name'] = candidate; c['updatedAt'] = now(); seen.add(candidate); changed.append({'id': cid, 'oldName': old, 'name': candidate})
    save_project(p)
    return {'ok': True, 'changed': changed}

@app.get("/api/export/project")
def export_project():
    zip_path=EXPORTS/f"spmk_project_{int(time.time())}.zip"
    if zip_path.exists(): zip_path.unlink()
    shutil.make_archive(str(zip_path.with_suffix('')), 'zip', WORKSPACE)
    return FileResponse(zip_path, filename=zip_path.name)

@app.get("/api/health")
def health():
    return {"ok": True, "workspace": str(WORKSPACE)}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', default=8788, type=int)
    args=parser.parse_args()
    import uvicorn
    print(f"SPMK running at http://{args.host}:{args.port}")
    uvicorn.run("spmk_app.server:app", host=args.host, port=args.port, reload=False)

if __name__ == '__main__':
    main()


@app.patch('/api/character/{cid}/sprite/{sprite_id}/training')
def set_sprite_training_inclusion(cid: str, sprite_id: str, payload: Dict[str, Any]):
    p = load_project()
    c = next((x for x in p.get('characters', []) if x.get('id') == cid), None)
    if not c:
        raise HTTPException(404, 'Character not found')
    sp = next((x for x in c.get('sprites', []) if x.get('id') == sprite_id), None)
    if not sp:
        raise HTTPException(404, 'Sprite not found')
    sp['useForTraining'] = bool(payload.get('useForTraining'))
    sp['updatedAt'] = now()
    save_project(p)
    return sp
