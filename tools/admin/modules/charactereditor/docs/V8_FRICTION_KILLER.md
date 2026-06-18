# V8 Friction-Killer Release

V8 focuses on calm, predictable workflows rather than new algorithms.

## Sheet opening

- Sheet families now expose a current version.
- The common path is: **Sheets → Open** or double-click a sheet card.
- The version picker is only needed when renaming or switching versions.

## Mapper navigation rule

The mapper does not navigate away unless the user clicks **Open character**.

These actions stay in place:

- Apply template
- Preview
- Save sheet
- Assign
- Populate
- Replace

## Populate behavior

Populate now saves the current sheet mapping first, then creates sprites and animations. The result is shown in the mapper log/status so the user can keep working without reopening the sheet.

## Template defaults

When the selected template changes, advanced template options reset to that template's defaults. Saved sheet template options are used only when the sheet is already associated with the selected template.

## Template manager

Templates can be managed from the mapper's advanced options. Built-in templates are protected; duplicate them to edit safely.

Supported operations:

- create custom template
- duplicate template
- edit custom template
- delete custom template

## UI copy

Buttons use short labels that fit the UI:

- Preview
- Save
- Assign
- Populate
- Replace

Explanatory text belongs in cards, notes, and confirmations, not in button labels.

## Packaging

The release zip should contain exactly one top-level folder:

```text
spmk/
  spmk_app/
  docs/
  README.md
  requirements.txt
  spmk
  AGENTS.md
```

Do not place a launcher file named `spmk` next to a folder also named `spmk` at the archive root.
