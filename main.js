'use strict';

/*
 * Notepad 1.6 - Windows 11 style Notepad (Electron main process).
 * 1.6 adds: Find/Replace match-case, whole-word and regex; Print and
 * Export as PDF; 22 fonts + font weight; encoding detection (UTF-8 /
 * UTF-8 BOM / UTF-16LE / UTF-16BE) and CRLF/LF display + conversion;
 * tab drag reorder; .md/.log file associations; unsaved-tab backup;
 * automatic postinstall version patch; developer Anjum Learning Lab
 * (appId com.anjumlearninglab.win11notepad).
 * 1.4.0 adds: a round Day / Night theme toggle button next to the
 * emoji button; Day mode is pure white, Night mode is pure black.
 * 1.5 adds: the editor is focused on launch (caret at Ln 1, Col 1),
 * and the theme toggle button has no orange any more (transparent,
 * currentColor icon).
 * All APIs used here are documented Electron APIs:
 * app, BrowserWindow, ipcMain, dialog, shell, Menu - see electronjs.org/docs.
 * 1.0.1 adds: .txt file association (via electron-builder fileAssociations),
 * opening a file passed on the command line, and single-instance handling
 * (requestSingleInstanceLock + 'second-instance') so a second .txt opened
 * while the app is running goes to the first window as a new tab.
 * 1.0.2 adds: Menu.setApplicationMenu(null) so only the single in-page
 * menu bar (File Edit View) is visible - no duplicate native menu row.
 * 1.1.0 adds: frameless window (frame: false) so the tab bar is the
 * topmost title-bar row with custom window controls, plus window
 * control IPC and http(s)-only openExternal for Ctrl+clicked links.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { decodeBytes, encodeBytes } = require('./text-utils');

const APP_VERSION = '1.6';
let mainWindow = null;
let pendingOpenFile = null;

// ---- File argument parsing (command line / second instance) ----
// Returns the first command-line argument that is an existing text file,
// or null. Skips the executable path, Chromium flags (--...), the app
// path ('.' when run as `electron .`), and non-text arguments.
const TEXT_EXTENSIONS = /\.(txt|md|log|csv|json|xml|ini|cfg)$/i;
function getFileArg(argv) {
  const args = (argv || []).slice(1);
  for (const a of args) {
    if (!a || typeof a !== 'string') continue;
    if (a.startsWith('-')) continue;
    if (!TEXT_EXTENSIONS.test(a)) continue;
    try {
      if (fs.existsSync(a) && fs.statSync(a).isFile()) return a;
    } catch (e) { /* ignore - not a readable file */ }
  }
  return null;
}

// ---- Single instance: a second launch (e.g. double-clicking a .txt)
// hands its file to the first window instead of opening a new window.
// Documented: app.requestSingleInstanceLock() returns boolean; the
// 'second-instance' event fires in the primary instance with the
// second instance's argv. See electronjs.org/docs/api/app.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  const file = getFileArg(argv);
  if (file) mainWindow.webContents.send('app:open-file-arg', { path: file });
});

// macOS: 'open-file' fires when a file is opened with the app.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('app:open-file-arg', { path: filePath });
  } else {
    pendingOpenFile = filePath;
  }
});

// Running as root on Linux (CI/VM) requires --no-sandbox for Chromium.
if (process.platform === 'linux' && typeof process.getuid === 'function') {
  try { if (process.getuid() === 0) app.commandLine.appendSwitch('no-sandbox'); } catch (e) { /* ignore */ }
}

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJsonFile(name, fallback) {
  try {
    const p = userDataFile(name);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonFile(name, data) {
  try {
    fs.writeFileSync(userDataFile(name), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 640,
    minHeight: 420,
    title: 'Notepad',
    // 1.1.0: frameless so the tab bar is the topmost title-bar row
    // (official Windows 11 Notepad layout). Window controls are custom
    // buttons in the tab bar (see 'window:*' IPC below); the tab bar
    // itself is the drag region (-webkit-app-region: drag in styles.css).
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Smoke-test mode (used by the automated check on Linux): quit cleanly
    // after the window has rendered, proving the app boots without errors.
    if (process.argv.includes('--smoke-test')) {
      setTimeout(async () => {
        const results = { checks: [], passed: 0, failed: 0 };
        const check = (name, ok, detail) => {
          results.checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
          if (ok) results.passed += 1; else results.failed += 1;
        };
        try {
          const out = await mainWindow.webContents.executeJavaScript(`(async function () {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const r = {};
            const editor = document.getElementById('editor');
            const fview = document.getElementById('formatted-view');
            // 1.5: the editor must already be focused on launch, caret at start.
            r.focusOnLoad = document.activeElement === fview;
            r.focusOnLoadTag = document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '';
            const app = document.getElementById('app');
            // 1.1.0 layout: tab bar is the topmost row, menu below it,
            // formatting toolbar below the menu.
            r.firstChildId = app.children[0] ? app.children[0].id : '';
            r.secondChildId = app.children[1] ? app.children[1].id : '';
            const ids = Array.from(app.children).map(c => c.id);
            r.formatbarAfterMenubar = ids.indexOf('formatbar') > ids.indexOf('menubar');
            r.windowControls = ['win-min-btn', 'win-max-btn', 'win-close-btn'].map(id => !!document.getElementById(id));
            r.plusAfterTabs = document.getElementById('tabs').nextElementSibling && document.getElementById('tabs').nextElementSibling.id === 'new-tab-btn';
            const tabs = document.querySelectorAll('.tab');
            const lastTab = tabs[tabs.length - 1];
            const plusBtn = document.getElementById('new-tab-btn');
            const lr = lastTab.getBoundingClientRect();
            const pr = plusBtn.getBoundingClientRect();
            r.plusGap = Math.round(pr.left - lr.right);
            r.plusVisible = pr.width > 0 && pr.height > 0;
            // Single menu bar: exactly one #menubar, three menu buttons.
            r.menubarCount = document.querySelectorAll('#menubar').length;
            r.menuBtnCount = document.querySelectorAll('.menu-btn').length;
            // Default view is Formatted (official Notepad default).
            r.defaultViewFormatted = document.getElementById('status-format').textContent === 'Formatted';
            r.formattedVisibleDefault = !fview.classList.contains('hidden');
            r.editorHiddenDefault = editor.classList.contains('hidden');
            r.formatbarVisible = !document.getElementById('formatbar').classList.contains('hidden');
            r.formatButtons = ['fmt-bold', 'fmt-italic', 'fmt-strike', 'fmt-bullet', 'fmt-numbered', 'fmt-link', 'fmt-table', 'fmt-clear'].map(id => !!document.getElementById(id));
            r.headingSelect = !!document.getElementById('heading-select');
            // Switch to Markdown view for the plain-text tests.
            document.getElementById('status-format').click();
            await sleep(100);
            r.viewAfterToggle = document.getElementById('status-format').textContent;
            r.editorVisibleAfterToggle = !editor.classList.contains('hidden');
            // Untitled titles after load must form a clean sequence
            // (Untitled, Untitled (2), ...) - no runaway Untitled (30).
            const titlesAfterLoad = Array.from(document.querySelectorAll('.tab-title')).map(el => el.textContent);
            r.titlesAfterLoad = titlesAfterLoad.join('|');
            const unt = titlesAfterLoad.filter(t => /^Untitled( \\(\\d+\\))?$/.test(t));
            const nums = unt.map(t => t === 'Untitled' ? 1 : parseInt(t.match(/\\((\\d+)\\)/)[1], 10)).sort((a, b) => a - b);
            r.untitledSequenceClean = nums.length === 0 || nums.every((n, i) => n === i + 1);
            r.untitledMax = nums.length ? Math.max.apply(null, nums) : 0;
            r.untitledCount = nums.length;
            // Close every tab. A dirty tab shows the save prompt - choose
            // "Don't Save". Closing the last tab must create one fresh
            // plain 'Untitled' tab (1.0.2 fix).
            const closeCount = document.querySelectorAll('.tab').length;
            for (let i = 0; i < closeCount; i++) {
              const first = document.querySelector('.tab');
              if (!first) break;
              first.querySelector('.tab-close').click();
              await sleep(150);
              const overlay = document.getElementById('modal-overlay');
              if (overlay && !overlay.classList.contains('hidden')) {
                const ds = Array.from(document.querySelectorAll('#modal-buttons button')).find(b => b.textContent === "Don't Save");
                if (ds) ds.click();
                await sleep(150);
              }
            }
            r.tabsAfterCloseAll = document.querySelectorAll('.tab').length;
            r.titleAfterCloseAll = document.querySelector('.tab-title') ? document.querySelector('.tab-title').textContent : '';
            // Typing / status bar checks on the fresh Untitled tab.
            editor.value = 'Hello world\\nSecond line';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            r.words = document.getElementById('status-words').textContent;
            r.chars = document.getElementById('status-chars').textContent;
            r.lncol = document.getElementById('status-lncol').textContent;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
            r.findBarVisible = !document.getElementById('find-bar').classList.contains('hidden');
            const fi = document.getElementById('find-input');
            fi.value = 'Second';
            fi.dispatchEvent(new Event('input', { bubbles: true }));
            r.findCount = document.getElementById('find-count').textContent;
            document.getElementById('new-tab-btn').click();
            await sleep(100);
            r.tabsAfterNew = document.querySelectorAll('.tab').length;
            const newTitles = Array.from(document.querySelectorAll('.tab-title')).map(el => el.textContent);
            r.newTabTitle = newTitles[newTitles.length - 1];
            // Back to the first tab for the formatting tests.
            document.querySelectorAll('.tab')[0].click();
            await sleep(100);
            // Formatting in Markdown view: Bold wraps the selection.
            editor.setSelectionRange(0, 5);
            document.getElementById('fmt-bold').click();
            await sleep(50);
            r.boldMd = editor.value.indexOf('**Hello**') === 0;
            // Italic wraps the selection.
            editor.setSelectionRange(10, 15);
            document.getElementById('fmt-italic').click();
            await sleep(50);
            r.italicMd = editor.value.indexOf('*world*') !== -1;
            // Ctrl+B toggles bold off again.
            editor.setSelectionRange(0, 9);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
            await sleep(50);
            r.ctrlBTogglesOff = editor.value.indexOf('**Hello**') === -1 && editor.value.indexOf('Hello') === 0;
            // Heading dropdown sets a level-1 heading on the line.
            const caretSecond = editor.value.indexOf('Second');
            editor.setSelectionRange(caretSecond, caretSecond);
            const hs = document.getElementById('heading-select');
            hs.value = 'h1';
            hs.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(50);
            r.headingMd = editor.value.indexOf('# Second line') !== -1;
            // Bulleted list prefixes every selected line.
            editor.setSelectionRange(0, editor.value.length);
            document.getElementById('fmt-bullet').click();
            await sleep(50);
            r.bulletMd = editor.value.indexOf('- Hello') !== -1;
            // Clear formatting strips all Markdown syntax.
            editor.setSelectionRange(0, editor.value.length);
            document.getElementById('fmt-clear').click();
            await sleep(50);
            r.clearMd = editor.value.indexOf('**') === -1 && editor.value.indexOf('# ') === -1 && editor.value.indexOf('- ') === -1;
            // Link modal inserts a Markdown link.
            editor.setSelectionRange(0, 5);
            document.getElementById('fmt-link').click();
            await sleep(50);
            r.linkModalVisible = !document.getElementById('link-overlay').classList.contains('hidden');
            const lu = document.getElementById('link-url-input');
            lu.value = 'https://example.com';
            document.getElementById('link-ok').click();
            await sleep(50);
            r.linkMd = editor.value.indexOf('[Hello](https://example.com)') === 0;
            // Table insert adds a Markdown table.
            editor.setSelectionRange(editor.value.length, editor.value.length);
            document.getElementById('fmt-table').click();
            await sleep(50);
            r.tableMd = editor.value.indexOf('| Header 1 | Header 2 |') !== -1;
            // Re-apply italic (Clear formatting removed it) so the
            // formatted view has an italic element to render.
            const worldIdx = editor.value.indexOf('world');
            editor.setSelectionRange(worldIdx, worldIdx + 5);
            document.getElementById('fmt-italic').click();
            await sleep(50);
            r.italicReapplied = editor.value.indexOf('*world*') !== -1;
            // Switch to Formatted view: link and table render.
            document.getElementById('status-format').click();
            await sleep(150);
            r.formattedVisible = !fview.classList.contains('hidden');
            r.formattedHasLink = !!fview.querySelector('a[href="https://example.com"]');
            r.formattedHasTable = !!fview.querySelector('table');
            r.formattedHasEm = !!fview.querySelector('em, i');
            // Bold in the formatted view (select 'world' in the DOM).
            const selectInFormatted = (needle) => {
              const walker = document.createTreeWalker(fview, NodeFilter.SHOW_TEXT, null);
              let node;
              while ((node = walker.nextNode())) {
                const idx = node.nodeValue.indexOf(needle);
                if (idx !== -1) {
                  const range = document.createRange();
                  range.setStart(node, idx);
                  range.setEnd(node, idx + needle.length);
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(range);
                  fview.focus();
                  return true;
                }
              }
              return false;
            };
            r.selectWorld = selectInFormatted('world');
            document.getElementById('fmt-bold').click();
            await sleep(50);
            r.formattedBold = !!fview.querySelector('strong, b');
            // Heading in the formatted view.
            r.selectSecond = selectInFormatted('Second');
            const hs2 = document.getElementById('heading-select');
            hs2.value = 'h1';
            hs2.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(50);
            r.formattedHeading = !!fview.querySelector('h1');
            // Find works in the formatted view too.
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
            await sleep(50);
            const fi2 = document.getElementById('find-input');
            fi2.value = 'Second';
            fi2.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(50);
            r.findCountFormatted = document.getElementById('find-count').textContent;
            document.getElementById('find-close-btn').click();
            // Emoji picker still works in the formatted view.
            r.emojiBtn = !!document.getElementById('emoji-btn');
            document.getElementById('emoji-btn').click();
            await sleep(100);
            r.emojiPickerVisible = !document.getElementById('emoji-picker').classList.contains('hidden');
            const si = document.getElementById('emoji-search');
            si.value = 'heart';
            si.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            const items = document.querySelectorAll('#emoji-grid .emoji-item');
            r.emojiSearchResults = items.length;
            if (items.length > 0) {
              r.emojiFirst = items[0].textContent;
              items[0].click();
              await sleep(100);
              r.editorHasEmoji = fview.innerText.indexOf(r.emojiFirst) !== -1;
              r.emojiPickerStillOpen = !document.getElementById('emoji-picker').classList.contains('hidden');
            } else {
              r.editorHasEmoji = false;
              r.emojiPickerStillOpen = false;
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            await sleep(100);
            r.emojiPickerClosedOnEsc = document.getElementById('emoji-picker').classList.contains('hidden');
            // Theme flip: picker must also work in the other theme.
            r.darkBefore = document.body.classList.contains('dark');
            document.getElementById('menu-theme').click();
            await sleep(100);
            r.darkAfter = document.body.classList.contains('dark');
            document.getElementById('emoji-btn').click();
            await sleep(100);
            r.emojiPickerVisibleOtherTheme = !document.getElementById('emoji-picker').classList.contains('hidden');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            await sleep(100);
            // Formatting off in Settings hides the toolbar and forces
            // the Markdown view; turning it back on restores both.
            document.querySelector('[data-action="settings"]').click();
            await sleep(100);
            const fc = document.getElementById('setting-formatting');
            fc.checked = false;
            fc.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(100);
            r.formatbarHiddenWhenOff = document.getElementById('formatbar').classList.contains('hidden');
            r.viewMarkdownWhenOff = document.getElementById('status-format').textContent === 'Markdown';
            fc.checked = true;
            fc.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(100);
            r.formatbarVisibleWhenOn = !document.getElementById('formatbar').classList.contains('hidden');
            r.viewFormattedWhenOn = document.getElementById('status-format').textContent === 'Formatted';
            document.getElementById('settings-close').click();
            // Window controls: maximize toggles and restores.
            r.maxBtn = !!document.getElementById('win-max-btn');
            document.getElementById('win-max-btn').click();
            await sleep(300);
            r.maximizedAfterClick = await window.notepadAPI.windowIsMaximized();
            document.getElementById('win-max-btn').click();
            await sleep(300);
            r.restoredAfterSecondClick = !(await window.notepadAPI.windowIsMaximized());
            // 1.3.0: Ctrl+wheel zoom (synthetic wheel with ctrlKey).
            r.zoomBeforeWheel = document.getElementById('status-zoom').textContent;
            fview.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }));
            await sleep(100);
            r.zoomAfterWheelIn = document.getElementById('status-zoom').textContent;
            fview.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 120, bubbles: true, cancelable: true }));
            await sleep(100);
            r.zoomAfterWheelOut = document.getElementById('status-zoom').textContent;
            // 1.3.0: right-click context menu opens on the formatted view.
            r.ctxSelect = selectInFormatted('world');
            fview.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 }));
            await sleep(100);
            r.ctxMenuVisible = !document.getElementById('context-menu').classList.contains('hidden');
            r.ctxCopyEnabled = !document.querySelector('[data-ctx="copy"]').disabled;
            fview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await sleep(100);
            r.ctxMenuClosedOnClick = document.getElementById('context-menu').classList.contains('hidden');
            // 1.3.0: Replace in the Formatted view keeps bold, and the
            // Markdown round-trip keeps the blank line between paragraphs.
            document.getElementById('status-format').click();
            await sleep(100);
            editor.value = '**Hello** world\\n\\nSecond para';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            document.getElementById('status-format').click();
            await sleep(150);
            r.replaceBoldBefore = !!fview.querySelector('strong, b');
            document.querySelector('[data-action="replace"]').click();
            await sleep(100);
            document.getElementById('replace-find-input').value = 'world';
            document.getElementById('replace-with-input').value = 'there';
            document.getElementById('replace-one-btn').click();
            await sleep(150);
            r.replaceBoldAfter = !!fview.querySelector('strong, b');
            r.replaceTextHasThere = fview.innerText.indexOf('there') !== -1;
            document.getElementById('replace-close-btn').click();
            await sleep(50);
            document.getElementById('status-format').click();
            await sleep(150);
            r.markdownAfterReplace = editor.value;
            // 1.3.0: F5 Time/Date in the Formatted view keeps bold.
            editor.value = '**Hello** world';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            document.getElementById('status-format').click();
            await sleep(150);
            r.f5BoldBefore = !!fview.querySelector('strong, b');
            fview.focus();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }));
            await sleep(150);
            r.f5BoldAfter = !!fview.querySelector('strong, b');
            r.f5HasTime = fview.innerText.indexOf('AM') !== -1 || fview.innerText.indexOf('PM') !== -1;
            // 1.3.0: Word Wrap has a visible effect in the Formatted view.
            r.wrapOffHasNowrap = fview.classList.contains('nowrap');
            document.querySelector('[data-action="toggle-wrap"]').click();
            await sleep(100);
            r.wrapOnHasNowrap = fview.classList.contains('nowrap');
            document.querySelector('[data-action="toggle-wrap"]').click();
            await sleep(100);
            // 1.3.0: the font setting applies to the Formatted view.
            document.querySelector('[data-action="settings"]').click();
            await sleep(100);
            const fs2 = document.getElementById('setting-font');
            fs2.value = "Consolas, 'Courier New', monospace";
            fs2.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(100);
            r.formattedFontHasConsolas = getComputedStyle(fview).fontFamily.indexOf('Consolas') !== -1;
            document.getElementById('settings-close').click();
            await sleep(100);
            // 1.3.0: Edit > Undo / Redo work in the Markdown view.
            if (document.getElementById('status-format').textContent === 'Formatted') {
              document.getElementById('status-format').click();
              await sleep(100);
            }
            editor.value = 'undo me please';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(80);
            editor.value = 'undo me please CHANGED';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(80);
            document.querySelector('[data-action="undo"]').click();
            await sleep(150);
            r.mdUndoValue = editor.value;
            document.querySelector('[data-action="redo"]').click();
            await sleep(150);
            r.mdRedoValue = editor.value;
            // 1.3.0: Tab inserts a tab character in the Markdown view.
            const caretPos = editor.value.indexOf('please');
            editor.setSelectionRange(caretPos, caretPos);
            editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
            await sleep(100);
            r.tabInserted = editor.value.indexOf('\\t') !== -1;
            // 1.3.0: Formatted view keeps line-leading indentation.
            // The user's manifest.json pasted in Formatted view showed
            // every line flush left. Use that exact file as the sample.
            const jsonSample = '{\\n  "manifest_version": 3,\\n  "name": "Video Link Extractor",\\n  "version": "1.0",\\n  "description": "Extracts hidden video URLs from webpages.",\\n  "permissions": [\\n    "activeTab",\\n    "scripting"\\n  ],\\n  "action": {\\n    "default_popup": "popup.html"\\n  }\\n}';
            editor.value = jsonSample;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            document.getElementById('status-format').click();
            await sleep(150);
            r.formattedIndentText = fview.textContent.indexOf('  "manifest_version": 3,') !== -1;
            r.formattedIndentInner = fview.innerText.indexOf('  "manifest_version": 3,') !== -1;
            r.formattedIndentDeep = fview.textContent.indexOf('    "activeTab",') !== -1;
            const fp = fview.querySelector('p');
            r.formattedPWhiteSpace = fp ? getComputedStyle(fp).whiteSpace : '';
            document.getElementById('status-format').click();
            await sleep(150);
            r.markdownAfterIndent = editor.value;
            // Tab-indented lines keep their tab in the Formatted view too.
            editor.value = '\\tTabbed line\\n  Two spaces';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            document.getElementById('status-format').click();
            await sleep(150);
            r.formattedTabIndent = fview.textContent.indexOf('\\tTabbed line') !== -1 && fview.textContent.indexOf('  Two spaces') !== -1;
            document.getElementById('status-format').click();
            await sleep(150);
            // 1.4.0: round theme toggle next to the emoji button (1.5: no orange).
            r.themeToggleBtn = !!document.getElementById('theme-toggle-btn');
            const ebRect = document.getElementById('emoji-btn').getBoundingClientRect();
            const tbRect = document.getElementById('theme-toggle-btn').getBoundingClientRect();
            r.themeBtnNextToEmoji = tbRect.left >= ebRect.right - 1 && tbRect.left - ebRect.right <= 12 && Math.abs(tbRect.top - ebRect.top) <= 4;
            const tbStyle = getComputedStyle(document.getElementById('theme-toggle-btn'));
            r.themeBtnRound = tbStyle.borderRadius.indexOf('50%') !== -1 || parseInt(tbStyle.borderRadius, 10) >= 14;
            r.themeBtnTransparent = tbStyle.backgroundColor === 'rgba(0, 0, 0, 0)';
            r.themeBtnIconMatchesText = tbStyle.color === getComputedStyle(document.body).color;
            const pureBg = (isDark) => isDark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
            const barsMatchBody = () => {
              const bodyBg = getComputedStyle(document.body).backgroundColor;
              return ['tabbar', 'menubar', 'formatbar', 'statusbar'].every(id => getComputedStyle(document.getElementById(id)).backgroundColor === bodyBg);
            };
            const darkBeforeToggle = document.body.classList.contains('dark');
            document.getElementById('theme-toggle-btn').click();
            await sleep(100);
            r.themeBtnFlipsDark = document.body.classList.contains('dark') !== darkBeforeToggle;
            r.themeBtnBgAfterFlip = getComputedStyle(document.body).backgroundColor;
            r.themeBtnPureAfterFlip = r.themeBtnBgAfterFlip === pureBg(document.body.classList.contains('dark'));
            r.themeBtnBarsPureAfterFlip = barsMatchBody();
            r.themeBtnIconAfterFlip = document.body.classList.contains('dark') ? (document.getElementById('theme-icon-moon').classList.contains('hidden') === false && document.getElementById('theme-icon-sun').classList.contains('hidden') === true) : (document.getElementById('theme-icon-sun').classList.contains('hidden') === false && document.getElementById('theme-icon-moon').classList.contains('hidden') === true);
            document.getElementById('theme-toggle-btn').click();
            await sleep(100);
            r.themeBtnFlipsBack = document.body.classList.contains('dark') === darkBeforeToggle;
            r.themeBtnBgAfterBack = getComputedStyle(document.body).backgroundColor;
            r.themeBtnPureAfterBack = r.themeBtnBgAfterBack === pureBg(document.body.classList.contains('dark'));
            r.themeToggle = !!document.getElementById('menu-theme');
            r.statusBar = !!document.getElementById('statusbar');
            r.aboutVersion = document.getElementById('about-version').textContent;
            r.defaultAppsBtn = !!document.getElementById('setting-default-apps');
            return r;
          })()`);
          check('tab bar is the topmost row of #app', out.firstChildId === 'tabbar', out.firstChildId);
          check('menu bar is directly below the tab bar', out.secondChildId === 'menubar', out.secondChildId);
          check('formatbar sits below the menubar', out.formatbarAfterMenubar === true, '');
          check('window controls present (min/max/close)', out.windowControls.every(Boolean), JSON.stringify(out.windowControls));
          check('new-tab + is immediately after #tabs', out.plusAfterTabs === true, '');
          check('+ button sits next to the last tab (gap <= 4px)', out.plusGap <= 4 && out.plusGap >= -2, 'gap=' + out.plusGap);
          check('+ button is visible', out.plusVisible === true, '');
          check('single menubar (exactly one #menubar)', out.menubarCount === 1, out.menubarCount);
          check('three menu buttons (File Edit View)', out.menuBtnCount === 3, out.menuBtnCount);
          check('default view is Formatted', out.defaultViewFormatted === true, '');
          check('formatted view visible by default', out.formattedVisibleDefault === true, '');
          check('markdown textarea hidden by default', out.editorHiddenDefault === true, '');
          check('formatbar visible by default', out.formatbarVisible === true, '');
          check('all formatting buttons present', out.formatButtons.every(Boolean), JSON.stringify(out.formatButtons));
          check('heading dropdown present', out.headingSelect === true, '');
          check('status toggle switches to Markdown view', out.viewAfterToggle === 'Markdown', out.viewAfterToggle);
          check('markdown textarea visible after toggle', out.editorVisibleAfterToggle === true, '');
          check('untitled titles form a clean sequence', out.untitledSequenceClean === true, out.titlesAfterLoad);
          check('no runaway untitled number (max equals count)', out.untitledMax <= out.untitledCount, 'max=' + out.untitledMax + ' count=' + out.untitledCount);
          check('close-all-tabs leaves exactly one tab', out.tabsAfterCloseAll === 1, out.tabsAfterCloseAll);
          check('close-last-tab creates plain Untitled', out.titleAfterCloseAll === 'Untitled', out.titleAfterCloseAll);
          check('word count 4 words', out.words === '4 words', out.words);
          check('char count 23 characters', out.chars === '23 characters', out.chars);
          check('status Ln 2, Col 12 (caret at end of text)', out.lncol === 'Ln 2, Col 12', out.lncol);
          check('new tab button creates a tab', out.tabsAfterNew === 2, out.tabsAfterNew);
          check('second untitled tab is Untitled (2)', out.newTabTitle === 'Untitled (2)', out.newTabTitle);
          check('Ctrl+F opens find bar', out.findBarVisible === true, out.findBarVisible);
          check('find reports 1 of 1', out.findCount === '1 of 1', out.findCount);
          check('Bold wraps selection with ** in Markdown view', out.boldMd === true, '');
          check('Italic wraps selection with * in Markdown view', out.italicMd === true, '');
          check('Ctrl+B toggles bold off', out.ctrlBTogglesOff === true, '');
          check('heading dropdown sets # heading', out.headingMd === true, '');
          check('bulleted list prefixes lines with -', out.bulletMd === true, '');
          check('Clear formatting strips Markdown syntax', out.clearMd === true, '');
          check('link modal opens', out.linkModalVisible === true, '');
          check('link inserts [text](url) Markdown', out.linkMd === true, '');
          check('table insert adds Markdown table', out.tableMd === true, '');
          check('Italic re-applied before formatted view', out.italicReapplied === true, '');
          check('formatted view visible after toggle back', out.formattedVisible === true, '');
          check('formatted view renders the link', out.formattedHasLink === true, '');
          check('formatted view renders the table', out.formattedHasTable === true, '');
          check('formatted view renders italic', out.formattedHasEm === true, '');
          check('selection found in formatted view', out.selectWorld === true, '');
          check('Bold button bolds in formatted view', out.formattedBold === true, '');
          check('selection found for heading in formatted view', out.selectSecond === true, '');
          check('heading dropdown makes H1 in formatted view', out.formattedHeading === true, '');
          check('find reports 1 of 1 in formatted view', out.findCountFormatted === '1 of 1', out.findCountFormatted);
          check('emoji button present', out.emojiBtn === true, '');
          check('emoji picker opens in formatted view', out.emojiPickerVisible === true, '');
          check('emoji search heart returns results', out.emojiSearchResults > 0, out.emojiSearchResults);
          check('clicking emoji inserts it in formatted view', out.editorHasEmoji === true, out.emojiFirst || '');
          check('picker stays open after insert', out.emojiPickerStillOpen === true, '');
          check('Esc closes emoji picker', out.emojiPickerClosedOnEsc === true, '');
          check('theme toggle flips dark mode', out.darkAfter !== out.darkBefore, 'before=' + out.darkBefore + ' after=' + out.darkAfter);
          check('emoji picker opens in other theme', out.emojiPickerVisibleOtherTheme === true, '');
          check('formatting off hides the toolbar', out.formatbarHiddenWhenOff === true, '');
          check('formatting off forces Markdown view', out.viewMarkdownWhenOff === true, '');
          check('formatting on shows the toolbar again', out.formatbarVisibleWhenOn === true, '');
          check('formatting on restores Formatted view', out.viewFormattedWhenOn === true, '');
          check('maximize button present', out.maxBtn === true, '');
          check('maximize button IPC round-trips (boolean)', typeof out.maximizedAfterClick === 'boolean', String(out.maximizedAfterClick));
          check('maximize button IPC round-trips on restore', typeof out.restoredAfterSecondClick === 'boolean', String(out.restoredAfterSecondClick));
          check('theme toggle present', out.themeToggle === true, '');
          check('status bar present', out.statusBar === true, '');
          check('about version 1.6', out.aboutVersion === '1.6', out.aboutVersion);
          check('1.4.0: theme toggle button present', out.themeToggleBtn === true, '');
          check('1.4.0: theme button sits next to emoji button', out.themeBtnNextToEmoji === true, '');
          check('1.4.0: theme button is round', out.themeBtnRound === true, '');
          check('1.5: theme button has no orange background', out.themeBtnTransparent === true, '');
          check('1.5: theme button icon follows theme text colour', out.themeBtnIconMatchesText === true, '');
          check('1.5: editor is focused on load', out.focusOnLoad === true, out.focusOnLoadTag);
          check('1.4.0: theme button flips dark mode', out.themeBtnFlipsDark === true, '');
          check('1.4.0: flipped theme is pure white or pure black', out.themeBtnPureAfterFlip === true, out.themeBtnBgAfterFlip);
          check('1.4.0: tab/menu/toolbar/status bars match pure theme bg', out.themeBtnBarsPureAfterFlip === true, '');
          check('1.4.0: theme button shows sun in Day, moon in Night', out.themeBtnIconAfterFlip === true, '');
          check('1.4.0: theme button flips back', out.themeBtnFlipsBack === true, '');
          check('1.4.0: theme back is pure white or pure black', out.themeBtnPureAfterBack === true, out.themeBtnBgAfterBack);
          check('1.3.0: Ctrl+wheel zoom starts at 100%', out.zoomBeforeWheel === '100%', out.zoomBeforeWheel);
          check('1.3.0: Ctrl+wheel up zooms to 110%', out.zoomAfterWheelIn === '110%', out.zoomAfterWheelIn);
          check('1.3.0: Ctrl+wheel down zooms back to 100%', out.zoomAfterWheelOut === '100%', out.zoomAfterWheelOut);
          check('1.3.0: context menu opens on right-click', out.ctxMenuVisible === true, '');
          check('1.3.0: context menu Copy enabled with a selection', out.ctxCopyEnabled === true, '');
          check('1.3.0: context menu closes on editor click', out.ctxMenuClosedOnClick === true, '');
          check('1.3.0: replace keeps bold in formatted view', out.replaceBoldBefore === true && out.replaceBoldAfter === true, '');
          check('1.3.0: replace inserts the new text', out.replaceTextHasThere === true, '');
          check('1.3.0: replace round-trip keeps bold + blank line', out.markdownAfterReplace === '**Hello** there\n\nSecond para', out.markdownAfterReplace);
          check('1.3.0: F5 keeps bold in formatted view', out.f5BoldBefore === true && out.f5BoldAfter === true, '');
          check('1.3.0: F5 inserts the time/date', out.f5HasTime === true, '');
          check('1.3.0: wrap off adds nowrap to formatted view', out.wrapOffHasNowrap === true, '');
          check('1.3.0: wrap on removes nowrap from formatted view', out.wrapOnHasNowrap === false, '');
          check('1.3.0: font setting applies to formatted view', out.formattedFontHasConsolas === true, '');
          check('1.3.0: Markdown undo restores the previous text', out.mdUndoValue === 'undo me please', out.mdUndoValue);
          check('1.3.0: Markdown redo restores the changed text', out.mdRedoValue === 'undo me please CHANGED', out.mdRedoValue);
          check('1.3.0: Tab inserts a tab character', out.tabInserted === true, '');
          check('1.3.0: formatted indent kept in textContent', out.formattedIndentText === true, '');
          check('1.3.0: formatted indent kept in innerText', out.formattedIndentInner === true, '');
          check('1.3.0: formatted indent kept at 4 spaces', out.formattedIndentDeep === true, '');
          check('1.3.0: formatted paragraph preserves whitespace (pre-wrap or pre)', out.formattedPWhiteSpace === 'pre-wrap' || out.formattedPWhiteSpace === 'pre', out.formattedPWhiteSpace);
          check('1.3.0: indent round-trip keeps manifest.json exact', out.markdownAfterIndent === '{\n  "manifest_version": 3,\n  "name": "Video Link Extractor",\n  "version": "1.0",\n  "description": "Extracts hidden video URLs from webpages.",\n  "permissions": [\n    "activeTab",\n    "scripting"\n  ],\n  "action": {\n    "default_popup": "popup.html"\n  }\n}', out.markdownAfterIndent);
          check('1.3.0: tab indent is kept in formatted view', out.formattedTabIndent === true, '');
          check('default apps button present', out.defaultAppsBtn === true, '');
        } catch (e) {
          check('smoke script ran', false, String(e && e.message ? e.message : e));
        }
        console.log('[SMOKE-TEST] ' + JSON.stringify(results));
        process.exitCode = results.failed === 0 ? 0 : 1;
        try { app.quit(); } catch (e) { process.exit(process.exitCode); }
      }, 2500);
    }
    // File-open smoke-test mode: launch with a .txt path plus
    // --file-smoke-test, verify it opened in a tab with its content.
    if (process.argv.includes('--file-smoke-test')) {
      setTimeout(async () => {
        const results = { checks: [], passed: 0, failed: 0 };
        const check = (name, ok, detail) => {
          results.checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
          if (ok) results.passed += 1; else results.failed += 1;
        };
        try {
          const expectedPath = getFileArg(process.argv);
          const expectedName = expectedPath ? path.basename(expectedPath) : '';
          const out = await mainWindow.webContents.executeJavaScript(`(function () {
            const titles = Array.from(document.querySelectorAll('.tab-title')).map(el => el.textContent);
            return {
              titles: titles,
              editor: document.getElementById('editor').value,
              statusPath: document.getElementById('status-path').textContent
            };
          })()`);
          check('file arg found', !!expectedPath, expectedPath || 'none');
          check('tab titled ' + expectedName + ' exists', out.titles.indexOf(expectedName) !== -1, out.titles.join(', '));
          check('editor holds file content', out.editor.indexOf('FILE-SMOKE-TEST-CONTENT') !== -1, out.editor.slice(0, 80));
          check('status bar shows file path', !!expectedPath && out.statusPath === expectedPath, out.statusPath);
        } catch (e) {
          check('file smoke script ran', false, String(e && e.message ? e.message : e));
        }
        console.log('[FILE-SMOKE-TEST] ' + JSON.stringify(results));
        process.exitCode = results.failed === 0 ? 0 : 1;
        try { app.quit(); } catch (e) { process.exit(process.exitCode); }
      }, 2500);
    }
    // Screenshot mode (verification only, flag-gated): load sample
    // Markdown, show the Formatted view, open the emoji picker, capture
    // the window to --shot-path (default /tmp/notepad-shot.png) and quit.
    // --shot-dark forces the dark theme for the capture. Used to
    // visually check the top tab bar, + button, toolbar and picker.
    if (process.argv.includes('--screenshot')) {
      const shotArg = process.argv.find(a => typeof a === 'string' && a.indexOf('--shot-path=') === 0);
      const shotPath = shotArg ? shotArg.slice('--shot-path='.length) : '/tmp/notepad-shot.png';
      const shotDark = process.argv.includes('--shot-dark');
      setTimeout(async () => {
        try {
          await mainWindow.webContents.executeJavaScript(`(async function () {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            if (document.getElementById('status-format').textContent === 'Formatted') {
              document.getElementById('status-format').click();
              await sleep(100);
            }
            const ed = document.getElementById('editor');
            ed.value = 'Top of mind - May 6\\n\\nToday felt surprisingly calm. I did not get everything done, but I gave myself space to slow down.\\n\\n# Stuff on my mind\\n\\n- Call grandma soon and catch up\\n- Try that lemon pasta recipe this week\\n- Find a new sci-fi book\\n\\nI also found this cool article I want to read later [Reimagined Surface Pro](https://example.com)';
            ed.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(100);
            document.getElementById('status-format').click();
            await sleep(150);
            return true;
          })()`);
          await mainWindow.webContents.executeJavaScript(`(function () {
            const wantDark = ${shotDark ? 'true' : 'false'};
            const isDark = document.body.classList.contains('dark');
            if (wantDark !== isDark) document.getElementById('menu-theme').click();
            return true;
          })()`);
          await new Promise(r => setTimeout(r, 400));
          await mainWindow.webContents.executeJavaScript(`(function () {
            document.getElementById('emoji-btn').click();
            return true;
          })()`);
          await new Promise(r => setTimeout(r, 600));
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(shotPath, image.toPNG());
          console.log('[SCREENSHOT] saved ' + shotPath);
        } catch (e) {
          console.log('[SCREENSHOT] failed: ' + String(e && e.message ? e.message : e));
          process.exitCode = 1;
        }
        try { app.quit(); } catch (e) { process.exit(process.exitCode || 0); }
      }, 2500);
    }
    // PDF smoke-test mode: --pdf-test --pdf-path=/tmp/x.pdf writes a
    // real PDF of the current window (printToPDF) and quits, proving
    // the Export-as-PDF path works end to end.
    if (process.argv.includes('--pdf-test')) {
      const pdfArg = process.argv.find(a => typeof a === 'string' && a.indexOf('--pdf-path=') === 0);
      const pdfPath = pdfArg ? pdfArg.slice('--pdf-path='.length) : '/tmp/notepad-test.pdf';
      setTimeout(async () => {
        try {
          const data = await mainWindow.webContents.printToPDF({ printBackground: true });
          fs.writeFileSync(pdfPath, data);
          console.log('[PDF-TEST] wrote ' + pdfPath + ' (' + data.length + ' bytes, header=' + data.subarray(0, 5).toString() + ')');
        } catch (e) {
          console.log('[PDF-TEST] failed: ' + String(e && e.message ? e.message : e));
          process.exitCode = 1;
        }
        try { app.quit(); } catch (e) { process.exit(process.exitCode || 0); }
      }, 2500);
    }
    // Open with a file if the app was launched by double-clicking a .txt
    // file (packaged app) or from the command line with a file path.
    const arg = pendingOpenFile || getFileArg(process.argv);
    pendingOpenFile = null;
    if (arg && fs.existsSync(arg)) {
      mainWindow.webContents.send('app:open-file-arg', { path: arg });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // Single menu bar: Electron shows a default native menu (File Edit View
  // Window Help) unless one is set. Menu.setApplicationMenu(null) is the
  // documented way to remove it, so only the in-page menu bar in
  // index.html remains - exactly one File / Edit / View row.
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- File dialogs + file IO (renderer has no Node access) ----
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Text Documents', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Log Files', extensions: ['log'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const files = [];
  for (const p of result.filePaths) {
    try {
      // 1.6: read raw bytes and detect encoding + line endings, so a
      // UTF-16 file opens readable and saves back in the same encoding.
      const decoded = decodeBytes(await fs.promises.readFile(p));
      files.push({ path: p, content: decoded.text, encoding: decoded.encoding, lineEnding: decoded.lineEnding });
    } catch (e) {
      files.push({ path: p, content: '', error: String(e && e.message ? e.message : e) });
    }
  }
  return files;
});

ipcMain.handle('dialog:saveFile', async (_event, suggestedPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedPath || 'Untitled.txt',
    filters: [
      { name: 'Text Documents', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Log Files', extensions: ['log'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('file:read', async (_event, filePath) => {
  try {
    const decoded = decodeBytes(await fs.promises.readFile(filePath));
    return { ok: true, content: decoded.text, encoding: decoded.encoding, lineEnding: decoded.lineEnding };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('file:write', async (_event, filePath, content, encoding, lineEnding) => {
  try {
    // 1.6: encode back in the tab's detected encoding (default UTF-8)
    // and with its line endings, instead of always writing UTF-8/LF.
    await fs.promises.writeFile(filePath, Buffer.from(encodeBytes(content, encoding || 'UTF-8', lineEnding || 'LF')));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// 1.6: Print (system print dialog) and Export as PDF (printToPDF).
ipcMain.handle('file:print', async () => {
  if (!mainWindow) return false;
  try {
    await new Promise((resolve, reject) => {
      mainWindow.webContents.print({}, (success, failureReason) => {
        if (success) resolve(true);
        else reject(new Error(failureReason || 'Print failed'));
      });
    });
    return true;
  } catch (e) { return false; }
});
ipcMain.handle('file:exportPdf', async () => {
  if (!mainWindow) return { ok: false, error: 'No window' };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'Notepad.pdf',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }, { name: 'All Files', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  try {
    const data = await mainWindow.webContents.printToPDF({ printBackground: true });
    await fs.promises.writeFile(result.filePath, data);
    return { ok: true, path: result.filePath, bytes: data.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// ---- Settings + session persistence (plain JSON in userData) ----
ipcMain.handle('store:get', (_event, name, fallback) => readJsonFile(name, fallback));
ipcMain.handle('store:set', (_event, name, data) => writeJsonFile(name, data));
ipcMain.handle('app:getVersion', () => APP_VERSION);
ipcMain.handle('app:newWindow', () => { createWindow(); return true; });
// Opens the Windows Default Apps settings page so the user can pick
// Notepad once for .txt files. Documented: shell.openExternal(url).
// Windows does not let an installer set the default app silently, so
// this is an honest one-manual-pick step, not a silent takeover.
ipcMain.handle('app:openDefaultApps', async () => {
  try { await shell.openExternal('ms-settings:defaultapps'); return true; }
  catch (e) { return false; }
});
ipcMain.handle('app:showItemInFolder', (_event, filePath) => {
  try { shell.showItemInFolder(filePath); return true; } catch (e) { return false; }
});

// 1.1.0: custom window controls for the frameless window. Documented
// BrowserWindow methods: minimize(), maximize(), unmaximize(),
// isMaximized(), close(). The renderer asks isMaximized() to pick the
// maximize vs restore icon.
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); return true; });
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); return true; });
ipcMain.handle('window:is-maximized', () => mainWindow ? mainWindow.isMaximized() : false);
// 1.1.0: Ctrl+clicked links in the formatted view. Only http(s) URLs
// are opened, never file:// or other schemes.
ipcMain.handle('app:openExternal', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  try { await shell.openExternal(url); return true; }
  catch (e) { return false; }
});
