---
paths:
  - "src/**/*.vue"
---

# Form UI Conventions

All create/edit forms in CardiPaw follow the same flat layout — no card panels, no section backgrounds. Match the pattern used in `AddEditNoteView.vue` and `AddEditPetView.vue`.

## Structure

```html
<div class="form">
  <div class="field">
    <label class="label" for="input-id">Field name</label>
    <input id="input-id" class="text-input" ... />
  </div>

  <div class="field">
    <label class="label" for="textarea-id">Field name <span class="optional">(optional)</span></label>
    <textarea id="textarea-id" class="text-input textarea" ... />
  </div>

  <!-- Inline toggle (label + control side by side) -->
  <div class="field field-row">
    <span class="label">Toggle label</span>
    <button class="toggle-btn" ...>...</button>
  </div>

  <!-- Destructive action at the bottom, no wrapper -->
  <button class="btn-delete" @click="showDeleteDialog = true">Delete X</button>
</div>
```

## Rules

- **No card panels per field.** Never wrap fields in elements with `background: var(--color-surface)` + `border-bottom` + `margin-bottom`. That segmented look does not belong in forms.
- **`.form`** — the form wrapper. `padding: 24px 16px 48px`, `display: flex; flex-direction: column; gap: 24px`.
- **`.field`** — one field (label + control). `display: flex; flex-direction: column; gap: 8px`. No background, no border.
- **`.field-row`** — variant for inline pairs (e.g. toggle). Adds `flex-direction: row; align-items: center; justify-content: space-between`.
- **`.label`** — `font-size: 13px; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px`.
- **`.optional`** inside a label — resets `font-weight: 400; text-transform: none; letter-spacing: 0`.
- **`.text-input`** — `border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); padding: 10px 12px; font-size: 15px; box-sizing: border-box`. Focus state: `border-color: var(--color-primary)`. Error state (add `.error` class): `border-color: var(--color-danger)`.
- **`.textarea`** extends `.text-input` — adds `resize: vertical; min-height: 80px`.
- **`.field-error`** — `font-size: 12px; color: var(--color-danger); margin: 2px 0 0`. Place directly after the input inside `.field`.
- **`.btn-delete`** — `width: 100%; padding: 12px; border: 1.5px solid var(--color-danger); border-radius: var(--radius-md); background: transparent; color: var(--color-danger)`. Always the last element in `.form`, never wrapped in a `.field`.

## Page header

All create/edit views share the same header pattern:

```html
<header class="page-header">
  <button class="icon-btn" @click="goBack" aria-label="Back"><!-- back arrow SVG --></button>
  <span class="header-main">Page title</span>
  <div class="header-spacer" aria-hidden="true" />
</header>
```

- Back button on left, spacer on right — both are `36px` wide, so `header-main` with `flex: 1; text-align: center` is visually centered.
- **Never put the Save/submit button in the header.** It always lives at the bottom of the form (see below).

## Submit button

The save/add action is a full-width button at the bottom of the `.form`, not in the header:

```html
<button class="submit-btn" :disabled="saving" @click="save">
  {{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add X') }}
</button>
```

```css
.submit-btn {
  width: 100%;
  height: 52px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
  transition: opacity 0.15s;
}
.submit-btn:disabled { opacity: 0.5; }
```

## Reference implementations

- `src/views/AddEditNoteView.vue` — note form (canonical reference)
- `src/views/AddEditPetView.vue` — pet form
- `src/views/AddEditReminderView.vue` — reminder form (time picker + day pills + toggle)
