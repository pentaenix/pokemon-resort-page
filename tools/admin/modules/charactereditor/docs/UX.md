# UX Guidelines

## Overall layout

The app uses three regions:

- Left navigation for major workspaces.
- Center workspace for the active task.
- Right help panel for short contextual guidance.

## Sheet mapper principles

- The primary workflow is split into three visible steps: prepare, save, assign/populate.
- Advanced/manual cell tools are hidden by default.
- Buttons use verbs that describe the saved result.
- Progress bars and terminal logs appear only where operations may take time.

## Text and readability

- Keep labels short: “Save sheet”, “Save assignment”, “Populate character”.
- Explanatory copy should be one or two lines.
- Long names should be truncated visually, but full values remain in project JSON.

## Pixel rendering

- All canvases and image previews use pixelated rendering.
- Canvas contexts must disable smoothing.
- Sheet viewport may fit/zoom; editor canvas should use integer zoom where possible.
