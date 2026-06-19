# Admin editor modules

Each subdirectory with an `editor.json` is a **plug-in editor** for the Game Engine hub.

```
modules/
  mapeditor/         Map Editor (.owmap, props, GLB import)
  charactereditor/   Character Editor (Python subprocess + iframe)
```

To add a new editor: copy an existing folder, rename, edit `editor.json`, implement `editor.js`. See `../docs/adding-game-engine-tools.md`.
