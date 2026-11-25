'use strict';

/*
 * Notepad 1.6 - renderer.
 * Tabs, find/replace, zoom, autosave session, recent files, settings,
 * emoji picker (WhatsApp style), Markdown formatting (official
 * Windows 11 Notepad model).
 * 1.6 adds: Find/Replace match-case, whole-word and regex; Print and
 * Export as PDF; 22 fonts + font weight; encoding detection (UTF-8 /
 * UTF-8 BOM / UTF-16LE / UTF-16BE) and CRLF/LF display + conversion;
 * tab drag reorder; .md/.log file associations; unsaved-tab backup
 * (backup.json); developer Anjum Learning Lab.
 * 1.4.0 adds: a round Day / Night theme toggle button next to the
 * emoji button in the menu bar (sun icon in Day mode, moon icon in
 * Night mode). Day mode is pure white and Night mode is pure black
 * across the whole app - tab bar, menu bar, formatting toolbar,
 * editor, find/replace bars and status bar - via the CSS variables in
 * styles.css. The toggle shares one toggleTheme() with the View menu
 * item, so both stay in sync and the choice is saved.
 * 1.5 adds: the editor is focused as soon as the app opens (caret at
 * Ln 1, Col 1, no click on "Start typing..." needed), and the theme
 * toggle button has no orange any more (transparent, currentColor icon).
 * 1.3.0 fixes: Ctrl+mouse-wheel zoom (both views); right-click context
 * menu (Cut/Copy/Paste/Select All/Undo/Redo); Find/Replace and F5
 * Time/Date in the Formatted view edit the DOM directly, so bold,
 * italic, headings and links survive; Word Wrap and the font setting
 * now apply to the Formatted view too; Undo/Redo work in the Markdown
 * view via a text history stack (document.execCommand('undo') returns
 * false on a textarea); blank lines between paragraphs survive a
 * Formatted <-> Markdown round-trip; Tab inserts a tab character;
 * dropping plain text into the editor inserts it instead of being
 * swallowed by the file-drop handler.
 * 1.3.0 fix: leading spaces/tabs at the start of a line survive the
 * Formatted view. The Formatted view renders Markdown into HTML, and
 * HTML with normal white-space collapses line-leading spaces, so a
 * pasted manifest.json lost all its indentation on screen (and
 * innerText-based edits could lose it on save too). styles.css now
 * sets white-space: pre-wrap on #formatted-view and its blocks, so
 * leading whitespace is significant in the DOM, in rendering, in
 * innerText and in paste/editing - the Markdown round-trip keeps the
 * exact indentation. No text is rewritten: serializeNode already
 * returns text-node values as-is.
 * Uses only the window.notepadAPI bridge exposed by preload.js.
 * No Node access from this file.
 * 1.0.2 fixes kept: Untitled tabs are named from the CURRENT tabs only
 * (no ever-increasing counter), so closing the last tab makes a fresh
 * plain 'Untitled'; restored 'Untitled (30)' sessions are migrated back.
 * 1.1.0: tab bar is the topmost title-bar row (frameless window),
 * new-tab + sits right after the last tab, formatting toolbar under the
 * menu bar, Formatted view (rendered Markdown, editable) vs Markdown
 * view (raw syntax textarea), status-bar view toggle, Settings option
 * to turn formatting off.
 *
 * Formatting model (official Notepad): Markdown is the file format.
 * The toolbar edits Markdown syntax in the Markdown view (pure string
 * functions) and edits the rendered document in the Formatted view
 * (document.execCommand - the Chromium editing API, still functional
 * in Electron 44 - with DOM-to-Markdown serialization on every sync,
 * so typing inside bold text stays bold when you switch views).
 */
(function () {
  const api = window.notepadAPI || null;
  // 1.6: shared pure helpers (find/regex, encoding, line endings, tab
  // reorder) live in text-utils.js and are loaded before this file.
  const TU = window.NotepadTextUtils || null;
  const editor = document.getElementById('editor');
  const formattedView = document.getElementById('formatted-view');
  const tabsEl = document.getElementById('tabs');
  const statusLnCol = document.getElementById('status-lncol');
  const statusWords = document.getElementById('status-words');
  const statusChars = document.getElementById('status-chars');
  const statusZoom = document.getElementById('status-zoom');
  const statusEncoding = document.getElementById('status-encoding');
  const statusEol = document.getElementById('status-eol');
  const statusPath = document.getElementById('status-path');
  const statusFormat = document.getElementById('status-format');
  const statusbar = document.getElementById('statusbar');
  const findBar = document.getElementById('find-bar');
  const replaceBar = document.getElementById('replace-bar');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');
  const replaceFindInput = document.getElementById('replace-find-input');
  const replaceWithInput = document.getElementById('replace-with-input');
  const replaceCount = document.getElementById('replace-count');
  const emojiPickerEl = document.getElementById('emoji-picker');
  const emojiSearchEl = document.getElementById('emoji-search');
  const emojiCatsEl = document.getElementById('emoji-categories');
  const emojiGridEl = document.getElementById('emoji-grid');
  const emojiCountEl = document.getElementById('emoji-count');
  const formatbar = document.getElementById('formatbar');
  const headingSelect = document.getElementById('heading-select');

  const DEFAULT_SETTINGS = {
    theme: 'system',
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: 15,
    fontWeight: '400',
    wordWrap: false,
    autosave: true,
    spellcheck: true,
    statusBar: true,
    zoom: 100,
    formatting: true,
    viewMode: 'formatted'
  };
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  // 1.6: shared Find/Replace options for both bars.
  let findOptions = { matchCase: false, wholeWord: false, regex: false };
  let findError = '';
  let recentFiles = [];
  let tabs = [];
  let activeId = null;
  let nextTabId = 1;
  let recentEmojis = [];
  let emojiCategory = 'Recent';
  let emojiOpen = false;
  let sessionTimer = null;
  let findMatches = [];
  let findIndex = -1;
  // Markdown-view (textarea) undo/redo history. document.execCommand
  // ('undo') does not work on a textarea (it returns false), so the
  // Markdown view keeps its own stack of { text, start, end } snapshots.
  // The Formatted view keeps using the native execCommand undo stack.
  let mdUndoStack = [];
  let mdRedoStack = [];
  let lastMdText = null;
  let lastMdSel = { start: 0, end: 0 };
  // Files handed to the app at launch (double-clicked .txt) can arrive
  // before the saved session has finished loading. Queue them and open
  // them once loading is done, so the session restore cannot overwrite
  // or lose the launched file's tab.
  let initialized = false;
  let pendingOpenPaths = [];
  // 'formatted' renders Markdown; 'markdown' shows the raw syntax.
  let viewMode = 'formatted';

  function baseName(p) {
    if (!p) return '';
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  function activeTab() {
    return tabs.find(t => t.id === activeId) || null;
  }

  // The view actually shown: formatting off forces plain Markdown view.
  function effectiveView() {
    return settings.formatting ? viewMode : 'markdown';
  }

  function syncEditorToTab() {
    const tab = activeTab();
    if (!tab) return;
    if (effectiveView() === 'formatted') tab.content = serializeFormatted();
    else tab.content = editor.value;
  }

  function isDirty(tab) {
    return tab.content !== tab.savedContent;
  }

  // ---------- Tabs ----------
  // Untitled naming (1.0.2 fix): the title is computed from the CURRENT
  // tabs only - never from a global counter. Closing the last tab
  // therefore makes a fresh plain 'Untitled' instead of Untitled (31).
  function untitledTitleFor(titles) {
    const set = new Set(titles || []);
    if (!set.has('Untitled')) return 'Untitled';
    let n = 2;
    while (set.has('Untitled (' + n + ')')) n += 1;
    return 'Untitled (' + n + ')';
  }
  function nextUntitledTitle() {
    return untitledTitleFor(tabs.map(t => t.title));
  }
  // Session migration (1.0.2): a restored 'Untitled (30)' that is the
  // only Untitled tab becomes plain 'Untitled'; several numbered
  // Untitled tabs are renumbered in order (Untitled, Untitled (2), ...).
  // File tabs are never renamed.
  function normalizeUntitledTitles(list) {
    let n = 0;
    list.forEach(t => {
      if (!t.filePath && /^Untitled( \(\d+\))?$/.test(t.title || '')) {
        n += 1;
        t.title = n === 1 ? 'Untitled' : 'Untitled (' + n + ')';
      }
    });
    return list;
  }

  function newTab(filePath, content, meta) {
    syncEditorToTab();
    const tab = {
      id: nextTabId++,
      filePath: filePath || null,
      content: content || '',
      savedContent: content || '',
      title: '',
      // 1.6: detected on open, preserved on save (default UTF-8 / LF).
      encoding: (meta && meta.encoding) || 'UTF-8',
      lineEnding: (meta && meta.lineEnding) || 'LF'
    };
    if (filePath) {
      tab.title = baseName(filePath);
    } else {
      tab.title = nextUntitledTitle();
    }
    tabs.push(tab);
    activeId = tab.id;
    renderTabs();
    showTab(tab);
    scheduleSessionSave();
    return tab;
  }

  // 1.5: the caret is already in the editor when the app opens - no
  // click on "Start typing..." needed. Caret goes to the very start
  // (Ln 1, Col 1). Called from showTab, so it also covers a tab switch
  // and a file opened at launch.
  function focusEditorAtStart() {
    if (effectiveView() === 'formatted') {
      setCaretOffsets(0, 0);
    } else {
      editor.focus();
      editor.setSelectionRange(0, 0);
    }
    updateStatus();
  }

  function showTab(tab) {
    // A new tab (or a tab switch) starts a fresh Markdown undo history:
    // snapshots from another tab's text must never be restored here.
    mdUndoStack = [];
    mdRedoStack = [];
    lastMdText = null;
    lastMdSel = { start: 0, end: 0 };
    editor.value = tab.content;
    renderFormatted();
    applyViewVisibility();
    updateStatus();
    updateTitle();
    focusEditorAtStart();
  }

  function switchTab(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab || tab.id === activeId) return;
    syncEditorToTab();
    activeId = id;
    renderTabs();
    showTab(tab);
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeId ? ' active' : '');
      el.title = tab.filePath || tab.title;
      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title;
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      dot.textContent = isDirty(tab) ? '\u25CF' : '';
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '\u00D7';
      close.title = 'Close Tab (Ctrl+W)';
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
      el.appendChild(title);
      el.appendChild(dot);
      el.appendChild(close);
      el.addEventListener('click', () => switchTab(tab.id));
      el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
      // 1.6: drag a tab onto another tab to reorder it. The session
      // save preserves the new order, so it survives a restart.
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(tab.id));
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(draggedId) || draggedId === tab.id || !TU) return;
        syncEditorToTab();
        tabs = TU.reorderTabs(tabs, draggedId, tab.id);
        renderTabs();
        scheduleSessionSave();
      });
      tabsEl.appendChild(el);
    });
  }

  function updateTitle() {
    const tab = activeTab();
    const name = tab ? tab.title : 'Notepad';
    document.title = (tab && isDirty(tab) ? '\u25CF ' : '') + name + ' - Notepad';
  }

  // ---------- Modal helpers ----------
  function showConfirm(message, buttons) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modal-overlay');
      const msg = document.getElementById('modal-message');
      const box = document.getElementById('modal-buttons');
      msg.textContent = message;
      box.innerHTML = '';
      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        if (b.primary) btn.className = 'primary';
        btn.addEventListener('click', () => {
          overlay.classList.add('hidden');
          resolve(b.value);
        });
        box.appendChild(btn);
      });
      overlay.classList.remove('hidden');
    });
  }

  function showMessage(message) {
    return showConfirm(message, [{ label: 'OK', value: 'ok', primary: true }]);
  }

  // ---------- File operations ----------
  async function saveTab(tab, asNew) {
    if (!tab) return false;
    if (!api) { showMessage('File saving is not available in this mode.'); return false; }
    syncEditorToTab();
    let target = tab.filePath;
    if (!target || asNew) {
      const suggested = target || (tab.title.replace(/[\\/:*?"<>|]/g, '') + '.txt');
      target = await api.saveFileDialog(suggested);
      if (!target) return false;
    }
    const result = await api.writeFile(target, tab.content, tab.encoding, tab.lineEnding);
    if (!result.ok) {
      await showMessage('Could not save the file: ' + (result.error || 'Unknown error'));
      return false;
    }
    tab.filePath = target;
    tab.savedContent = tab.content;
    tab.title = baseName(target);
    addRecent(target);
    renderTabs();
    updateStatus();
    updateTitle();
    scheduleSessionSave();
    return true;
  }

  async function closeTab(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    syncEditorToTab();
    if (isDirty(tab)) {
      const choice = await showConfirm(
        'Do you want to save changes to ' + tab.title + '?',
        [
          { label: 'Save', value: 'save', primary: true },
          { label: "Don't Save", value: 'dontsave' },
          { label: 'Cancel', value: 'cancel' }
        ]
      );
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const saved = await saveTab(tab, false);
        if (!saved) return;
      }
    }
    tabs = tabs.filter(t => t.id !== id);
    if (tabs.length === 0) {
      newTab();
    } else {
      if (activeId === id) activeId = tabs[tabs.length - 1].id;
      renderTabs();
      showTab(activeTab());
    }
    scheduleSessionSave();
  }

  async function openFiles() {
    if (!api) return;
    const files = await api.openFileDialog();
    if (!files) return;
    for (const f of files) {
      if (f.error) { await showMessage('Could not open ' + f.path + ': ' + f.error); continue; }
      const existing = tabs.find(t => t.filePath === f.path);
      if (existing) { switchTab(existing.id); continue; }
      newTab(f.path, f.content, { encoding: f.encoding, lineEnding: f.lineEnding });
      addRecent(f.path);
    }
    renderRecent();
  }

  async function openPath(filePath) {
    if (!api) return;
    const result = await api.readFile(filePath);
    if (!result.ok) { await showMessage('Could not open ' + filePath + ': ' + (result.error || 'Unknown error')); return; }
    const existing = tabs.find(t => t.filePath === filePath);
    if (existing) { switchTab(existing.id); return; }
    newTab(filePath, result.content, { encoding: result.encoding, lineEnding: result.lineEnding });
    addRecent(filePath);
    renderRecent();
  }

  // ---------- Recent files ----------
  function addRecent(filePath) {
    recentFiles = [filePath].concat(recentFiles.filter(p => p !== filePath)).slice(0, 10);
    persistSettings();
    renderRecent();
  }

  function renderRecent() {
    const list = document.getElementById('recent-list');
    list.innerHTML = '';
    if (!recentFiles.length) {
      const empty = document.createElement('button');
      empty.textContent = 'No recent files';
      empty.disabled = true;
      list.appendChild(empty);
      return;
    }
    recentFiles.forEach(p => {
      const b = document.createElement('button');
      b.textContent = baseName(p);
      b.title = p;
      b.addEventListener('click', () => { closeMenus(); openPath(p); });
      list.appendChild(b);
    });
  }

  // ---------- Markdown transforms (pure functions, Markdown view) ----------
  // Each takes the text + a selection/caret and returns the new text plus
  // the caret/selection to restore. Mirrored in tests/test.js.
  function wrapInline(text, start, end, marker) {
    if (start !== end) {
      const sel = text.slice(start, end);
      if (sel.length >= marker.length * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
        return { text: text.slice(0, start) + sel.slice(marker.length, -marker.length) + text.slice(end), start: start, end: end - marker.length * 2 };
      }
      return { text: text.slice(0, start) + marker + sel + marker + text.slice(end), start: start + marker.length, end: end + marker.length };
    }
    return { text: text.slice(0, start) + marker + marker + text.slice(start), start: start + marker.length, end: start + marker.length };
  }
  function lineRange(text, pos) {
    const start = text.lastIndexOf('\n', pos - 1) + 1;
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    return { start: start, end: end };
  }
  function setHeading(text, pos, level) {
    const r = lineRange(text, pos);
    const line = text.slice(r.start, r.end);
    const stripped = line.replace(/^#{1,3}\s+/, '');
    const replacement = level === 0 ? stripped : '#'.repeat(level) + ' ' + stripped;
    return { text: text.slice(0, r.start) + replacement + text.slice(r.end), start: r.start + replacement.length, end: r.start + replacement.length };
  }
  function toggleList(text, start, end, ordered) {
    const s = lineRange(text, start).start;
    const e = lineRange(text, end).end;
    const lines = text.slice(s, e).split('\n');
    const markerRe = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
    const allMarked = lines.every(l => markerRe.test(l));
    const out = lines.map((l, i) => {
      if (allMarked) return l.replace(markerRe, '');
      const plain = l.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '');
      return ordered ? (i + 1) + '. ' + plain : '- ' + plain;
    });
    const newText = out.join('\n');
    return { text: text.slice(0, s) + newText + text.slice(e), start: s, end: s + newText.length };
  }
  function insertLinkMd(text, start, end, url) {
    const sel = text.slice(start, end);
    const label = sel || 'link text';
    const md = '[' + label + '](' + url + ')';
    return { text: text.slice(0, start) + md + text.slice(end), start: start + md.length, end: start + md.length };
  }
  function insertTableMd(text, pos) {
    const table = '| Header 1 | Header 2 |\n| --- | --- |\n|  |  |';
    const before = text.slice(0, pos);
    const sep = (before === '' || before.endsWith('\n')) ? '' : '\n';
    const ins = sep + table + '\n';
    return { text: before + ins + text.slice(pos), start: pos + ins.length, end: pos + ins.length };
  }
  function clearFormatting(text, start, end) {
    const s = lineRange(text, start).start;
    const e = lineRange(text, end).end;
    const lines = text.slice(s, e).split('\n');
    const out = lines.map(l => {
      let x = l;
      // List marker first, then heading: '- # Title' must lose both.
      x = x.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '');
      x = x.replace(/^#{1,3}\s+/, '');
      x = x.replace(/\*\*([^*]+)\*\*/g, '$1');
      x = x.replace(/~~([^~]+)~~/g, '$1');
      x = x.replace(/\*([^*]+)\*/g, '$1');
      x = x.replace(/_([^_]+)_/g, '$1');
      x = x.replace(/`([^`]+)`/g, '$1');
      x = x.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1');
      return x;
    });
    const newText = out.join('\n');
    return { text: text.slice(0, s) + newText + text.slice(e), start: s, end: s + newText.length };
  }

  // ---------- Markdown -> rendered DOM (Formatted view) ----------
  function appendInline(parent, text) {
    const re = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s\n]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const tok = m[0];
      if (tok.indexOf('**') === 0) {
        const s = document.createElement('strong'); s.textContent = tok.slice(2, -2); parent.appendChild(s);
      } else if (tok.indexOf('~~') === 0) {
        const s = document.createElement('del'); s.textContent = tok.slice(2, -2); parent.appendChild(s);
      } else if (tok.charAt(0) === '`') {
        const s = document.createElement('code'); s.textContent = tok.slice(1, -1); parent.appendChild(s);
      } else if (tok.charAt(0) === '[') {
        const mm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        const a = document.createElement('a');
        a.textContent = mm ? mm[1] : tok;
        if (mm) a.setAttribute('href', mm[2]);
        parent.appendChild(a);
      } else if (tok.charAt(0) === '*') {
        const s = document.createElement('em'); s.textContent = tok.slice(1, -1); parent.appendChild(s);
      } else if (tok.charAt(0) === '_') {
        const s = document.createElement('em'); s.textContent = tok.slice(1, -1); parent.appendChild(s);
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function isBlockStart(line) {
    return /^(#{1,3}\s+|\s*[-*]\s+|\s*\d+[.)]\s+|\s*\|)/.test(line);
  }
  function renderMarkdownInto(text, container) {
    container.innerHTML = '';
    const lines = (text || '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') { i++; continue; }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        const el = document.createElement('h' + h[1].length);
        appendInline(el, h[2]);
        container.appendChild(el);
        i++;
        continue;
      }
      if (/^\s*\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        const table = document.createElement('table');
        rows.forEach((r, idx) => {
          if (idx === 1 && /^\s*\|[\s:|\-]+\|\s*$/.test(r)) return; // separator row
          const cells = r.split('|').slice(1, -1).map(c => c.trim());
          const tr = document.createElement('tr');
          cells.forEach(c => {
            const cell = document.createElement(idx === 0 ? 'th' : 'td');
            appendInline(cell, c);
            tr.appendChild(cell);
          });
          table.appendChild(tr);
        });
        container.appendChild(table);
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const ul = document.createElement('ul');
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const li = document.createElement('li');
          appendInline(li, lines[i].replace(/^\s*[-*]\s+/, ''));
          ul.appendChild(li);
          i++;
        }
        container.appendChild(ul);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const ol = document.createElement('ol');
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          const li = document.createElement('li');
          appendInline(li, lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          ol.appendChild(li);
          i++;
        }
        container.appendChild(ol);
        continue;
      }
      const p = document.createElement('p');
      let first = true;
      while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
        if (!first) p.appendChild(document.createElement('br'));
        appendInline(p, lines[i]);
        first = false;
        i++;
      }
      container.appendChild(p);
    }
  }
  function renderFormatted() {
    const tab = activeTab();
    renderMarkdownInto(tab ? tab.content : '', formattedView);
  }

  // ---------- Rendered DOM -> Markdown (Formatted view sync) ----------
  function serializeNode(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes).map(serializeNode).join('');
    switch (tag) {
      case 'strong': case 'b': return inner ? '**' + inner + '**' : '';
      case 'em': case 'i': return inner ? '*' + inner + '*' : '';
      case 'del': case 's': case 'strike': return inner ? '~~' + inner + '~~' : '';
      case 'code': return inner ? '`' + inner + '`' : '';
      case 'a': return inner ? '[' + inner + '](' + (node.getAttribute('href') || '') + ')' : '';
      case 'br': return '\n';
      case 'h1': return '# ' + inner;
      case 'h2': return '## ' + inner;
      case 'h3': return '### ' + inner;
      case 'ul': return Array.from(node.children).map(li => '- ' + serializeNode(li)).join('\n');
      case 'ol': return Array.from(node.children).map((li, idx) => (idx + 1) + '. ' + serializeNode(li)).join('\n');
      case 'table': {
        const rows = Array.from(node.querySelectorAll('tr')).map(tr => {
          const cells = Array.from(tr.children).map(td => serializeNode(td).trim());
          return '| ' + cells.join(' | ') + ' |';
        });
        if (rows.length > 1) rows.splice(1, 0, '| ' + rows[0].split('|').slice(1, -1).map(() => '---').join(' | ') + ' |');
        return rows.join('\n');
      }
      default: return inner; // p, div, li, th, td, span
    }
  }
  function serializeFormatted() {
    const blocks = [];
    Array.from(formattedView.childNodes).forEach(n => { blocks.push(serializeNode(n)); });
    // A trailing empty line block would add a stray newline; drop only
    // empty blocks at the very end.
    while (blocks.length > 0 && blocks[blocks.length - 1] === '') blocks.pop();
    // Join blocks with a blank line: Markdown needs the blank line to
    // keep two paragraphs apart. Joining with a single '\n' merged
    // "Para1\n\nPara2" into one paragraph on the next render.
    return blocks.join('\n\n');
  }

  // ---------- Editor abstraction (works in both views) ----------
  function getEditorText() {
    if (effectiveView() === 'formatted') return formattedView.innerText;
    return editor.value;
  }
  // Map between innerText offsets and DOM positions in the formatted
  // view. Segments mirror Chromium innerText: '\n' between blocks,
  // '\t' between table cells, '\n' between table rows.
  function buildSegments(container) {
    const segs = [];
    let off = 0;
    const BLOCK = { P: 1, H1: 1, H2: 1, H3: 1, LI: 1, DIV: 1, TR: 1, UL: 1, OL: 1, TABLE: 1, TBODY: 1, THEAD: 1 };
    function walk(node) {
      if (node.nodeType === 3) {
        const len = node.nodeValue.length;
        if (len) segs.push({ node: node, start: off, end: off + len });
        off += len;
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'BR') { off += 1; return; }
      const children = Array.from(node.childNodes);
      children.forEach((child, idx) => {
        walk(child);
        if (child.nodeType === 1 && idx < children.length - 1) {
          if ((tag === 'TR') && (child.tagName === 'TD' || child.tagName === 'TH')) off += 1; // tab
          else if ((tag === 'TBODY' || tag === 'THEAD') && child.tagName === 'TR') off += 1; // row
          else if (BLOCK[child.tagName]) off += 1; // block boundary
        }
      });
    }
    const rootChildren = Array.from(container.childNodes);
    rootChildren.forEach((child, idx) => {
      walk(child);
      if (idx < rootChildren.length - 1 && child.nodeType === 1 && BLOCK[child.tagName]) off += 1;
    });
    return { segs: segs, total: off };
  }
  function offsetOfNodeStart(segs, node) {
    if (node.nodeType === 3) {
      const seg = segs.find(s => s.node === node);
      return seg ? seg.start : 0;
    }
    let n = node;
    while (n && n.nodeType === 1 && n.firstChild) n = n.firstChild;
    if (n && n.nodeType === 3) {
      const seg = segs.find(s => s.node === n);
      return seg ? seg.start : 0;
    }
    return 0;
  }
  function offsetOfNodeEnd(segs, total, node) {
    if (node.nodeType === 3) {
      const seg = segs.find(s => s.node === node);
      return seg ? seg.end : total;
    }
    if (node.tagName === 'BR') return offsetOfNodeStart(segs, node) + 1;
    let n = node;
    while (n && n.nodeType === 1 && n.lastChild) n = n.lastChild;
    if (n && n.nodeType === 3) {
      const seg = segs.find(s => s.node === n);
      return seg ? seg.end : total;
    }
    return offsetOfNodeStart(segs, node);
  }
  function rangeToOffset(container, node, offset) {
    const built = buildSegments(container);
    const segs = built.segs;
    const total = built.total;
    if (node === container) {
      if (offset <= 0) return 0;
      const kids = Array.from(container.childNodes);
      const prev = kids[Math.min(offset, kids.length) - 1];
      if (!prev) return total;
      return offsetOfNodeEnd(segs, total, prev);
    }
    if (node.nodeType === 3) {
      const seg = segs.find(s => s.node === node);
      return seg ? Math.min(seg.end, seg.start + offset) : total;
    }
    const kids = Array.from(node.childNodes);
    if (offset <= 0) return offsetOfNodeStart(segs, node);
    const prev = kids[Math.min(offset, kids.length) - 1];
    if (!prev) return offsetOfNodeStart(segs, node);
    return offsetOfNodeEnd(segs, total, prev);
  }
  function nodeAndOffsetFor(segs, off) {
    if (!segs.length) return [formattedView, 0];
    for (const seg of segs) {
      if (off >= seg.start && off <= seg.end) return [seg.node, off - seg.start];
    }
    const last = segs[segs.length - 1];
    return [last.node, last.node.nodeValue.length];
  }
  function getCaretOffsets() {
    if (effectiveView() === 'formatted') {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
      const range = sel.getRangeAt(0);
      if (!formattedView.contains(range.commonAncestorContainer)) return { start: 0, end: 0 };
      return {
        start: rangeToOffset(formattedView, range.startContainer, range.startOffset),
        end: rangeToOffset(formattedView, range.endContainer, range.endOffset)
      };
    }
    return { start: editor.selectionStart || 0, end: editor.selectionEnd || 0 };
  }
  function setCaretOffsets(start, end) {
    if (effectiveView() !== 'formatted') {
      editor.focus();
      editor.setSelectionRange(start, end);
      return;
    }
    const built = buildSegments(formattedView);
    const total = built.total;
    const s = Math.max(0, Math.min(start, total));
    const e = Math.max(0, Math.min(end, total));
    const range = document.createRange();
    const sp = nodeAndOffsetFor(built.segs, s);
    const ep = nodeAndOffsetFor(built.segs, e);
    range.setStart(sp[0], sp[1]);
    range.setEnd(ep[0], ep[1]);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    formattedView.focus();
  }
  function replaceEditorText(newText, start, end) {
    if (effectiveView() === 'formatted') {
      const tab = activeTab();
      if (tab) tab.content = newText;
      renderFormatted();
      setCaretOffsets(start, end);
      formattedView.focus();
    } else {
      // Record the pre-change state so Edit > Undo can restore it:
      // setting editor.value directly never reaches the native undo stack.
      mdRecordBeforeChange();
      editor.value = newText;
      editor.focus();
      editor.setSelectionRange(start, end);
      lastMdText = newText;
      lastMdSel = { start: start, end: end };
    }
  }
  function insertTextAtCaret(str) {
    if (effectiveView() === 'formatted') {
      // Insert at the live caret with execCommand, so the surrounding
      // formatting survives. The old path rebuilt tab.content from
      // innerText (plain text, no Markdown), which wiped every bold,
      // italic, heading and link in the document.
      formattedView.focus();
      document.execCommand('insertText', false, str);
      afterEdit();
      return;
    }
    const text = editor.value;
    const caret = { start: editor.selectionStart || 0, end: editor.selectionEnd || 0 };
    replaceEditorText(text.slice(0, caret.start) + str + text.slice(caret.end), caret.start + str.length, caret.start + str.length);
    afterEdit();
  }
  function afterEdit() {
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
  }

  // ---------- Markdown-view undo/redo history ----------
  // Called BEFORE a programmatic edit (toolbar, replace, link, table):
  // snapshots the current text so Undo can restore it. Typing is
  // recorded by the editor 'input' listener below (mdRecordTyping).
  function mdRecordBeforeChange() {
    if (effectiveView() !== 'markdown') return;
    const snap = { text: editor.value, start: editor.selectionStart || 0, end: editor.selectionEnd || 0 };
    const top = mdUndoStack[mdUndoStack.length - 1];
    if (top && top.text === snap.text && top.start === snap.start && top.end === snap.end) return;
    mdUndoStack.push(snap);
    if (mdUndoStack.length > 200) mdUndoStack.shift();
    mdRedoStack = [];
  }
  // Called AFTER a typed edit: the previous text (lastMdText) becomes
  // the undo snapshot. Programmatic value sets never fire 'input', so
  // this cannot double-record a toolbar/replace edit.
  function mdRecordTyping() {
    if (effectiveView() !== 'markdown') return;
    const cur = editor.value;
    const curSel = { start: editor.selectionStart || 0, end: editor.selectionEnd || 0 };
    if (lastMdText === null) { lastMdText = cur; lastMdSel = curSel; return; }
    if (lastMdText !== cur) {
      mdUndoStack.push({ text: lastMdText, start: lastMdSel.start, end: lastMdSel.end });
      if (mdUndoStack.length > 200) mdUndoStack.shift();
      mdRedoStack = [];
    }
    lastMdText = cur;
    lastMdSel = curSel;
  }
  function mdUndo() {
    if (effectiveView() !== 'markdown' || !mdUndoStack.length) return false;
    mdRedoStack.push({ text: editor.value, start: editor.selectionStart || 0, end: editor.selectionEnd || 0 });
    const s = mdUndoStack.pop();
    editor.value = s.text;
    editor.focus();
    editor.setSelectionRange(s.start, s.end);
    lastMdText = s.text;
    lastMdSel = { start: s.start, end: s.end };
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
    return true;
  }
  function mdRedo() {
    if (effectiveView() !== 'markdown' || !mdRedoStack.length) return false;
    mdUndoStack.push({ text: editor.value, start: editor.selectionStart || 0, end: editor.selectionEnd || 0 });
    const s = mdRedoStack.pop();
    editor.value = s.text;
    editor.focus();
    editor.setSelectionRange(s.start, s.end);
    lastMdText = s.text;
    lastMdSel = { start: s.start, end: s.end };
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
    return true;
  }

  // ---------- Formatted-view DOM replace (keeps formatting) ----------
  // Replaces a plain-text [start, end) range (innerText coordinates)
  // inside the live DOM text nodes, using buildSegments() to map
  // innerText offsets onto text nodes. Block-boundary newlines live in
  // no text node; a match spanning one keeps the blocks apart, which is
  // the safe behaviour for single-line find queries.
  function replacePlainRangeInFormatted(start, end, withText) {
    const built = buildSegments(formattedView);
    const segs = built.segs;
    let first = true;
    let done = false;
    segs.forEach(seg => {
      if (done) return;
      if (seg.end <= start || seg.start >= end) return;
      const node = seg.node;
      const localStart = Math.max(0, start - seg.start);
      const localEnd = Math.min(node.nodeValue.length, end - seg.start);
      if (first) {
        node.nodeValue = node.nodeValue.slice(0, localStart) + withText + node.nodeValue.slice(localEnd);
        first = false;
      } else {
        node.nodeValue = node.nodeValue.slice(0, localStart) + node.nodeValue.slice(localEnd);
      }
      if (seg.end >= end) done = true;
    });
    return !first;
  }
  // Finds query in the Formatted view's plain text and replaces it in
  // the DOM, so <strong>, <em>, headings and links all survive. The
  // old path rebuilt tab.content from innerText (no Markdown at all),
  // which wiped every bit of formatting in the document.
  function replaceInFormatted(query, withText, firstOnly, fromCaret) {
    const text = formattedView.innerText;
    if (!TU) return { replaced: 0, target: -1 };
    let matches;
    try {
      matches = TU.findMatches(text, query, findOptions);
    } catch (e) {
      return { replaced: 0, target: -1, error: e && e.message ? e.message : String(e) };
    }
    if (!matches.length) return { replaced: 0, target: -1 };
    let targets = matches;
    let target = -1;
    if (firstOnly) {
      const found = matches.find(m => m.start >= fromCaret);
      target = found ? found.start : matches[0].start;
      targets = [found || matches[0]];
    }
    // Replace from the last match backwards so earlier offsets stay valid.
    let replaced = 0;
    targets.slice().reverse().forEach(m => {
      // Regex replace: expand $1/$& in the replacement for this match.
      let rep = withText;
      if (findOptions.regex && TU.buildFindRegExp) {
        try { rep = text.slice(m.start, m.end).replace(TU.buildFindRegExp(query, findOptions), withText); } catch (e) { rep = withText; }
      }
      if (replacePlainRangeInFormatted(m.start, m.end, rep)) replaced += 1;
    });
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
    return { replaced: replaced, target: target };
  }
  function applyViewVisibility() {
    const fmt = effectiveView() === 'formatted';
    editor.classList.toggle('hidden', fmt);
    formattedView.classList.toggle('hidden', !fmt);
  }
  function updateViewUI() {
    const v = effectiveView();
    if (statusFormat) statusFormat.textContent = v === 'formatted' ? 'Formatted' : 'Markdown';
    const vf = document.getElementById('menu-view-formatted');
    const vm = document.getElementById('menu-view-markdown');
    if (vf) vf.classList.toggle('checked', v === 'formatted');
    if (vm) vm.classList.toggle('checked', v === 'markdown');
  }
  function setViewMode(mode) {
    if (!settings.formatting) mode = 'markdown';
    if (mode === viewMode && effectiveView() === mode) { updateViewUI(); return; }
    syncEditorToTab();
    viewMode = mode;
    settings.viewMode = mode;
    const tab = activeTab();
    if (tab) {
      editor.value = tab.content;
      renderFormatted();
    }
    applyViewVisibility();
    updateViewUI();
    updateStatus();
    persistSettings();
  }

  // ---------- Formatting toolbar actions ----------
  function formatBold() {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('bold', false, null);
      afterEdit();
      return;
    }
    const r = wrapInline(editor.value, editor.selectionStart, editor.selectionEnd, '**');
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function formatItalic() {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('italic', false, null);
      afterEdit();
      return;
    }
    const r = wrapInline(editor.value, editor.selectionStart, editor.selectionEnd, '*');
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function formatStrike() {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('strikeThrough', false, null);
      afterEdit();
      return;
    }
    const r = wrapInline(editor.value, editor.selectionStart, editor.selectionEnd, '~~');
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function formatHeading(level) {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('formatBlock', false, level === 0 ? 'P' : 'H' + level);
      afterEdit();
      return;
    }
    const r = setHeading(editor.value, editor.selectionStart, level);
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function formatBullet() {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('insertUnorderedList', false, null);
      afterEdit();
      return;
    }
    const r = toggleList(editor.value, editor.selectionStart, editor.selectionEnd, false);
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function formatNumbered() {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('insertOrderedList', false, null);
      afterEdit();
      return;
    }
    const r = toggleList(editor.value, editor.selectionStart, editor.selectionEnd, true);
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function formatTable() {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('insertHTML', false, '<table><tr><th>Header 1</th><th>Header 2</th></tr><tr><td></td><td></td></tr></table><p></p>');
      afterEdit();
      return;
    }
    const r = insertTableMd(editor.value, editor.selectionStart);
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function formatClear() {
    if (!settings.formatting) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('unlink', false, null);
      document.execCommand('removeFormat', false, null);
      document.execCommand('formatBlock', false, 'P');
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const node = sel.getRangeAt(0).startContainer;
        const li = node.nodeType === 1 ? node.closest('li') : (node.parentElement ? node.parentElement.closest('li') : null);
        if (li) {
          const list = li.parentElement;
          if (list) document.execCommand(list.tagName.toLowerCase() === 'ol' ? 'insertOrderedList' : 'insertUnorderedList', false, null);
        }
      }
      afterEdit();
      return;
    }
    const r = clearFormatting(editor.value, editor.selectionStart, editor.selectionEnd);
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }

  // ---------- Insert Link modal ----------
  function openLinkModal() {
    if (!settings.formatting) return;
    const overlay = document.getElementById('link-overlay');
    const input = document.getElementById('link-url-input');
    input.value = '';
    overlay.classList.remove('hidden');
    input.focus();
  }
  function closeLinkModal() {
    document.getElementById('link-overlay').classList.add('hidden');
    const el = effectiveView() === 'formatted' ? formattedView : editor;
    el.focus();
  }
  function applyLink(url) {
    if (!url) return;
    if (effectiveView() === 'formatted') {
      formattedView.focus();
      document.execCommand('createLink', false, url);
      afterEdit();
      return;
    }
    const r = insertLinkMd(editor.value, editor.selectionStart, editor.selectionEnd, url);
    replaceEditorText(r.text, r.start, r.end);
    afterEdit();
  }
  function normalizeUrl(raw) {
    const url = (raw || '').trim();
    if (!url) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
    if (url.indexOf('.') !== -1 && url.indexOf(' ') === -1) return 'https://' + url;
    return url;
  }

  // ---------- Status bar ----------
  function updateStatus() {
    const tab = activeTab();
    const text = getEditorText();
    const pos = getCaretOffsets().start;
    const before = text.slice(0, pos);
    const lines = before.split('\n');
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    statusLnCol.textContent = 'Ln ' + ln + ', Col ' + col;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    statusWords.textContent = words + (words === 1 ? ' word' : ' words');
    statusChars.textContent = text.length + (text.length === 1 ? ' character' : ' characters');
    statusZoom.textContent = settings.zoom + '%';
    // 1.6: show the active tab's real encoding and line endings, not a
    // hardcoded UTF-8. New tabs default to UTF-8 / LF.
    statusEncoding.textContent = tab ? (tab.encoding || 'UTF-8') : 'UTF-8';
    if (statusEol) statusEol.textContent = tab ? (tab.lineEnding || 'LF') : 'LF';
    if (tab) {
      statusPath.textContent = tab.filePath || tab.title;
      statusPath.title = tab.filePath || '';
    }
    updateTitle();
  }

  // ---------- Zoom / wrap / theme ----------
  function applyZoom() {
    const size = Math.round(settings.fontSize * settings.zoom / 100);
    editor.style.fontSize = size + 'px';
    formattedView.style.fontSize = size + 'px';
    document.documentElement.style.setProperty('--editor-size', size + 'px');
    statusZoom.textContent = settings.zoom + '%';
  }

  function setZoom(z) {
    settings.zoom = Math.max(25, Math.min(500, z));
    applyZoom();
    persistSettings();
  }

  function applyTheme() {
    let dark = false;
    if (settings.theme === 'dark') dark = true;
    else if (settings.theme === 'system') dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark', dark);
    const themeBtn = document.getElementById('menu-theme');
    if (themeBtn) themeBtn.textContent = dark ? 'Light Mode' : 'Dark Mode';
    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) themeSelect.value = settings.theme;
    // 1.4.0: the round toggle button shows the CURRENT mode - a sun
    // icon in Day mode, a moon icon in Night mode (1.5: currentColor,
    // no orange) - and its title names the mode it will switch to.
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
      const label = dark ? 'Switch to Light Mode' : 'Switch to Night Mode';
      toggleBtn.title = label;
      toggleBtn.setAttribute('aria-label', label);
    }
    const sunIcon = document.getElementById('theme-icon-sun');
    if (sunIcon) sunIcon.classList.toggle('hidden', dark);
    const moonIcon = document.getElementById('theme-icon-moon');
    if (moonIcon) moonIcon.classList.toggle('hidden', !dark);
  }

  // 1.4.0: one shared toggle for the menu-bar button and the View menu
  // item. Resolves 'system' to the mode actually showing, flips to the
  // explicit opposite, then applies and saves it.
  function toggleTheme() {
    settings.theme = document.body.classList.contains('dark') ? 'light' : 'dark';
    applySettings();
    persistSettings();
  }

  function applySettings() {
    editor.style.fontFamily = settings.fontFamily;
    // 1.3.0: the font setting applies to the Formatted view too. It used
    // to keep its hardcoded 'Segoe UI' no matter what was chosen here.
    formattedView.style.fontFamily = settings.fontFamily;
    // 1.6: font weight applies to both views.
    editor.style.fontWeight = settings.fontWeight || '400';
    formattedView.style.fontWeight = settings.fontWeight || '400';
    document.documentElement.style.setProperty('--editor-font', settings.fontFamily);
    editor.spellcheck = !!settings.spellcheck;
    formattedView.spellcheck = !!settings.spellcheck;
    editor.classList.toggle('wrap', !!settings.wordWrap);
    editor.setAttribute('wrap', settings.wordWrap ? 'soft' : 'off');
    // 1.3.0: Word Wrap now has a visible effect in the Formatted view
    // (the default view). Wrap off keeps long lines on one line with a
    // horizontal scrollbar; wrap on wraps them like a normal paragraph.
    formattedView.classList.toggle('nowrap', !settings.wordWrap);
    statusbar.classList.toggle('hidden', !settings.statusBar);
    const wrapBtn = document.getElementById('menu-wrap');
    if (wrapBtn) wrapBtn.classList.toggle('checked', !!settings.wordWrap);
    const statusBtn = document.getElementById('menu-status');
    if (statusBtn) statusBtn.classList.toggle('checked', !!settings.statusBar);
    if (formatbar) formatbar.classList.toggle('hidden', !settings.formatting);
    applyTheme();
    applyZoom();
    applyViewVisibility();
    updateViewUI();
    syncSettingsForm();
  }

  function syncSettingsForm() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    set('setting-theme', settings.theme);
    set('setting-font', settings.fontFamily);
    set('setting-font-size', settings.fontSize);
    set('setting-font-weight', settings.fontWeight || '400');
    chk('setting-wrap', settings.wordWrap);
    chk('setting-autosave', settings.autosave);
    chk('setting-spellcheck', settings.spellcheck);
    chk('setting-formatting', settings.formatting);
  }

  // ---------- Persistence ----------
  async function persistSettings() {
    if (!api) return;
    await api.setStore('settings.json', { settings: settings, recentFiles: recentFiles, recentEmojis: recentEmojis });
  }

  function scheduleSessionSave() {
    if (!settings.autosave || !api) return;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(saveSessionNow, 1500);
  }

  async function saveSessionNow() {
    if (!api) return;
    syncEditorToTab();
    const data = {
      activeId: activeId,
      tabs: tabs.map(t => ({ filePath: t.filePath, content: t.content, savedContent: t.savedContent, title: t.title, encoding: t.encoding || 'UTF-8', lineEnding: t.lineEnding || 'LF' }))
    };
    await api.setStore('session.json', data);
    // 1.6: crash backup — a second copy holding only the unsaved
    // (dirty) tabs, so a crash that corrupts session.json still leaves
    // the unsaved work recoverable from backup.json.
    const dirty = tabs.filter(t => isDirty(t));
    if (dirty.length) {
      await api.setStore('backup.json', {
        savedAt: new Date().toISOString(),
        tabs: dirty.map(t => ({ filePath: t.filePath, content: t.content, title: t.title, encoding: t.encoding || 'UTF-8', lineEnding: t.lineEnding || 'LF' }))
      });
    }
  }

  async function loadPersisted() {
    if (!api) return;
    const stored = await api.getStore('settings.json', null);
    if (stored) {
      if (stored.settings) settings = Object.assign({}, DEFAULT_SETTINGS, stored.settings);
      if (Array.isArray(stored.recentFiles)) recentFiles = stored.recentFiles;
      if (Array.isArray(stored.recentEmojis)) recentEmojis = stored.recentEmojis.slice(0, 24);
    }
    viewMode = settings.viewMode === 'markdown' ? 'markdown' : 'formatted';
    applySettings();
    renderRecent();
    const session = await api.getStore('session.json', null);
    if (session && Array.isArray(session.tabs) && session.tabs.length) {
      session.tabs.forEach(st => {
        const tab = { id: nextTabId++, filePath: st.filePath || null, content: st.content || '', savedContent: st.savedContent || '', title: st.title || 'Untitled', encoding: st.encoding || 'UTF-8', lineEnding: st.lineEnding || 'LF' };
        tabs.push(tab);
      });
      const active = tabs.find(t => t.id === session.activeId);
      activeId = active ? active.id : tabs[0].id;
      // 1.0.2 migration: renumber restored Untitled tabs from the
      // current tabs only, so 'Untitled (30)' becomes plain 'Untitled'.
      normalizeUntitledTitles(tabs);
      renderTabs();
      showTab(activeTab());
    } else {
      // 1.6: no usable session — fall back to the crash backup, if any.
      // Backup tabs are restored unsaved (savedContent ''), so the
      // dirty dot shows and the user is prompted before closing.
      const backup = await api.getStore('backup.json', null);
      if (backup && Array.isArray(backup.tabs) && backup.tabs.length) {
        backup.tabs.forEach(st => {
          tabs.push({ id: nextTabId++, filePath: st.filePath || null, content: st.content || '', savedContent: '', title: st.title || 'Untitled', encoding: st.encoding || 'UTF-8', lineEnding: st.lineEnding || 'LF' });
        });
        activeId = tabs[0].id;
        normalizeUntitledTitles(tabs);
        renderTabs();
        showTab(activeTab());
      } else {
        newTab();
      }
    }
    // Session is loaded now: open any file handed to the app at launch.
    initialized = true;
    const queued = pendingOpenPaths;
    pendingOpenPaths = [];
    queued.forEach(p => openPath(p));
    const version = await api.getVersion();
    const aboutVersion = document.getElementById('about-version');
    if (aboutVersion && version) aboutVersion.textContent = version;
    updateMaxIcon();
  }

  // ---------- Find / Replace ----------
  // 1.6: match-case, whole-word and regex options (shared by both bars).
  // findMatches entries are {start, end} so regex matches of any length
  // select and replace correctly. An invalid regex shows a clear error
  // in the count label and never throws out of the UI.
  function syncFindOptButtons() {
    document.querySelectorAll('.find-opt').forEach(btn => {
      const opt = btn.getAttribute('data-opt');
      btn.classList.toggle('active', !!findOptions[opt]);
      btn.setAttribute('aria-pressed', findOptions[opt] ? 'true' : 'false');
    });
  }
  function computeMatches(query) {
    findMatches = [];
    findIndex = -1;
    findError = '';
    if (!query) { findCount.textContent = ''; return; }
    if (!TU) { findCount.textContent = 'Find unavailable'; return; }
    try {
      findMatches = TU.findMatches(getEditorText(), query, findOptions);
    } catch (e) {
      findError = e && e.message ? e.message : String(e);
      findCount.textContent = findError;
      if (replaceCount) replaceCount.textContent = findError;
      return;
    }
    findCount.textContent = findMatches.length ? '0 of ' + findMatches.length : 'No results';
  }

  function selectMatch(i) {
    if (!findMatches.length) return;
    findIndex = ((i % findMatches.length) + findMatches.length) % findMatches.length;
    const match = findMatches[findIndex];
    setCaretOffsets(match.start, match.end);
    findCount.textContent = (findIndex + 1) + ' of ' + findMatches.length;
    updateStatus();
  }

  function showFind() {
    replaceBar.classList.add('hidden');
    findBar.classList.remove('hidden');
    const sel = getEditorText().substring(getCaretOffsets().start, getCaretOffsets().end);
    if (sel) findInput.value = sel;
    findInput.focus();
    findInput.select();
    computeMatches(findInput.value);
  }

  function showReplace() {
    findBar.classList.add('hidden');
    replaceBar.classList.remove('hidden');
    const sel = getEditorText().substring(getCaretOffsets().start, getCaretOffsets().end);
    if (sel) replaceFindInput.value = sel;
    replaceFindInput.focus();
    replaceFindInput.select();
  }

  function replaceOne() {
    const query = replaceFindInput.value;
    const withText = replaceWithInput.value;
    if (!query) return;
    if (findError) { replaceCount.textContent = findError; return; }
    if (effectiveView() === 'formatted') {
      computeMatches(query);
      if (findError) { replaceCount.textContent = findError; return; }
      if (!findMatches.length) { replaceCount.textContent = 'No results'; return; }
      const caret = getCaretOffsets().start;
      const res = replaceInFormatted(query, withText, true, caret);
      if (res.target >= 0) setCaretOffsets(res.target + withText.length, res.target + withText.length);
      computeMatches(query);
      replaceCount.textContent = findMatches.length ? (findMatches.length + ' remaining') : 'No results';
      updateStatus();
      scheduleSessionSave();
      return;
    }
    computeMatches(query);
    if (findError) { replaceCount.textContent = findError; return; }
    if (!findMatches.length) { replaceCount.textContent = 'No results'; return; }
    // Replace the match at or after the caret, then move to the next one.
    const caret = getCaretOffsets().start;
    const text = getEditorText();
    let target = findMatches.find(m => m.start >= caret);
    if (target === undefined) target = findMatches[0];
    const newText = text.slice(0, target.start) + withText + text.slice(target.end);
    replaceEditorText(newText, target.start + withText.length, target.start + withText.length);
    syncEditorToTab();
    renderTabs();
    updateStatus();
    computeMatches(query);
    replaceCount.textContent = findMatches.length ? (findMatches.length + ' remaining') : 'No results';
    scheduleSessionSave();
  }

  function replaceAll() {
    const query = replaceFindInput.value;
    const withText = replaceWithInput.value;
    if (!query) return;
    if (effectiveView() === 'formatted') {
      const res = replaceInFormatted(query, withText, false, 0);
      if (res.error) { replaceCount.textContent = res.error; return; }
      setCaretOffsets(0, 0);
      syncEditorToTab();
      renderTabs();
      updateStatus();
      replaceCount.textContent = res.replaced + ' replaced';
      scheduleSessionSave();
      return;
    }
    if (!TU) return;
    let res;
    try {
      res = TU.replaceAllText(getEditorText(), query, withText, findOptions);
    } catch (e) {
      replaceCount.textContent = e && e.message ? e.message : String(e);
      return;
    }
    replaceEditorText(res.text, 0, 0);
    syncEditorToTab();
    renderTabs();
    updateStatus();
    replaceCount.textContent = res.count + ' replaced';
    scheduleSessionSave();
  }

  // ---------- Go To Line / Time-Date ----------
  function goToLine(n) {
    const lines = getEditorText().split('\n');
    const lineNo = Math.max(1, Math.min(lines.length, n || 1));
    let offset = 0;
    for (let i = 0; i < lineNo - 1; i++) offset += lines[i].length + 1;
    setCaretOffsets(offset, offset);
    updateStatus();
  }

  function insertTimeDate() {
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const text = pad(hours) + ':' + pad(now.getMinutes()) + ' ' + ampm + ' ' +
      pad(now.getMonth() + 1) + '/' + pad(now.getDate()) + '/' + now.getFullYear();
    insertTextAtCaret(text);
  }

  // ---------- Emoji picker (WhatsApp style) ----------
  // Data comes from emoji-data.js (standard Unicode emoji, generated from
  // Unicode emoji-test.txt). Emojis render with the system emoji font
  // (Segoe UI Emoji on Windows).
  const EMOJI_CATEGORIES = [
    { id: 'Recent', icon: '\uD83D\uDD52', label: 'Recent' },
    { id: 'Smileys', icon: '\uD83D\uDE00', label: 'Smileys' },
    { id: 'People', icon: '\uD83D\uDC4B', label: 'People' },
    { id: 'Animals', icon: '\uD83D\uDC36', label: 'Animals' },
    { id: 'Food', icon: '\uD83C\uDF54', label: 'Food' },
    { id: 'Activities', icon: '\u26BD', label: 'Activities' },
    { id: 'Travel', icon: '\u2708\uFE0F', label: 'Travel' },
    { id: 'Objects', icon: '\uD83D\uDCA1', label: 'Objects' },
    { id: 'Symbols', icon: '\u2764\uFE0F', label: 'Symbols' },
    { id: 'Flags', icon: '\uD83C\uDFF3\uFE0F', label: 'Flags' }
  ];
  function emojiData() {
    return (typeof window !== 'undefined' && Array.isArray(window.EMOJI_DATA)) ? window.EMOJI_DATA : [];
  }
  function emojiMatches(e, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return true;
    const hay = (e.n + ' ' + (e.k || []).join(' ')).toLowerCase();
    return q.split(/\s+/).every(tok => {
      if (!tok) return true;
      if (hay.indexOf(tok) !== -1) return true;
      // Plural/longer query form (e.g. 'smiles' vs keyword 'smile').
      // Require a keyword of 3+ letters here, so a 1-letter keyword
      // can never make gibberish like 'xyzqqq' match.
      return (e.k || []).some(k => k.indexOf(tok) !== -1 || (k.length >= 3 && tok.indexOf(k) !== -1));
    });
  }
  function insertAt(text, start, end, ins) {
    return { text: text.slice(0, start) + ins + text.slice(end), caret: start + ins.length };
  }
  function addRecentEmoji(ch) {
    recentEmojis = [ch].concat(recentEmojis.filter(c => c !== ch)).slice(0, 24);
    persistSettings();
  }
  function insertEmoji(ch) {
    if (effectiveView() === 'formatted') {
      // Capture the caret BEFORE focusing: clicking the picker moves focus
      // away from the editor, but the selection survives in the div.
      formattedView.focus();
      document.execCommand('insertText', false, ch);
      addRecentEmoji(ch);
      syncEditorToTab();
      renderTabs();
      updateStatus();
      scheduleSessionSave();
      return;
    }
    // Capture the caret BEFORE focusing: clicking the picker moves focus
    // away from the editor, but selectionStart still holds the last caret.
    const start = editor.selectionStart || 0;
    const end = editor.selectionEnd || 0;
    const result = insertAt(editor.value, start, end, ch);
    editor.value = result.text;
    editor.focus();
    editor.setSelectionRange(result.caret, result.caret);
    addRecentEmoji(ch);
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
  }
  function renderEmojiCategories() {
    emojiCatsEl.innerHTML = '';
    EMOJI_CATEGORIES.forEach(cat => {
      const b = document.createElement('button');
      b.className = 'emoji-cat-btn' + (cat.id === emojiCategory ? ' active' : '');
      b.textContent = cat.icon;
      b.title = cat.label;
      b.setAttribute('aria-label', cat.label);
      b.addEventListener('click', () => { emojiCategory = cat.id; renderEmojiCategories(); renderEmojiGrid(); });
      emojiCatsEl.appendChild(b);
    });
  }
  function renderEmojiGrid() {
    const q = emojiSearchEl.value || '';
    const searching = q.trim().length > 0;
    let list;
    if (searching) {
      list = emojiData().filter(e => emojiMatches(e, q));
    } else if (emojiCategory === 'Recent') {
      const data = emojiData();
      list = recentEmojis.map(ch => data.find(e => e.c === ch)).filter(Boolean);
    } else {
      list = emojiData().filter(e => e.g === emojiCategory);
    }
    emojiGridEl.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'emoji-empty';
      empty.textContent = searching ? 'No results' : 'No recent emojis yet';
      emojiGridEl.appendChild(empty);
    } else {
      list.forEach(e => {
        const b = document.createElement('button');
        b.className = 'emoji-item';
        b.textContent = e.c;
        b.title = e.n;
        b.setAttribute('aria-label', e.n);
        b.addEventListener('click', () => insertEmoji(e.c));
        emojiGridEl.appendChild(b);
      });
    }
    emojiCountEl.textContent = searching
      ? list.length + (list.length === 1 ? ' result for "' : ' results for "') + q.trim() + '"'
      : (emojiCategory === 'Recent' ? list.length + ' recent' : emojiCategory + ' - ' + list.length + ' emojis');
  }
  function openEmojiPicker() {
    if (!recentEmojis.length) emojiCategory = 'Smileys';
    emojiSearchEl.value = '';
    renderEmojiCategories();
    renderEmojiGrid();
    emojiPickerEl.classList.remove('hidden');
    emojiOpen = true;
    emojiSearchEl.focus();
  }
  function closeEmojiPicker() {
    emojiPickerEl.classList.add('hidden');
    emojiOpen = false;
    const el = effectiveView() === 'formatted' ? formattedView : editor;
    el.focus();
  }
  function toggleEmojiPicker() {
    if (emojiOpen) closeEmojiPicker();
    else openEmojiPicker();
  }

  // ---------- Menus ----------
  function closeMenus() {
    document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
  }

  document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.parentElement;
      const wasOpen = menu.classList.contains('open');
      closeMenus();
      if (!wasOpen) menu.classList.add('open');
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) closeMenus();
  });

  function activeEditorEl() {
    return effectiveView() === 'formatted' ? formattedView : editor;
  }

  // Formatting shortcuts (Ctrl+B / Ctrl+I / Ctrl+K) apply unless the
  // focus is in a text input, a select, a modal field, a picker or a
  // menu - everywhere else (editor, toolbar button, document) the
  // active editor owns the selection.
  function targetIsFormattable(t) {
    if (!t || t === document || t === document.body) return true;
    if (t.nodeType !== 1) return true;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return false;
    if (tag === 'TEXTAREA' && t !== editor) return false;
    if (t.closest('#emoji-picker, .dropdown, #link-overlay, #settings-overlay, #gotoline-overlay, #modal-overlay, #find-bar, #replace-bar')) return false;
    return true;
  }

  function editCommand(cmd) {
    // Undo/Redo in the Markdown view use the text history stack:
    // document.execCommand('undo') returns false on a textarea.
    if (cmd === 'undo' && effectiveView() !== 'formatted') {
      if (!mdUndo()) { /* nothing to undo */ }
      return;
    }
    if (cmd === 'redo' && effectiveView() !== 'formatted') {
      if (!mdRedo()) { /* nothing to redo */ }
      return;
    }
    activeEditorEl().focus();
    if (cmd === 'paste') {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(text => {
          insertTextAtCaret(text);
        }).catch(() => { document.execCommand('paste'); });
        return;
      }
    }
    if (cmd === 'copy' || cmd === 'cut') {
      // execCommand works with a real user gesture (verified live), but
      // returns false without one. Fall back to the async Clipboard API
      // so Copy/Cut from the context menu never silently do nothing.
      let ok = false;
      try { ok = document.execCommand(cmd); } catch (e) { ok = false; }
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
        const sel = effectiveView() === 'formatted'
          ? window.getSelection().toString()
          : editor.value.substring(editor.selectionStart || 0, editor.selectionEnd || 0);
        if (sel) {
          navigator.clipboard.writeText(sel).then(() => {
            if (cmd === 'cut') {
              if (effectiveView() === 'formatted') document.execCommand('delete', false, null);
              else {
                const s = editor.selectionStart || 0;
                const e2 = editor.selectionEnd || 0;
                replaceEditorText(editor.value.slice(0, s) + editor.value.slice(e2), s, s);
              }
              afterEdit();
            }
          }).catch(() => { /* clipboard unavailable - nothing more to try */ });
        }
      } else if (ok && cmd === 'cut') {
        syncEditorToTab();
        renderTabs();
        updateStatus();
        scheduleSessionSave();
        return;
      } else if (ok) {
        return; // copy done - no tab content changed
      } else {
        return; // no selection / clipboard unavailable
      }
      syncEditorToTab();
      renderTabs();
      updateStatus();
      scheduleSessionSave();
      return;
    }
    document.execCommand(cmd);
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
  }

  // 1.6: convert the active tab's line endings in place.
  function convertLineEndings(style) {
    const tab = activeTab();
    if (!tab || !TU) return;
    syncEditorToTab();
    tab.content = TU.convertLineEnding(tab.content, style);
    tab.lineEnding = style;
    if (effectiveView() === 'formatted') renderFormatted();
    else editor.value = tab.content;
    updateStatus();
    scheduleSessionSave();
  }

  async function handleAction(action) {
    closeMenus();
    const tab = activeTab();
    switch (action) {
      case 'new-tab': newTab(); activeEditorEl().focus(); break;
      case 'new-window': if (api) api.newWindow(); break;
      case 'open': openFiles(); break;
      case 'save': if (tab) await saveTab(tab, false); break;
      case 'save-as': if (tab) await saveTab(tab, true); break;
      case 'save-all':
        for (const t of tabs.slice()) { if (isDirty(t)) await saveTab(t, false); }
        break;
      case 'print':
        if (api && api.printPage) { const ok = await api.printPage(); if (!ok) showMessage('Printing was cancelled or failed.'); }
        else showMessage('Printing is not available in this mode.');
        break;
      case 'export-pdf':
        if (api && api.exportPdf) {
          const res = await api.exportPdf();
          if (res && res.ok) showMessage('PDF saved to ' + res.path);
          else if (res && !res.cancelled) showMessage('Could not export PDF: ' + (res.error || 'Unknown error'));
        } else showMessage('PDF export is not available in this mode.');
        break;
      case 'convert-eol-crlf': convertLineEndings('CRLF'); break;
      case 'convert-eol-lf': convertLineEndings('LF'); break;
      case 'show-in-folder':
        if (tab && tab.filePath && api) api.showItemInFolder(tab.filePath);
        else showMessage('Save this file first to show it in its folder.');
        break;
      case 'close-tab': if (tab) closeTab(tab.id); break;
      case 'exit': saveSessionNow().then(() => window.close()); break;
      case 'undo': editCommand('undo'); break;
      case 'redo': editCommand('redo'); break;
      case 'cut': editCommand('cut'); break;
      case 'copy': editCommand('copy'); break;
      case 'paste': editCommand('paste'); break;
      case 'select-all':
        activeEditorEl().focus();
        if (effectiveView() === 'formatted') { document.execCommand('selectAll', false, null); }
        else editor.select();
        break;
      case 'find': showFind(); break;
      case 'replace': showReplace(); break;
      case 'find-next': showFind(); selectMatch(findIndex + 1); break;
      case 'find-prev': showFind(); selectMatch(findIndex - 1); break;
      case 'go-to-line':
        document.getElementById('gotoline-overlay').classList.remove('hidden');
        document.getElementById('gotoline-input').focus();
        document.getElementById('gotoline-input').select();
        break;
      case 'time-date': insertTimeDate(); break;
      case 'emoji': toggleEmojiPicker(); break;
      case 'view-formatted': setViewMode('formatted'); break;
      case 'view-markdown': setViewMode('markdown'); break;
      case 'toggle-wrap':
        settings.wordWrap = !settings.wordWrap;
        applySettings(); persistSettings();
        break;
      case 'toggle-status':
        settings.statusBar = !settings.statusBar;
        applySettings(); persistSettings();
        break;
      case 'toggle-theme':
        toggleTheme();
        break;
      case 'zoom-in': setZoom(settings.zoom + 10); break;
      case 'zoom-out': setZoom(settings.zoom - 10); break;
      case 'zoom-reset': setZoom(100); break;
      case 'settings':
        syncSettingsForm();
        document.getElementById('settings-overlay').classList.remove('hidden');
        break;
      case 'about':
        document.getElementById('about-overlay').classList.remove('hidden');
        break;
    }
  }

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.getAttribute('data-action')));
  });

  document.getElementById('new-tab-btn').addEventListener('click', () => { newTab(); activeEditorEl().focus(); });

  // ---------- Formatting toolbar events ----------
  document.getElementById('fmt-bold').addEventListener('click', formatBold);
  document.getElementById('fmt-italic').addEventListener('click', formatItalic);
  document.getElementById('fmt-strike').addEventListener('click', formatStrike);
  document.getElementById('fmt-bullet').addEventListener('click', formatBullet);
  document.getElementById('fmt-numbered').addEventListener('click', formatNumbered);
  document.getElementById('fmt-link').addEventListener('click', openLinkModal);
  document.getElementById('fmt-table').addEventListener('click', formatTable);
  document.getElementById('fmt-clear').addEventListener('click', formatClear);
  headingSelect.addEventListener('change', () => {
    const v = headingSelect.value;
    formatHeading(v === 'h1' ? 1 : v === 'h2' ? 2 : v === 'h3' ? 3 : 0);
    headingSelect.value = 'normal';
  });

  // ---------- Status bar view toggle ----------
  statusFormat.addEventListener('click', () => {
    setViewMode(effectiveView() === 'formatted' ? 'markdown' : 'formatted');
  });

  // ---------- Window controls (frameless window) ----------
  const winMaxBtn = document.getElementById('win-max-btn');
  function updateMaxIcon(maximized) {
    if (!winMaxBtn) return;
    if (typeof maximized === 'boolean') {
      winMaxBtn.textContent = maximized ? '\u2750' : '\u25A2';
      winMaxBtn.title = maximized ? 'Restore Down' : 'Maximize';
      return;
    }
    if (api && api.windowIsMaximized) {
      api.windowIsMaximized().then(m => {
        winMaxBtn.textContent = m ? '\u2750' : '\u25A2';
        winMaxBtn.title = m ? 'Restore Down' : 'Maximize';
      }).catch(() => { /* ignore */ });
    }
  }
  async function toggleMaximize() {
    if (!api || !api.windowMaximizeToggle) return;
    const m = await api.windowMaximizeToggle();
    updateMaxIcon(!!m);
  }
  document.getElementById('win-min-btn').addEventListener('click', () => { if (api && api.windowMinimize) api.windowMinimize(); });
  if (winMaxBtn) winMaxBtn.addEventListener('click', toggleMaximize);
  document.getElementById('win-close-btn').addEventListener('click', () => { saveSessionNow().then(() => window.close()); });
  // Double-click the empty tab-bar space toggles maximize (native
  // title-bar behaviour); tabs and buttons are excluded.
  document.getElementById('tabbar').addEventListener('dblclick', (e) => {
    if (e.target.closest('.tab') || e.target.closest('button')) return;
    toggleMaximize();
  });

  // ---------- Editor events ----------
  editor.addEventListener('input', () => {
    mdRecordTyping();
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
  });
  editor.addEventListener('keyup', updateStatus);
  editor.addEventListener('click', updateStatus);
  editor.addEventListener('select', updateStatus);
  // Formatted view: typing edits the rendered document; sync serializes
  // it back to Markdown so the file text always stays Markdown.
  formattedView.addEventListener('input', () => {
    syncEditorToTab();
    renderTabs();
    updateStatus();
    scheduleSessionSave();
  });
  formattedView.addEventListener('keyup', updateStatus);
  formattedView.addEventListener('click', (e) => {
    // Ctrl+click a link opens it in the default browser (official
    // Notepad behaviour). Plain clicks just place the caret.
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href && api && api.openExternal) api.openExternal(href);
      return;
    }
    updateStatus();
  });
  formattedView.addEventListener('select', updateStatus);
  // Paste plain text only in the formatted view, so pasted web content
  // cannot smuggle rich HTML into the Markdown document.
  formattedView.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData || { getData: () => '' }).getData('text/plain');
    if (text) {
      formattedView.focus();
      document.execCommand('insertText', false, text);
      syncEditorToTab();
      renderTabs();
      updateStatus();
      scheduleSessionSave();
    }
  });

  // ---------- Mouse-wheel zoom (Ctrl+wheel, both views) ----------
  // 1.3.0: there was no wheel handler at all, so Ctrl+wheel did nothing.
  // The listener must be non-passive: preventDefault() stops Chromium's
  // own page zoom and the scroll, so only the app zoom changes.
  function onWheelZoom(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(settings.zoom + (e.deltaY < 0 ? 10 : -10));
  }
  editor.addEventListener('wheel', onWheelZoom, { passive: false });
  formattedView.addEventListener('wheel', onWheelZoom, { passive: false });

  // ---------- Right-click context menu ----------
  // 1.3.0: there was no contextmenu handler anywhere, so right-clicking
  // the editor did nothing at all. The menu is a plain in-page element
  // (Electron's native menu was removed with Menu.setApplicationMenu(null)).
  const contextMenuEl = document.getElementById('context-menu');
  function selectionIsEmpty() {
    if (effectiveView() === 'formatted') {
      const sel = window.getSelection();
      return !sel || sel.isCollapsed;
    }
    return (editor.selectionStart || 0) === (editor.selectionEnd || 0);
  }
  function openContextMenu(x, y) {
    if (!contextMenuEl) return;
    closeContextMenu();
    const items = contextMenuEl.querySelectorAll('[data-ctx]');
    items.forEach(btn => {
      const action = btn.getAttribute('data-ctx');
      let disabled = false;
      if ((action === 'cut' || action === 'copy') && selectionIsEmpty()) disabled = true;
      if (action === 'undo' && effectiveView() !== 'formatted' && !mdUndoStack.length) disabled = true;
      if (action === 'redo' && effectiveView() !== 'formatted' && !mdRedoStack.length) disabled = true;
      btn.disabled = disabled;
    });
    contextMenuEl.classList.remove('hidden');
    const menuWidth = contextMenuEl.offsetWidth || 200;
    const menuHeight = contextMenuEl.offsetHeight || 200;
    contextMenuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - menuWidth - 4)) + 'px';
    contextMenuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - menuHeight - 4)) + 'px';
  }
  function closeContextMenu() {
    if (contextMenuEl) contextMenuEl.classList.add('hidden');
  }
  function showEditorContextMenu(e) {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  }
  editor.addEventListener('contextmenu', showEditorContextMenu);
  formattedView.addEventListener('contextmenu', showEditorContextMenu);
  if (contextMenuEl) {
    contextMenuEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ctx]');
      if (!btn || btn.disabled) return;
      const action = btn.getAttribute('data-ctx');
      closeContextMenu();
      if (action === 'select-all') { handleAction('select-all'); return; }
      editCommand(action);
    });
  }
  document.addEventListener('click', (e) => {
    if (contextMenuEl && !e.target.closest('#context-menu')) closeContextMenu();
  });
  document.addEventListener('scroll', closeContextMenu, true);

  // ---------- Find / Replace events ----------
  // 1.6: option toggles are shared between the Find and Replace bars.
  document.querySelectorAll('.find-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const opt = btn.getAttribute('data-opt');
      findOptions[opt] = !findOptions[opt];
      syncFindOptButtons();
      const q = !findBar.classList.contains('hidden') ? findInput.value : replaceFindInput.value;
      computeMatches(q);
      if (findMatches.length) selectMatch(0);
    });
  });
  syncFindOptButtons();
  findInput.addEventListener('input', () => { computeMatches(findInput.value); if (findMatches.length) selectMatch(0); });
  document.getElementById('find-next-btn').addEventListener('click', () => selectMatch(findIndex + 1));
  document.getElementById('find-prev-btn').addEventListener('click', () => selectMatch(findIndex - 1));
  document.getElementById('find-close-btn').addEventListener('click', () => findBar.classList.add('hidden'));
  replaceFindInput.addEventListener('input', () => computeMatches(replaceFindInput.value));
  document.getElementById('replace-one-btn').addEventListener('click', replaceOne);
  document.getElementById('replace-all-btn').addEventListener('click', replaceAll);
  document.getElementById('replace-close-btn').addEventListener('click', () => replaceBar.classList.add('hidden'));

  // ---------- Modal events ----------
  document.getElementById('gotoline-ok').addEventListener('click', () => {
    const n = parseInt(document.getElementById('gotoline-input').value, 10);
    document.getElementById('gotoline-overlay').classList.add('hidden');
    if (!isNaN(n)) goToLine(n);
  });
  document.getElementById('gotoline-cancel').addEventListener('click', () => {
    document.getElementById('gotoline-overlay').classList.add('hidden');
  });
  document.getElementById('link-ok').addEventListener('click', () => {
    const url = normalizeUrl(document.getElementById('link-url-input').value);
    document.getElementById('link-overlay').classList.add('hidden');
    if (url) applyLink(url);
    else activeEditorEl().focus();
  });
  document.getElementById('link-cancel').addEventListener('click', closeLinkModal);
  document.getElementById('link-url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('link-ok').click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeLinkModal(); }
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    document.getElementById('settings-overlay').classList.add('hidden');
  });
  document.getElementById('about-close').addEventListener('click', () => {
    document.getElementById('about-overlay').classList.add('hidden');
  });

  document.getElementById('setting-theme').addEventListener('change', (e) => { settings.theme = e.target.value; applySettings(); persistSettings(); });
  document.getElementById('setting-font').addEventListener('change', (e) => { settings.fontFamily = e.target.value; applySettings(); persistSettings(); });
  document.getElementById('setting-font-weight').addEventListener('change', (e) => { settings.fontWeight = e.target.value; applySettings(); persistSettings(); });
  document.getElementById('setting-font-size').addEventListener('change', (e) => { settings.fontSize = Math.max(8, Math.min(48, parseInt(e.target.value, 10) || 15)); applySettings(); persistSettings(); });
  document.getElementById('setting-wrap').addEventListener('change', (e) => { settings.wordWrap = e.target.checked; applySettings(); persistSettings(); });
  document.getElementById('setting-autosave').addEventListener('change', (e) => { settings.autosave = e.target.checked; persistSettings(); });
  document.getElementById('setting-spellcheck').addEventListener('change', (e) => { settings.spellcheck = e.target.checked; applySettings(); persistSettings(); });
  document.getElementById('setting-formatting').addEventListener('change', (e) => {
    settings.formatting = e.target.checked;
    if (!settings.formatting) {
      // Plain text only: sync the raw text first so nothing is lost.
      // effectiveView() forces the Markdown view while formatting is
      // off; viewMode itself is left alone, so turning formatting back
      // on restores the previous view.
      syncEditorToTab();
      const tab = activeTab();
      if (tab) editor.value = tab.content;
    }
    applySettings();
    persistSettings();
  });
  const defaultAppsBtn = document.getElementById('setting-default-apps');
  if (defaultAppsBtn) {
    defaultAppsBtn.addEventListener('click', () => {
      if (api && api.openDefaultAppsSettings) api.openDefaultAppsSettings();
    });
  }

  // ---------- Theme toggle button (1.4.0, next to the emoji button) ----------
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) themeToggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleTheme(); });

  // ---------- Emoji picker events ----------
  document.getElementById('emoji-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPicker(); });
  document.getElementById('emoji-close-btn').addEventListener('click', closeEmojiPicker);
  emojiSearchEl.addEventListener('input', renderEmojiGrid);
  document.addEventListener('click', (e) => {
    if (emojiOpen && !e.target.closest('#emoji-picker') && !e.target.closest('#emoji-btn')) closeEmojiPicker();
  });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (emojiOpen) { closeEmojiPicker(); return; }
      if (!document.getElementById('link-overlay').classList.contains('hidden')) { closeLinkModal(); return; }
      findBar.classList.add('hidden');
      replaceBar.classList.add('hidden');
      closeMenus();
      closeContextMenu();
      return;
    }
    // Tab inserts a tab character in the editor instead of moving focus
    // out of it. Only when the caret is in an editor, never in a text
    // input, a modal field or a menu.
    if (e.key === 'Tab' && (e.target === editor || formattedView.contains(e.target))) {
      e.preventDefault();
      if (effectiveView() === 'formatted') {
        formattedView.focus();
        document.execCommand('insertText', false, '\t');
        afterEdit();
      } else {
        insertTextAtCaret('\t');
      }
      return;
    }
    // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) in the Markdown view use the
    // text history stack. In the Formatted view the native undo stack
    // owns it, so those keys are left alone there.
    if (ctrl && effectiveView() !== 'formatted' && (e.target === editor || e.target === document || e.target === document.body)) {
      if (!e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); mdUndo(); return; }
      if ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) { e.preventDefault(); mdRedo(); return; }
    }
    // Formatting shortcuts only when the caret is in an editor, never
    // while typing in a search box, a modal input, or a dropdown.
    // (Toolbar buttons keep focus after a click, so the target may be
    // a button or the document itself - only inputs, selects, modal
    // fields and pickers are excluded.)
    const inEditor = targetIsFormattable(e.target);
    if (ctrl && !e.shiftKey && inEditor && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); formatBold(); return; }
    if (ctrl && !e.shiftKey && inEditor && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); formatItalic(); return; }
    if (ctrl && !e.shiftKey && inEditor && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openLinkModal(); return; }
    if (ctrl && !e.shiftKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); newTab(); activeEditorEl().focus(); }
    else if (ctrl && !e.shiftKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); const t = activeTab(); if (t) closeTab(t.id); }
    else if (ctrl && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); const t = activeTab(); if (t) saveTab(t, false); }
    else if (ctrl && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); const t = activeTab(); if (t) saveTab(t, true); }
    else if (ctrl && !e.shiftKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFiles(); }
    else if (ctrl && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); handleAction('print'); }
    else if (ctrl && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); showFind(); }
    else if (ctrl && !e.shiftKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); showReplace(); }
    else if (ctrl && !e.shiftKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); handleAction('go-to-line'); }
    else if (ctrl && e.key === '.') { e.preventDefault(); toggleEmojiPicker(); }
    else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(settings.zoom + 10); }
    else if (ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); setZoom(settings.zoom - 10); }
    else if (ctrl && e.key === '0') { e.preventDefault(); setZoom(100); }
    else if (e.key === 'F3') { e.preventDefault(); if (e.shiftKey) { showFind(); selectMatch(findIndex - 1); } else { showFind(); selectMatch(findIndex + 1); } }
    else if (e.key === 'F5') { e.preventDefault(); insertTimeDate(); }
  });

  // ---------- Drag and drop ----------
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    const files = (e.dataTransfer && e.dataTransfer.files) ? Array.from(e.dataTransfer.files) : [];
    // No files: let the editor insert the dropped text natively. The
    // old handler prevented the drop unconditionally, so dragging text
    // into the editor silently did nothing.
    if (!files.length) return;
    e.preventDefault();
    if (!api) return;
    for (const file of files) {
      const p = api.getPathForFile(file);
      if (p) await openPath(p);
    }
  });

  // ---------- App events ----------
  if (api && api.onOpenFileArg) {
    api.onOpenFileArg((data) => {
      if (data && data.path) {
        if (initialized) openPath(data.path);
        else pendingOpenPaths.push(data.path);
      }
    });
  }
  window.addEventListener('beforeunload', () => { saveSessionNow(); });
  setInterval(() => { if (settings.autosave) saveSessionNow(); }, 5000);

  // ---------- Init ----------
  if (api) {
    loadPersisted();
  } else {
    applySettings();
    newTab();
  }
})();
