# Notepad

A Windows 11-style Notepad app for Windows 10 and 11 — tabs, dark mode,
autosave, find and replace, Markdown formatting and an emoji picker.

**Developer: Anjum Learning Lab**

> No screenshots are bundled with this repository. The screenshots below
> are placeholders: run the app and you will see the tab bar at the top,
> the File / Edit / View menu bar, the Markdown formatting toolbar, the
> editor, and the status bar (Ln/Col, words, characters, zoom, encoding,
> line endings).

## Features

- **Tabs** — open many files at once, drag tabs to reorder them, middle-click
  a tab to close it. Unsaved changes show a dot on the tab.
- **Session restore** — tabs (including unsaved ones) reopen where you left
  them. A separate `backup.json` keeps a copy of unsaved tabs, so a crash
  does not lose unsaved work.
- **Find and Replace** — Ctrl+F / Ctrl+H, Find Next (F3), with **Match case**,
  **Whole word** and **Regex** toggles. An invalid regex shows a clear error
  instead of crashing. Regex replace supports `$1` capture groups.
- **Print and Export as PDF** — File → Print (Ctrl+P) opens the system print
  dialog; File → Export as PDF saves a real PDF of the document.
- **Markdown formatting** — Formatted view (rendered, editable) and Markdown
  view (raw syntax), headings, bold/italic/strikethrough, lists, links and
  tables, exactly like the official Windows 11 Notepad.
- **22 fonts + font weight** — Settings offers 22 common Windows fonts and
  Normal / Semi-bold / Bold weight, applied to both views.
- **Encoding and line endings** — opening a file detects UTF-8, UTF-8 BOM,
  UTF-16LE and UTF-16BE, and saves back in the same encoding. The status bar
  shows the encoding and CRLF / LF / Mixed; View → Convert Line Endings
  converts the active tab.
- **Themes** — Light, Dark and System. Day mode is pure white, Night mode is
  pure black; a round Day/Night toggle sits next to the emoji button.
- **Emoji picker** — Ctrl+., search, categories and recent emoji.
- **Go to Line** (Ctrl+G), **Time/Date** (F5), **Recent Files**, **word wrap**,
  **zoom** (Ctrl+Plus/Minus/0, Ctrl+wheel), **spellcheck**, **Save All**,
  **Show in Folder**, **New Window**, drag-and-drop files to open them.
- **File associations** — the installer registers `.txt`, `.md` and `.log`
  for "Open with". Windows does not let an installer set the default app
  silently: after installing, pick Notepad once for a file type in
  Settings → Default Apps (the Settings dialog has a button for this).

## Install

### Windows (recommended)

Download from the [Releases](../../releases) page:

| File | What it is |
| --- | --- |
| `Notepad-1.6-Setup.exe` | **Installer (NSIS).** Run it, pick the install folder, and it installs Notepad with Desktop + Start Menu shortcuts, an uninstaller, and `.txt` / `.md` / `.log` associations. Per-user install, no admin needed. |
| `Notepad-1.6-Portable.exe` | **Portable.** No install — download it and double-click it. Settings and sessions are kept in the app's user-data folder, so it works from a USB stick too. |

Both are built from the same source, version 1.6, by Anjum Learning Lab.
The app is not code-signed, so Windows SmartScreen may ask you to confirm
the first run ("More info" → "Run anyway").

### macOS

Download `Notepad-1.6-x64.zip` from the Releases page when published, open
it, and drag Notepad into Applications. (There is no `.dmg` for 1.6: the
DMG needs Apple's `sips` tool, which only exists on a Mac — build
`npm run dist:mac` on a Mac to produce one.) If no macOS build is
published for a release, build from source below — the same code runs on
macOS (single-instance and file-open behaviour follow the platform).

### Linux

Download `Notepad-1.6-x86_64.AppImage` (make it executable and run it) or
`Notepad-1.6-amd64.deb` (`sudo dpkg -i Notepad-1.6-amd64.deb`) from the
Releases page when published. If no Linux build is published for a release,
build from source below.

## Build from source

Requires Node.js 20+ and npm.

```bash
git clone https://github.com/manjumstudio786/win11-notepad.git
cd win11-notepad
npm install     # also runs the postinstall version patch automatically
npm test        # static + functional checks (must pass before a release)
npm start       # run the app from source
npm run dist    # Windows: dist/Notepad-1.6-Setup.exe + dist/Notepad-1.6-Portable.exe
```

Other targets:

```bash
npm run dist:mac    # dist/Notepad-1.6-x64.dmg + .zip
npm run dist:linux  # dist/Notepad-1.6-x86_64.AppImage + .deb
```

### The two-part version patch

This project uses a two-part version (`1.6`, never `1.6.0`), but
electron-builder only accepts three-part versions. `npm install` runs
`scripts/postinstall.js` automatically, which copies
`patches/normalizePackageData.js` into `node_modules/app-builder-lib` so
the builder coerces `1.6` → `1.6.0` for its own checks only. `package.json`,
the About dialog and the installer file names all stay `1.6`. See
`patches/PATCH-README.txt`. No manual step is needed.

### Smoke test

```bash
xvfb-run npx electron . --smoke-test   # Linux: boots the app and runs the in-app checks
xvfb-run npx electron . --pdf-test --pdf-path=/tmp/notepad-test.pdf   # writes a real PDF
```

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+T | New tab |
| Ctrl+W | Close tab |
| Ctrl+Shift+N | New window |
| Ctrl+O | Open |
| Ctrl+S / Ctrl+Shift+S | Save / Save As |
| Ctrl+P | Print |
| Ctrl+F / Ctrl+H | Find / Replace |
| F3 / Shift+F3 | Find next / previous |
| Ctrl+G | Go to Line |
| F5 | Time/Date |
| Ctrl+B / Ctrl+I / Ctrl+K | Bold / Italic / Insert link |
| Ctrl+. | Emoji picker |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset |
| Ctrl+Z / Ctrl+Y | Undo / Redo |

## Files

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process: window, dialogs, file I/O, print/PDF |
| `preload.js` | Secure bridge (`window.notepadAPI`) between renderer and main |
| `renderer.js` | All UI: tabs, editor, find/replace, settings, session |
| `text-utils.js` | Shared pure helpers: find/regex, encoding, line endings, tab reorder |
| `index.html` / `styles.css` | Layout and Windows 11 styling |
| `emoji-data.js` | Emoji data for the picker |
| `tests/test.js` | `npm test` — static checks + functional tests for `text-utils.js` |
| `scripts/postinstall.js` | Automatic two-part version patch after `npm install` |

## Version history

- **1.6** — Find/Replace match-case, whole-word and regex; Print and Export
  as PDF; 22 fonts + font weight; encoding detection (UTF-8 / UTF-8 BOM /
  UTF-16LE / UTF-16BE) with CRLF/LF display and conversion; tab drag
  reorder; `.md` / `.log` associations; unsaved-tab backup; automatic
  postinstall version patch; developer Anjum Learning Lab.
- **1.5** — Editor focused on launch (caret at Ln 1, Col 1); theme toggle
  button transparent, no orange.
- **1.4** — Round Day/Night theme toggle; pure white Day, pure black Night.
- **1.3** — Ctrl+wheel zoom, right-click context menu, Find/Replace and F5
  in the Formatted view keep formatting, Markdown undo/redo, tab inserts a
  tab character, indentation survives the Formatted view.
- **1.1** — Frameless window with the tab bar on top, custom window
  controls, Formatted view, single-instance handling, `.txt` association.
- **1.0** — Tabs, menus, find/replace, word wrap, themes, status bar.

## License

MIT — see `LICENSE` if present in a release, otherwise the MIT license as
stated in `package.json`.
