# V12 Behavior Reliability and Learned-Data Control

V12 focuses on behavior quality, preview reliability, and artist control.

## Animation previews

Animation previews now use a shared resolution path that can display saved sprites, temporary behavior-preview frames, generated frame URLs, and missing-frame placeholders. Behavior modals, Generate → Behavior, generated-behavior modals, and character animation cards should not render as empty boxes when data is incomplete.

## Behavior ownership

Behavior actions are self-contained. Deleting a behavior removes its owned/internal frame transforms and any legacy frame-label training pairs, but it does not delete source character sprites. Removing a generated behavior from a character is a separate operation and removes the generated sprites/animations owned by that character-level behavior package.

## Training safety

Generated assets are excluded from training by default to avoid feedback loops. Imported, template-extracted, and manually added sprites are training-safe by default. Generated sprites can be manually opted into training through sprite metadata, but the UI should warn that generated data may reinforce mistakes unless it has been cleaned up.

## Conservative generation engine

The V12 engine preserves the target base by default:

- high-confidence overlay pixels may be added;
- removals require stronger agreement than overlays;
- uncertain pixels keep the target sprite;
- protected pixels suppress both removals and overlays.

This is intended to reduce failures where a training character's face/hat is pasted into the result or the target body is erased.

## Learned-data editor

Learned maps can be fine-tuned by rectangle edits:

- **Overlay** clears added pixels from the learned overlay.
- **Remove** suppresses removal mask pixels so the target base stays visible.
- **Protect** marks a region as unchanged, blocking both removals and overlays.

Use this when behavior generation learns character-specific details such as hats, faces, or hair.
