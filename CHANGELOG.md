# Changelog

## 1.6 — 2026-11-25

- Find/Replace: Match case, Whole word and Regex toggles in both the Find
  and Replace bars; invalid regex shows a clear error instead of crashing;
  regex replace supports `$1` capture groups.
- Print: File → Print (Ctrl+P) opens the system print dialog; File →
  Export as PDF saves a real PDF via `printToPDF`. Print CSS hides the
  tab bar, menus, toolbar and status bar.
- Fonts: Settings font list expanded from 4 to 22 common Windows fonts;
  new Font weight setting (Normal / Semi-bold / Bold) applied to both
  editor views.
- Encoding: opening a file detects UTF-8, UTF-8 BOM, UTF-16LE and
  UTF-16BE (BOM + NUL-byte heuristic + strict UTF-8 fallback) and saves
  back in the same encoding; the status bar shows the real encoding
  instead of a hardcoded UTF-8.
- Line endings: the status bar shows CRLF / LF / Mixed; View → Convert
  Line Endings to CRLF / LF converts the active tab.
- Tabs: drag a tab onto another tab to reorder it; the session save
  preserves the new order.
- File associations: `.md` and `.log` added alongside `.txt` in the
  installer and in the Open/Save dialog filters.
- Backup: session save also writes `backup.json` with unsaved (dirty)
  tabs; if `session.json` is missing on launch, the backup is restored.
- Build: the two-part version patch is now applied automatically by
  `scripts/postinstall.js` on `npm install` — no manual copy step.
- Branding: developer is Anjum Learning Lab only; appId changed from
  `com.dnsh.win11notepad` to `com.anjumlearninglab.win11notepad`;
  package.json author is Anjum Learning Lab; the About dialog credits
  Anjum Learning Lab.
- Packaging: `npm run dist` now builds both Windows outputs —
  `Notepad-1.6-Setup.exe` (NSIS installer) and
  `Notepad-1.6-Portable.exe` (portable). Added `dist:mac` and
  `dist:linux` scripts.
- Tests: `text-utils.js` holds the shared pure helpers (find/regex,
  encoding, line endings, tab reorder) and `npm test` now runs real
  functional tests against them.

## 1.5 — 2026-11-24

- Editor focused on launch (caret at Ln 1, Col 1).
- Theme toggle button transparent, no orange (currentColor icon).

## 1.4 — 2026-11-20

- Round Day/Night theme toggle next to the emoji button; Day mode pure
  white, Night mode pure black across the whole app.

## 1.3

- Ctrl+wheel zoom, right-click context menu, Find/Replace and F5 in the
  Formatted view keep formatting, Markdown undo/redo, Tab inserts a tab
  character, indentation survives the Formatted view.

## 1.1

- Frameless window with the tab bar on top, custom window controls,
  Formatted view, single-instance handling, `.txt` file association.

## 1.0

- Tabs, menus, find/replace, word wrap, themes, status bar.
