# V10 Behavior Actions

V10 starts the multi-sprite workflow while keeping the single-action pipeline stable.

## Template naming

Row-cycle templates now support a move type / prefix such as `walk`, `run`, `swim`, or `bike`. In automatic naming mode, populated frames are named:

```text
<prefix>_<direction>_<frameIndex>
```

Examples:

```text
bike_down_0
bike_down_1
bike_left_0
```

Animations are named:

```text
bike_down
bike_left
bike_right
bike_up
```

Manual per-cell naming remains available through the mapper’s manual extraction tools.

## Template preview

The mapper preview shows the resulting animation grid and the animations that will be created before the user commits to Apply/Populate.

## Character cleanup

Characters can now delete individual sprites and animations. Deleting an animation removes only the animation record. Deleting a sprite removes that sprite from the character and removes any animation frames that referenced it.

## Behavior actions

A behavior action represents a multi-frame, multi-direction training package. The first implementation supports base-to-animation behavior training:

```text
base_down  -> bike_down_0..N
base_left  -> bike_left_0..N
base_right -> bike_right_0..N
base_up    -> bike_up_0..N
```

The UI exposes this as one behavior, such as `Bike`, rather than 16 separate single actions.

## Training behavior actions

When a behavior is trained, the backend creates/updates the underlying single frame actions and training pairs from characters that have all required base and output labels. It then trains each frame action using the existing mask-overlay engine.

## Generating behavior actions

Generate has two modes:

- Single action: produces one sprite.
- Behavior: produces all generated behavior frames and creates playable animations for the target character.

## Animation editing

The editor can now select an animation as an asset. Users can reorder, remove, add frames, edit the currently selected frame, and save the animation timeline.

## Exporting behavior sheets

Export can pack a generated behavior back into a row-cycle sheet with optional nearest-neighbor output scaling.
