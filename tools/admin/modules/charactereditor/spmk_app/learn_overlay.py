"""Conservative mask-overlay learning from paired sprite images (shared by legacy + charbin generate)."""
from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import numpy as np
from PIL import Image


def safe_name(name: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in (name or "asset")).strip("_") or "asset"


def learn_from_image_pairs(
    pairs: Sequence[Tuple[Image.Image, Image.Image]],
    action_label: str,
    assets_dir: Path,
) -> Dict[str, Any]:
    """Learn overlay mask from (base, target) PIL pairs."""
    if not pairs:
        raise ValueError("No training pairs for this action label.")
    adds: List[np.ndarray] = []
    removes: List[np.ndarray] = []
    action_arrays: List[np.ndarray] = []
    sizes: List[tuple[int, int]] = []
    count = 0
    for base_im, target_im in pairs:
        b = base_im.convert("RGBA")
        a = target_im.convert("RGBA")
        w = min(b.width, a.width)
        h = min(b.height, a.height)
        b = b.crop((0, 0, w, h))
        a = a.crop((0, 0, w, h))
        ba = np.array(b)
        aa = np.array(a)
        diff = np.any(ba != aa, axis=2)
        add = np.logical_and(diff, aa[:, :, 3] > 0)
        rem = np.logical_and(diff, ba[:, :, 3] > 0)
        adds.append(add)
        removes.append(rem)
        action_arrays.append(aa)
        sizes.append((w, h))
        count += 1
    if count == 0:
        raise ValueError("Training pairs could not be read.")
    w = min(x[0] for x in sizes)
    h = min(x[1] for x in sizes)
    add_stack = np.stack([x[:h, :w] for x in adds])
    rem_stack = np.stack([x[:h, :w] for x in removes])
    arr_stack = np.stack([x[:h, :w, :] for x in action_arrays])
    add_freq = add_stack.mean(axis=0)
    rem_freq = rem_stack.mean(axis=0)
    threshold = 1.0 if count == 1 else max(0.6, min(0.85, 2.5 / max(count, 1)))
    add_candidate = add_freq >= threshold
    rem_threshold = 1.0 if count <= 2 else 0.85
    rem_mask = rem_freq >= rem_threshold
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
    overlay_img = Image.fromarray(overlay, "RGBA")
    preview = np.zeros((h, w, 4), dtype=np.uint8)
    preview[rem_mask] = [255, 80, 80, 220]
    preview[overlay_mask] = [245, 245, 255, 235]
    preview[uncertain_mask] = [255, 210, 80, 160]
    preview_img = Image.fromarray(preview, "RGBA")
    uncertain_img = np.zeros((h, w, 4), dtype=np.uint8)
    uncertain_img[uncertain_mask] = [255, 210, 80, 200]
    uncertain_img = Image.fromarray(uncertain_img, "RGBA")
    lid = uuid.uuid4().hex[:10]
    safe_label = safe_name(action_label)
    learned_dir = assets_dir / "learned"
    learned_dir.mkdir(parents=True, exist_ok=True)
    rel = f"learned/{safe_label}_{lid}.png"
    diffrel = f"learned/{safe_label}_{lid}_diff.png"
    uncertain_rel = f"learned/{safe_label}_{lid}_uncertain.png"
    overlay_img.save(assets_dir / rel)
    preview_img.save(assets_dir / diffrel)
    uncertain_img.save(assets_dir / uncertain_rel)
    return {
        "id": lid,
        "label": action_label,
        "exampleCount": count,
        "width": w,
        "height": h,
        "overlayPath": rel,
        "diffPath": diffrel,
        "uncertainPath": uncertain_rel,
        "removePixels": np.argwhere(rem_mask).tolist(),
        "addPixels": int(overlay_mask.sum()),
        "uncertainPixels": int(uncertain_mask.sum()),
        "removePixelCount": int(rem_mask.sum()),
        "protectedPixels": [],
        "createdAt": int(time.time() * 1000),
        "engine": "conservative-mask-overlay-v2",
        "consistency": (
            "high"
            if count >= 4 and int(uncertain_mask.sum()) < int(max(1, overlay_mask.sum()) * 0.5)
            else ("medium" if count >= 2 else "low")
        ),
    }


def apply_learned_to_image(base: Image.Image, learned: Dict[str, Any], assets_dir: Path) -> Image.Image:
    overlay_path = assets_dir / str(learned.get("overlayPath") or "")
    if not overlay_path.is_file():
        raise ValueError(f"learned overlay missing: {overlay_path}")
    overlay = Image.open(overlay_path).convert("RGBA")
    w = min(base.width, int(learned.get("width") or base.width))
    h = min(base.height, int(learned.get("height") or base.height))
    out = base.convert("RGBA").crop((0, 0, w, h))
    arr = np.array(out)
    protected = {tuple(p) for p in learned.get("protectedPixels", [])}
    suppressed_remove = {tuple(p) for p in learned.get("suppressedRemovePixels", [])}
    for y, x in learned.get("removePixels", []):
        pt = (y, x)
        if pt in protected or pt in suppressed_remove:
            continue
        if 0 <= y < h and 0 <= x < w:
            arr[y, x] = [0, 0, 0, 0]
    out = Image.fromarray(arr, "RGBA")
    if protected:
        ov = np.array(overlay.crop((0, 0, w, h)))
        for y, x in protected:
            if 0 <= y < h and 0 <= x < w:
                ov[y, x] = [0, 0, 0, 0]
        overlay_img = Image.fromarray(ov, "RGBA")
    else:
        overlay_img = overlay.crop((0, 0, w, h))
    out.alpha_composite(overlay_img, (0, 0))
    return out
