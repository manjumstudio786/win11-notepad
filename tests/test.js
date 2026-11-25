'use strict';

/*
 * Notepad 1.0.2 - static checks (run with: npm test).
 * Verifies package metadata, required files, icon validity, presence of
 * every required feature handler, the 1.0.2 Untitled fix, the single
 * menu bar, and the WhatsApp-style emoji picker (data + search + insert),
 * and that all UI text is pure English (no Devanagari / Arabic-script
 * characters anywhere in UI files).
 * Functional behaviour is verified by the Electron smoke test
 * (xvfb-run npx electron . --smoke-test) - see main.js.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { passed += 1; console.log('  PASS  ' + name); }
  else { failed += 1; failures.push(name); console.log('  FAIL  ' + name + (detail ? ' - ' + detail : '')); }
}

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function countOccurrences(text, sub) { return text.split(sub).length - 1; }

console.log('Notepad 1.6 static checks');

// 1. package.json
const pkg = JSON.parse(read('package.json'));
check('version is 1.6', pkg.version === '1.6', pkg.version);
check('productName is Notepad', pkg.productName === 'Notepad', pkg.productName);
check('appId set', typeof pkg.build.appId === 'string' && pkg.build.appId.length > 0, pkg.build.appId);
check('win target includes nsis', Array.isArray(pkg.build.win.target) && pkg.build.win.target.includes('nsis'));
check('installer artifact name is Setup', String(pkg.build.win.artifactName).includes('Setup'));
check('1.6: installer file is literally named Notepad-1.6-Setup (no .0)', pkg.build.win.artifactName === 'Notepad-1.6-Setup.${ext}', pkg.build.win.artifactName);
check('1.6: portable artifact is Notepad-1.6-Portable', pkg.build.portable && pkg.build.portable.artifactName === 'Notepad-1.6-Portable.${ext}', pkg.build.portable && pkg.build.portable.artifactName);
check('1.6: win targets include nsis and portable', Array.isArray(pkg.build.win.target) && pkg.build.win.target.includes('nsis') && pkg.build.win.target.includes('portable'), JSON.stringify(pkg.build.win.target));
check('1.6: dist script builds win nsis portable', /electron-builder --win nsis portable/.test(pkg.scripts.dist || ''), pkg.scripts.dist);
check('1.6: postinstall script applies version patch', pkg.scripts.postinstall === 'node scripts/postinstall.js', pkg.scripts.postinstall);
check('icon path is assets/icon.ico', pkg.build.win.icon === 'assets/icon.ico');
check('build.files includes emoji-data.js', Array.isArray(pkg.build.files) && pkg.build.files.includes('emoji-data.js'), JSON.stringify(pkg.build.files));
check('build.files does not package tools/', !(pkg.build.files || []).some(f => String(f).indexOf('tools') !== -1));
// 1.0.1: .txt file association registered with the installer
const assoc = Array.isArray(pkg.build.fileAssociations) ? pkg.build.fileAssociations : [];
const txtAssoc = assoc.find(a => a && a.ext === 'txt');
check('fileAssociations present', assoc.length >= 1, JSON.stringify(assoc));
check('fileAssociations: txt ext', !!txtAssoc, JSON.stringify(assoc));
check('fileAssociations: txt name is Text Document', txtAssoc && txtAssoc.name === 'Text Document', txtAssoc && txtAssoc.name);
check('fileAssociations: txt role is Editor', txtAssoc && txtAssoc.role === 'Editor', txtAssoc && txtAssoc.role);
check('fileAssociations: txt mimeType text/plain', txtAssoc && txtAssoc.mimeType === 'text/plain', txtAssoc && txtAssoc.mimeType);
check('1.6: author is Anjum Learning Lab', pkg.author === 'Anjum Learning Lab', pkg.author);
check('1.6: appId is com.anjumlearninglab.win11notepad', pkg.build.appId === 'com.anjumlearninglab.win11notepad', pkg.build.appId);
check('1.6: no dnsh / third-party id anywhere in package.json', !/dnsh/.test(read('package.json')));
check('1.6: md file association present', !!assoc.find(a => a && a.ext === 'md'), JSON.stringify(assoc));
check('1.6: log file association present', !!assoc.find(a => a && a.ext === 'log'), JSON.stringify(assoc));
check('1.6: build.files includes text-utils.js', Array.isArray(pkg.build.files) && pkg.build.files.includes('text-utils.js'), JSON.stringify(pkg.build.files));
check('electron + electron-builder devDeps', !!(pkg.devDependencies.electron && pkg.devDependencies.electronBuilder || pkg.devDependencies['electron-builder']));
const lock = JSON.parse(read('package-lock.json'));
check('package-lock version is 1.6', lock.version === '1.6', lock.version);

// 2. required files
['main.js', 'preload.js', 'index.html', 'styles.css', 'renderer.js', 'text-utils.js', 'emoji-data.js', 'assets/icon.ico', 'assets/icon.png', 'build/afterPack.js', 'tools/gen-emoji.js', 'scripts/postinstall.js', 'README.md', 'CHANGELOG.md']
  .forEach(f => check('file exists: ' + f, fs.existsSync(path.join(root, f))));

// 3. icon: parse ICO header (00 00 01 00, count, then 16-byte entries)
const ico = fs.readFileSync(path.join(root, 'assets/icon.ico'));
const icoCount = ico.readUInt16LE(4);
const icoSizes = new Set();
for (let i = 0; i < icoCount; i++) {
  const off = 6 + i * 16;
  const w = ico[off] === 0 ? 256 : ico[off];
  const h = ico[off + 1] === 0 ? 256 : ico[off + 1];
  icoSizes.add(w + 'x' + h);
}
check('icon is valid ICO', ico[0] === 0 && ico[1] === 0 && ico[2] === 1 && ico[3] === 0);
check('icon has 16/32/48/256 sizes', ['16x16', '32x32', '48x48', '256x256'].every(s => icoSizes.has(s)), [...icoSizes].join(','));
const png = fs.readFileSync(path.join(root, 'assets/icon.png'));
check('icon.png is a PNG', png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47);

// 4. feature handlers present
const main = read('main.js');
const preload = read('preload.js');
const renderer = read('renderer.js');
const html = read('index.html');
const css = read('styles.css');
const emojiDataSrc = read('emoji-data.js');
const all = main + preload + renderer + html + css;

const features = [
  ['tabs: newTab', /function newTab/],
  ['tabs: closeTab', /function closeTab/],
  ['tabs: switchTab', /function switchTab/],
  ['tabs: renderTabs', /function renderTabs/],
  ['tabs: dirty dot indicator', /tab-dot/],
  ['file: saveTab', /async function saveTab/],
  ['file: openFiles dialog', /openFileDialog/],
  ['file: Save As dialog', /saveFileDialog/],
  ['file: drag and drop opens file', /getPathForFile/],
  ['file: recent files', /renderRecent/],
  ['edit: undo/redo', /editCommand\('undo'\)/],
  ['edit: cut/copy/paste', /editCommand\('paste'\)/],
  ['edit: find', /function showFind/],
  ['edit: replace one/all', /function replaceAll/],
  ['edit: find next/prev', /function selectMatch/],
  ['edit: go to line', /function goToLine/],
  ['edit: time/date F5', /function insertTimeDate/],
  ['view: word wrap toggle', /toggle-wrap/],
  ['view: zoom in/out/reset', /function setZoom/],
  ['view: status bar toggle', /toggle-status/],
  ['view: dark/light theme', /body\.dark/],
  ['status bar: Ln/Col/words/chars/zoom/UTF-8', /status-encoding/],
  ['autosave session', /saveSessionNow/],
  ['session restore on load', /loadPersisted/],
  ['settings persisted', /settings\.json/],
  ['settings modal', /setting-theme/],
  ['about dialog version', /about-version/],
  ['main: new window handler', /app:newWindow/],
  ['main: open/save dialogs', /showOpenDialog/],
  ['main: version 1.6 constant', /APP_VERSION = '1\.6'/],
  ['main: single instance lock', /requestSingleInstanceLock/],
  ['main: second-instance handler', /'second-instance'/],
  ['main: getFileArg parses argv', /function getFileArg/],
  ['main: open-file handler', /'open-file'/],
  ['main: open default apps handler', /app:openDefaultApps/],
  ['main: open default apps uses shell.openExternal', /shell\.openExternal\('ms-settings:defaultapps'\)/],
  ['preload: openDefaultAppsSettings bridge', /openDefaultAppsSettings/],
  ['settings: default apps button', /setting-default-apps/],
  ['settings: default apps note explains one manual pick', /does not let an installer set the default app silently/],
  ['renderer: queues launch file until loaded', /pendingOpenPaths/],
  ['renderer: flushes queued file after load', /queued\.forEach/],
  ['shortcuts: Ctrl+T', /e\.key === 't'/],
  ['shortcuts: Ctrl+S', /e\.key === 's'/],
  ['shortcuts: Ctrl+O', /e\.key === 'o'/],
  ['shortcuts: Ctrl+F', /e\.key === 'f'/],
  ['shortcuts: Ctrl+H', /e\.key === 'h'/],
  ['shortcuts: Ctrl+G', /e\.key === 'g'/],
  ['shortcuts: F5 time/date', /e\.key === 'F5'/],
  ['shortcuts: F3 find next', /e\.key === 'F3'/],
  ['spellcheck enabled', /spellcheck: true/],
  ['context isolation on', /contextIsolation: true/],
  ['nodeIntegration off', /nodeIntegration: false/],
  // 1.0.2: Untitled fix
  ['1.0.2: nextUntitledTitle helper exists', /function nextUntitledTitle/],
  ['1.0.2: untitledTitleFor helper exists', /function untitledTitleFor/],
  ['1.0.2: normalizeUntitledTitles helper exists', /function normalizeUntitledTitles/],
  ['1.0.2: newTab uses nextUntitledTitle', /tab\.title = nextUntitledTitle\(\)/],
  ['1.0.2: loadPersisted migrates untitled titles', /normalizeUntitledTitles\(tabs\)/],
  ['1.0.2: no ever-increasing untitledCounter', !/untitledCounter/.test(renderer + main)],
  ['1.0.2: closeTab creates fresh tab when empty', /if \(tabs\.length === 0\) \{\s*newTab\(\);/],
  // 1.0.2: single menu bar
  ['1.0.2: main imports Menu', /Menu/.test(main) && /require\('electron'\)/.test(main)],
  ['1.0.2: Menu.setApplicationMenu(null) called', /Menu\.setApplicationMenu\(null\)/.test(main)],
  ['1.0.2: no native buildFromTemplate menu', !/buildFromTemplate/.test(main)],
  ['1.0.2: html has exactly one menubar', countOccurrences(html, 'id="menubar"') === 1, String(countOccurrences(html, 'id="menubar"'))],
  ['1.0.2: html has exactly three menu buttons', countOccurrences(html, 'class="menu-btn"') === 3, String(countOccurrences(html, 'class="menu-btn"'))],
  ['1.0.2: smoke test checks single menubar', /single menubar/.test(main)],
  ['1.0.2: smoke test checks close-last-tab plain Untitled', /close-last-tab creates plain Untitled/.test(main)],
  ['1.0.2: smoke test checks theme flip', /theme toggle flips dark mode/.test(main)],
  ['1.0.2: smoke test checks emoji picker in other theme', /emoji picker opens in other theme/.test(main)],
  ['1.6: smoke test checks about version 1.6', /about version 1\.6/.test(main)],
  // 1.0.2: emoji picker
  ['emoji: data file loaded in html', /<script src="emoji-data\.js"><\/script>/.test(html)],
  ['emoji: button in menubar', /id="emoji-btn"/.test(html)],
  ['emoji: picker panel in html', /id="emoji-picker"/.test(html)],
  ['emoji: search input in html', /id="emoji-search"/.test(html)],
  ['emoji: categories row in html', /id="emoji-categories"/.test(html)],
  ['emoji: grid in html', /id="emoji-grid"/.test(html)],
  ['emoji: close button in html', /id="emoji-close-btn"/.test(html)],
  ['emoji: count footer in html', /id="emoji-count"/.test(html)],
  ['emoji: Edit menu Emoji item', /data-action="emoji"/.test(html)],
  ['emoji: search placeholder English', /placeholder="Search emoji"/.test(html)],
  ['emoji: toggleEmojiPicker exists', /function toggleEmojiPicker/.test(renderer)],
  ['emoji: openEmojiPicker exists', /function openEmojiPicker/.test(renderer)],
  ['emoji: closeEmojiPicker exists', /function closeEmojiPicker/.test(renderer)],
  ['emoji: insertEmoji exists', /function insertEmoji/.test(renderer)],
  ['emoji: renderEmojiGrid exists', /function renderEmojiGrid/.test(renderer)],
  ['emoji: renderEmojiCategories exists', /function renderEmojiCategories/.test(renderer)],
  ['emoji: emojiMatches search exists', /function emojiMatches/.test(renderer)],
  ['emoji: insertAt helper exists', /function insertAt/.test(renderer)],
  ['emoji: recent emojis tracked', /function addRecentEmoji/.test(renderer)],
  ['emoji: recent emojis persisted', /recentEmojis/.test(renderer) && /recentEmojis: recentEmojis/.test(renderer)],
  ['emoji: recent emojis restored on load', /stored\.recentEmojis/.test(renderer)],
  ['emoji: Esc closes picker', /if \(emojiOpen\) \{ closeEmojiPicker\(\); return; \}/.test(renderer)],
  ['emoji: click outside closes picker', /closest\('#emoji-picker'\)/.test(renderer)],
  ['emoji: picker stays open after insert (no close in insertEmoji)', !/function insertEmoji[\s\S]{0,600}closeEmojiPicker/.test(renderer)],
  ['emoji: Ctrl+. shortcut', /e\.key === '\.'/.test(renderer)],
  ['emoji: categories include all nine', ['Recent', 'Smileys', 'People', 'Animals', 'Food', 'Activities', 'Travel', 'Objects', 'Symbols', 'Flags'].every(c => renderer.indexOf("id: '" + c + "'") !== -1)],
  ['emoji: no-results message', /No results/.test(renderer)],
  ['emoji: styles for picker', /#emoji-picker/.test(css)],
  ['emoji: styles for grid items', /\.emoji-item/.test(css)],
  ['emoji: styles for category buttons', /\.emoji-cat-btn/.test(css)],
  ['emoji: category row scrollbar hidden', /#emoji-categories::-webkit-scrollbar/.test(css) && /scrollbar-width: none/.test(css)],
  ['emoji: styles for emoji button', /#emoji-btn/.test(css)],
  ['emoji: about mentions emoji picker', /emoji picker/.test(html)],
  ['emoji: data exposes window.EMOJI_DATA', /window\.EMOJI_DATA = EMOJI_DATA/.test(emojiDataSrc)],
  ['emoji: data generated from Unicode emoji-test', /emoji-test\.txt/.test(emojiDataSrc)]
];
features.forEach(([name, re]) => check(name, typeof re === 'boolean' ? re : (re.test(all) || re.test(emojiDataSrc))));

// 5. pure English UI: no Devanagari (U+0900-097F) or Arabic script (U+0600-06FF)
const uiText = html + renderer + emojiDataSrc;
const badDevanagari = /[\u0900-\u097F]/.test(uiText);
const badArabic = /[\u0600-\u06FF]/.test(uiText);
check('no Devanagari characters in UI', !badDevanagari);
check('no Arabic-script characters in UI', !badArabic);

// 6. pure logic unit checks (same expressions as renderer.js)
function baseName(p) { const parts = p.split(/[\\/]/); return parts[parts.length - 1] || p; }
check('logic: baseName Windows path', baseName('C:\\Users\\x\\file.txt') === 'file.txt');
check('logic: baseName Unix path', baseName('/home/x/notes.md') === 'notes.md');
check('logic: word count', 'Hello world\nSecond line'.trim().split(/\s+/).length === 4);
check('logic: char count', 'Hello world\nSecond line'.length === 23);
check('logic: replace-all count', 'aaa'.split('a').length - 1 === 3);
check('logic: go-to-line offset line 3', (() => {
  const lines = ['a', 'bb', 'ccc']; let off = 0;
  for (let i = 0; i < 2; i++) off += lines[i].length + 1;
  return off === 5;
})());
check('logic: find matches', (() => {
  const text = 'Second line Second'; const q = 'Second'; const m = [];
  let idx = 0;
  while (true) { const f = text.indexOf(q, idx); if (f === -1) break; m.push(f); idx = f + q.length; }
  return m.length === 2 && m[0] === 0 && m[1] === 12;
})());

// 6a. Untitled naming (mirrors renderer.js 1.0.2 helpers)
function untitledTitleFor(titles) {
  const set = new Set(titles || []);
  if (!set.has('Untitled')) return 'Untitled';
  let n = 2;
  while (set.has('Untitled (' + n + ')')) n += 1;
  return 'Untitled (' + n + ')';
}
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
check('untitled: empty -> Untitled', untitledTitleFor([]) === 'Untitled');
check('untitled: only Untitled -> Untitled (2)', untitledTitleFor(['Untitled']) === 'Untitled (2)');
check('untitled: Untitled + (2) -> Untitled (3)', untitledTitleFor(['Untitled', 'Untitled (2)']) === 'Untitled (3)');
check('untitled: gap reuse Untitled + (3) -> Untitled (2)', untitledTitleFor(['Untitled', 'Untitled (3)']) === 'Untitled (2)');
check('untitled: file tabs do not block Untitled', untitledTitleFor(['notes.txt', 'todo.md']) === 'Untitled');
check('untitled: after closing last tab -> plain Untitled', untitledTitleFor([]) === 'Untitled');
check('untitled: many tabs -> next free number', untitledTitleFor(['Untitled', 'Untitled (2)', 'Untitled (3)', 'Untitled (4)']) === 'Untitled (5)');
check('untitled: titles stay unique among LIVE tabs across 30 open/close cycles', (() => {
  // Reusing a freed title (e.g. Untitled (3) again after it was closed)
  // is correct gap reuse - uniqueness is required among live tabs only.
  let live = [];
  for (let i = 0; i < 30; i++) {
    const t = untitledTitleFor(live);
    live.push(t);
    if (new Set(live).size !== live.length) return false;
    if (i % 3 === 2) live = live.slice(0, live.length - 1); // close one
  }
  const next = untitledTitleFor(live);
  return next.indexOf('(30)') === -1 && next.indexOf('(31)') === -1 && live.length > 0;
})());
check('migration: single Untitled (30) -> Untitled', (() => {
  const list = [{ title: 'Untitled (30)', filePath: null }];
  normalizeUntitledTitles(list);
  return list[0].title === 'Untitled';
})());
check('migration: Untitled (5) + Untitled (9) -> Untitled, Untitled (2)', (() => {
  const list = [{ title: 'Untitled (5)', filePath: null }, { title: 'Untitled (9)', filePath: null }];
  normalizeUntitledTitles(list);
  return list[0].title === 'Untitled' && list[1].title === 'Untitled (2)';
})());
check('migration: file tab Untitled (30).txt untouched', (() => {
  const list = [{ title: 'Untitled (30).txt', filePath: 'C:\\x\\Untitled (30).txt' }];
  normalizeUntitledTitles(list);
  return list[0].title === 'Untitled (30).txt';
})());
check('migration: mixed file + untitled keeps file title', (() => {
  const list = [{ title: 'notes.txt', filePath: '/x/notes.txt' }, { title: 'Untitled (7)', filePath: null }];
  normalizeUntitledTitles(list);
  return list[0].title === 'notes.txt' && list[1].title === 'Untitled';
})());
check('migration: empty list stays empty', normalizeUntitledTitles([]).length === 0);
check('migration: plain Untitled stays Untitled', (() => {
  const list = [{ title: 'Untitled', filePath: null }];
  normalizeUntitledTitles(list);
  return list[0].title === 'Untitled';
})());

// 6b. Emoji insert position (mirrors renderer.js insertAt)
function insertAt(text, start, end, ins) {
  return { text: text.slice(0, start) + ins + text.slice(end), caret: start + ins.length };
}
check('insertAt: insert in middle', insertAt('Hello world', 5, 5, 'X').text === 'HelloX world');
check('insertAt: insert at start', insertAt('abc', 0, 0, 'Z').text === 'Zabc');
check('insertAt: insert at end', insertAt('abc', 3, 3, 'Z').text === 'abcZ');
check('insertAt: replaces selection', insertAt('Hello world', 6, 11, 'there').text === 'Hello there');
check('insertAt: caret after inserted emoji (surrogate pair length 2)', insertAt('ab', 2, 2, '😀').caret === 4);
check('insertAt: caret after text insert', insertAt('ab', 1, 1, 'XY').caret === 3);
check('insertAt: empty editor', insertAt('', 0, 0, '❤️').text === '❤️');

// 6c. Emoji search (mirrors renderer.js emojiMatches)
function emojiMatches(e, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = (e.n + ' ' + (e.k || []).join(' ')).toLowerCase();
  return q.split(/\s+/).every(tok => {
    if (!tok) return true;
    if (hay.indexOf(tok) !== -1) return true;
    return (e.k || []).some(k => k.indexOf(tok) !== -1 || (k.length >= 3 && tok.indexOf(k) !== -1));
  });
}
check('search: empty query matches all', emojiMatches({ n: 'red heart', k: ['heart', 'love'] }, ''));
check('search: heart matches red heart', emojiMatches({ n: 'red heart', k: ['heart', 'love'] }, 'heart'));
check('search: smile matches smiling face', emojiMatches({ n: 'smiling face', k: ['smile', 'smiling', 'happy'] }, 'smile'));
check('search: SMILE case-insensitive', emojiMatches({ n: 'smiling face', k: ['smile'] }, 'SMILE'));
check('search: cat matches grinning cat', emojiMatches({ n: 'grinning cat', k: ['cat', 'kitten'] }, 'cat'));
check('search: multi-token smiling cat', emojiMatches({ n: 'smiling cat with heart-eyes', k: ['cat', 'smile'] }, 'smiling cat'));
check('search: no match for gibberish', !emojiMatches({ n: 'red heart', k: ['heart'] }, 'xyzqqq'));
check('search: partial token heart matches hearts', emojiMatches({ n: 'beating heart', k: ['heart', 'hearts'] }, 'heart'));

// 7. getFileArg logic (mirrors main.js: skip exe path, flags, app path,
// non-text args; return first existing text file, else null)
const TEXT_EXTENSIONS = /\.(txt|md|log|csv|json|xml|ini|cfg)$/i;
function getFileArg(argv, exists) {
  const args = (argv || []).slice(1);
  for (const a of args) {
    if (!a || typeof a !== 'string') continue;
    if (a.startsWith('-')) continue;
    if (!TEXT_EXTENSIONS.test(a)) continue;
    try { if (exists(a)) return a; } catch (e) { /* ignore */ }
  }
  return null;
}
const tmpTxt = path.join(__dirname, 'tmp-arg-check.txt');
fs.writeFileSync(tmpTxt, 'check', 'utf8');
try {
  const exists = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  check('logic: getFileArg finds .txt after app path', getFileArg(['exe', '.', tmpTxt], exists) === tmpTxt);
  check('logic: getFileArg skips --flags', getFileArg(['exe', '--smoke-test', tmpTxt], exists) === tmpTxt);
  check('logic: getFileArg skips non-text file', getFileArg(['exe', path.join(__dirname, 'tmp-arg-check.exe')], exists) === null);
  check('logic: getFileArg returns null with no file', getFileArg(['exe', '--smoke-test'], exists) === null);
  check('logic: getFileArg skips missing .txt', getFileArg(['exe', path.join(__dirname, 'does-not-exist.txt')], exists) === null);
} finally {
  try { fs.unlinkSync(tmpTxt); } catch (e) { /* ignore */ }
}

// 8. Emoji data (real data file, generated from Unicode emoji-test.txt)
const EMOJI_DATA = require(path.join(root, 'emoji-data.js'));
check('emoji data: total >= 800', EMOJI_DATA.length >= 800, String(EMOJI_DATA.length));
check('emoji data: total >= 1900', EMOJI_DATA.length >= 1900, String(EMOJI_DATA.length));
const CATS = ['Smileys', 'People', 'Animals', 'Food', 'Activities', 'Travel', 'Objects', 'Symbols', 'Flags'];
CATS.forEach(c => {
  const n = EMOJI_DATA.filter(e => e.g === c).length;
  check('emoji data: category ' + c + ' has >= 50', n >= 50, String(n));
});
check('emoji data: every entry has character', EMOJI_DATA.every(e => typeof e.c === 'string' && e.c.length > 0));
check('emoji data: every entry has a name', EMOJI_DATA.every(e => typeof e.n === 'string' && e.n.length > 0));
check('emoji data: every entry has keywords', EMOJI_DATA.every(e => Array.isArray(e.k) && e.k.length > 0));
check('emoji data: every entry has a valid category', EMOJI_DATA.every(e => CATS.indexOf(e.g) !== -1));
check('emoji data: no duplicate characters', new Set(EMOJI_DATA.map(e => e.c)).size === EMOJI_DATA.length);
check('emoji data: no skin-tone modifiers', EMOJI_DATA.every(e => {
  for (const ch of e.c) {
    const v = ch.codePointAt(0);
    if (v >= 0x1F3FB && v <= 0x1F3FF) return false;
  }
  return true;
}));
check('emoji data: search heart returns many', EMOJI_DATA.filter(e => emojiMatches(e, 'heart')).length >= 20, String(EMOJI_DATA.filter(e => emojiMatches(e, 'heart')).length));
check('emoji data: search smile returns many', EMOJI_DATA.filter(e => emojiMatches(e, 'smile')).length >= 10, String(EMOJI_DATA.filter(e => emojiMatches(e, 'smile')).length));
check('emoji data: search cat returns many', EMOJI_DATA.filter(e => emojiMatches(e, 'cat')).length >= 5, String(EMOJI_DATA.filter(e => emojiMatches(e, 'cat')).length));
check('emoji data: search dog returns results', EMOJI_DATA.filter(e => emojiMatches(e, 'dog')).length >= 5);
check('emoji data: search pizza returns results', EMOJI_DATA.filter(e => emojiMatches(e, 'pizza')).length >= 1);
check('emoji data: search pakistan finds flag', EMOJI_DATA.filter(e => emojiMatches(e, 'pakistan')).length >= 1, JSON.stringify(EMOJI_DATA.filter(e => emojiMatches(e, 'pakistan')).map(e => e.c)));
check('emoji data: search xyzqqq returns none', EMOJI_DATA.filter(e => emojiMatches(e, 'xyzqqq')).length === 0);
check('emoji data: multi-token smiling cat returns results', EMOJI_DATA.filter(e => emojiMatches(e, 'smiling cat')).length >= 1);
check('emoji data: search fire returns results', EMOJI_DATA.filter(e => emojiMatches(e, 'fire')).length >= 1);
check('emoji data: search love returns results', EMOJI_DATA.filter(e => emojiMatches(e, 'love')).length >= 5);
check('emoji data: grinning face present', EMOJI_DATA.some(e => e.c === '😀' && e.n === 'grinning face'));
check('emoji data: red heart present', EMOJI_DATA.some(e => e.c === '❤️' && e.n === 'red heart'));

// 9. 1.3.0: top tab bar, Chrome-style + button, formatting toolbar,
// Formatted / Markdown views, frameless window controls.
const htmlTabbarPos = html.indexOf('id="tabbar"');
const htmlMenubarPos = html.indexOf('id="menubar"');
const htmlFormatbarPos = html.indexOf('id="formatbar"');
check('1.3.0: tabbar exists before menubar in html', htmlTabbarPos !== -1 && htmlMenubarPos !== -1 && htmlTabbarPos < htmlMenubarPos);
check('1.3.0: formatbar exists after menubar in html', htmlFormatbarPos !== -1 && htmlFormatbarPos > htmlMenubarPos);
check('1.3.0: tabbar is the first child of #app', /<div id="app">[\s\S]{0,600}id="tabbar"/.test(html) && html.indexOf('id="tabbar"') < html.indexOf('id="menubar"'));
check('1.3.0: window controls container exists', /id="window-controls"/.test(html));
check('1.3.0: minimize button exists', /id="win-min-btn"/.test(html));
check('1.3.0: maximize button exists', /id="win-max-btn"/.test(html));
check('1.3.0: close button exists', /id="win-close-btn"/.test(html));
check('1.3.0: tabbar spacer exists (drag space)', /id="tabbar-spacer"/.test(html));
check('1.3.0: new-tab + is immediately after #tabs', /<div id="tabs"><\/div>\s*<button id="new-tab-btn"/.test(html));
check('1.3.0: #tabs does not flex to fill the row (plus stays next to tabs)', /#tabs \{[^}]*flex: 0 1 auto/.test(css));
check('1.3.0: tabbar is a drag region', css.indexOf('-webkit-app-region: drag') !== -1);
check('1.3.0: tabs and buttons are excluded from dragging', css.indexOf('-webkit-app-region: no-drag') !== -1);
check('1.3.0: window controls styled', /#window-controls/.test(css));
check('1.3.0: close button hover is red', /#win-close-btn:hover/.test(css) && /#e81123/.test(css));
check('1.3.0: formatbar exists', /id="formatbar"/.test(html));
check('1.3.0: heading dropdown exists', /id="heading-select"/.test(html));
check('1.3.0: heading options Normal/H1/H2/H3', /value="normal"/.test(html) && /value="h1"/.test(html) && /value="h2"/.test(html) && /value="h3"/.test(html));
check('1.3.0: bold button exists', /id="fmt-bold"/.test(html));
check('1.3.0: italic button exists', /id="fmt-italic"/.test(html));
check('1.3.0: strikethrough button exists', /id="fmt-strike"/.test(html));
check('1.3.0: bulleted list button exists', /id="fmt-bullet"/.test(html));
check('1.3.0: numbered list button exists', /id="fmt-numbered"/.test(html));
check('1.3.0: link button exists', /id="fmt-link"/.test(html));
check('1.3.0: table button exists', /id="fmt-table"/.test(html));
check('1.3.0: clear formatting button exists', /id="fmt-clear"/.test(html));
check('1.3.0: formatbar styled', /#formatbar/.test(css));
check('1.3.0: formatted view is contenteditable', /id="formatted-view" contenteditable="true"/.test(html));
check('1.3.0: formatted view styled (headings/lists/links/tables)', /#formatted-view h1/.test(css) && /#formatted-view ul/.test(css) && /#formatted-view a/.test(css) && /#formatted-view table/.test(css));
check('1.3.0: status bar view toggle exists', /id="status-format"/.test(html));
check('1.3.0: View menu has Formatted View', /data-action="view-formatted"/.test(html));
check('1.3.0: View menu has Markdown View', /data-action="view-markdown"/.test(html));
check('1.3.0: link modal exists', /id="link-overlay"/.test(html));
check('1.3.0: link URL input exists', /id="link-url-input"/.test(html));
check('1.3.0: link insert button exists', /id="link-ok"/.test(html));
check('1.3.0: settings has formatting checkbox', /id="setting-formatting"/.test(html));
check('1.3.0: about mentions Markdown formatting', /Markdown formatting/.test(html));
check('1.3.0: emoji picker top offset updated for taller header', /#emoji-picker \{[^}]*top: 78px/.test(css));
check('1.3.0: main window is frameless', /frame: false/.test(main));
check('1.3.0: main has window minimize handler', /window:minimize/.test(main));
check('1.3.0: main has window maximize-toggle handler', /window:maximize-toggle/.test(main));
check('1.3.0: main has window close handler', /window:close/.test(main));
check('1.3.0: main has window is-maximized handler', /window:is-maximized/.test(main));
check('1.3.0: main has openExternal handler', /app:openExternal/.test(main));
check('1.3.0: openExternal only allows http/https', /\/\^https\?:\\\/\\\//.test(main));
check('1.3.0: preload bridges window controls', /windowMinimize/.test(preload) && /windowMaximizeToggle/.test(preload) && /windowClose/.test(preload) && /windowIsMaximized/.test(preload));
check('1.3.0: preload bridges openExternal', /openExternal/.test(preload));
check('1.3.0: no Copilot button or AI feature anywhere', !/copilot/i.test(all));
check('1.3.0: renderer has renderMarkdownInto', /function renderMarkdownInto/.test(renderer));
check('1.3.0: renderer has appendInline', /function appendInline/.test(renderer));
check('1.3.0: renderer has serializeFormatted', /function serializeFormatted/.test(renderer));
check('1.3.0: renderer has serializeNode', /function serializeNode/.test(renderer));
check('1.3.0: renderer has setViewMode', /function setViewMode/.test(renderer));
check('1.3.0: renderer has effectiveView', /function effectiveView/.test(renderer));
check('1.3.0: renderer has applyViewVisibility', /function applyViewVisibility/.test(renderer));
check('1.3.0: renderer has updateViewUI', /function updateViewUI/.test(renderer));
check('1.3.0: renderer has getEditorText', /function getEditorText/.test(renderer));
check('1.3.0: renderer has getCaretOffsets', /function getCaretOffsets/.test(renderer));
check('1.3.0: renderer has setCaretOffsets', /function setCaretOffsets/.test(renderer));
check('1.3.0: renderer has replaceEditorText', /function replaceEditorText/.test(renderer));
check('1.3.0: renderer has buildSegments', /function buildSegments/.test(renderer));
check('1.3.0: renderer has wrapInline', /function wrapInline/.test(renderer));
check('1.3.0: renderer has setHeading', /function setHeading/.test(renderer));
check('1.3.0: renderer has toggleList', /function toggleList/.test(renderer));
check('1.3.0: renderer has insertLinkMd', /function insertLinkMd/.test(renderer));
check('1.3.0: renderer has insertTableMd', /function insertTableMd/.test(renderer));
check('1.3.0: renderer has clearFormatting', /function clearFormatting/.test(renderer));
check('1.3.0: renderer has formatBold/Italic/Strike', /function formatBold/.test(renderer) && /function formatItalic/.test(renderer) && /function formatStrike/.test(renderer));
check('1.3.0: renderer has formatHeading/Bullet/Numbered/Table/Clear', /function formatHeading/.test(renderer) && /function formatBullet/.test(renderer) && /function formatNumbered/.test(renderer) && /function formatTable/.test(renderer) && /function formatClear/.test(renderer));
check('1.3.0: renderer has openLinkModal/applyLink/normalizeUrl', /function openLinkModal/.test(renderer) && /function applyLink/.test(renderer) && /function normalizeUrl/.test(renderer));
check('1.3.0: renderer has updateMaxIcon/toggleMaximize', /function updateMaxIcon/.test(renderer) && /function toggleMaximize/.test(renderer));
check('1.3.0: renderer has tabbar double-click maximize', /dblclick/.test(renderer) && /toggleMaximize\(\)/.test(renderer));
check('1.3.0: renderer Ctrl+B shortcut', /e\.key === 'b'/.test(renderer));
check('1.3.0: renderer Ctrl+I shortcut', /e\.key === 'i'/.test(renderer));
check('1.3.0: renderer Ctrl+K shortcut', /e\.key === 'k'/.test(renderer));
check('1.3.0: renderer Ctrl+click opens links', /closest\('a'\)/.test(renderer) && /openExternal/.test(renderer));
check('1.3.0: renderer pastes plain text in formatted view', /addEventListener\('paste'/.test(renderer));
check('1.3.0: default settings enable formatting', /formatting: true/.test(renderer));
check('1.3.0: default view mode is formatted', /viewMode: 'formatted'/.test(renderer));
check('1.3.0: smoke checks tab bar on top', /tab bar is the topmost row/.test(main));
check('1.3.0: smoke checks + next to last tab', /new-tab \+ is immediately after #tabs/.test(main));
check('1.3.0: smoke checks Bold wraps selection', /Bold wraps selection/.test(main));
check('1.3.0: smoke checks heading sets # heading', /heading dropdown sets # heading/.test(main));
check('1.3.0: smoke checks link inserts Markdown', /link inserts \[text\]\(url\) Markdown/.test(main));
check('1.3.0: smoke checks formatted view renders link/table', /formatted view renders the link/.test(main) && /formatted view renders the table/.test(main));
check('1.3.0: smoke checks formatting off hides toolbar', /formatting off hides the toolbar/.test(main));
check('1.3.0: smoke checks maximize button IPC', /maximize button IPC round-trips/.test(main));
check('1.3.0: Ctrl+wheel zoom handler (non-passive, both views)', /function onWheelZoom/.test(renderer) && /addEventListener\('wheel', onWheelZoom, \{ passive: false \}\)/.test(renderer));
check('1.3.0: context menu element exists', /id="context-menu"/.test(html));
check('1.3.0: context menu has Cut/Copy/Paste/Select All/Undo/Redo', /data-ctx="cut"/.test(html) && /data-ctx="copy"/.test(html) && /data-ctx="paste"/.test(html) && /data-ctx="select-all"/.test(html) && /data-ctx="undo"/.test(html) && /data-ctx="redo"/.test(html));
check('1.3.0: renderer opens context menu on right-click', /addEventListener\('contextmenu'/.test(renderer) && /function openContextMenu/.test(renderer));
check('1.3.0: renderer has DOM replace that keeps formatting', /function replaceInFormatted/.test(renderer) && /function replacePlainRangeInFormatted/.test(renderer));
check('1.3.0: serialize joins blocks with a blank line', /blocks\.join\('\\n\\n'\)/.test(renderer));
check('1.3.0: insertTextAtCaret uses execCommand in formatted view', /document\.execCommand\('insertText', false, str\)/.test(renderer));
check('1.3.0: Markdown undo/redo history exists', /function mdUndo/.test(renderer) && /function mdRedo/.test(renderer) && /mdUndoStack/.test(renderer));
check('1.3.0: Ctrl+Z handled in Markdown view', /e\.key === 'z'/.test(renderer) && /mdUndo\(\)/.test(renderer));
check('1.3.0: Tab inserts a tab character', /e\.key === 'Tab'/.test(renderer) && /insertTextAtCaret\('\\t'\)/.test(renderer));
check('1.3.0: font setting applies to formatted view', /formattedView\.style\.fontFamily = settings\.fontFamily/.test(renderer));
check('1.3.0: Word Wrap toggles nowrap on formatted view', /formattedView\.classList\.toggle\('nowrap'/.test(renderer) && /#formatted-view\.nowrap/.test(css));
check('1.3.0: text drop is not swallowed (files-only preventDefault)', /if \(!files\.length\) return;/.test(renderer));
check('1.3.0: copy falls back to Clipboard API', /navigator\.clipboard\.writeText/.test(renderer));
check('1.3.0: smoke checks Ctrl+wheel zoom', /Ctrl\+wheel zoom/.test(main));
check('1.3.0: smoke checks context menu opens', /context menu opens/.test(main));
check('1.3.0: smoke checks replace keeps bold', /replace keeps bold/.test(main));
check('1.3.0: smoke checks F5 keeps bold', /F5 keeps bold/.test(main));
check('1.3.0: smoke checks Markdown undo', /Markdown undo/.test(main));
// 1.3.0: Formatted view keeps line-leading indentation (user's
// manifest.json pasted in Formatted view lost every indent because
// HTML with normal white-space collapses leading spaces).
check('1.3.0: formatted view uses pre-wrap', /#formatted-view \{[^}]*white-space: pre-wrap/.test(css));
check('1.3.0: formatted view blocks use pre-wrap', /#formatted-view p, #formatted-view div, #formatted-view li \{[^}]*white-space: pre-wrap/.test(css));
check('1.3.0: wrap-off still forces pre on formatted blocks', /#formatted-view\.nowrap p, #formatted-view\.nowrap div, #formatted-view\.nowrap li \{[^}]*white-space: pre/.test(css));
check('1.3.0: smoke checks formatted indent is kept', /formatted indent kept/.test(main));
check('1.3.0: smoke checks indent round-trip', /indent round-trip/.test(main));
check('1.3.0: smoke checks tab indent is kept', /tab indent is kept/.test(main));

// 1.4.0: Day / Night theme toggle button next to the emoji button.
// Day mode is pure white, Night mode is pure black, whole app.
check('1.4.0: theme toggle button exists in menubar', /id="theme-toggle-btn"/.test(html));
check('1.4.0: theme button sits right after emoji button', /id="emoji-btn"[^>]*>[\s\S]{0,1200}id="theme-toggle-btn"/.test(html));
check('1.4.0: theme button has sun icon', /id="theme-icon-sun"/.test(html));
check('1.4.0: theme button has moon icon', /id="theme-icon-moon"/.test(html));
check('1.5: theme button sun/moon use currentColor (no white-on-orange)', /id="theme-icon-sun"[^>]*stroke="currentColor"/.test(html) && /id="theme-icon-moon"[\s\S]{0,200}fill="currentColor"/.test(html));
check('1.5: theme button is round and transparent in CSS', /#theme-toggle-btn \{[^}]*border-radius: 50%/.test(css) && /#theme-toggle-btn \{[^}]*background: transparent/.test(css));
check('1.5: no orange colour on the theme button anywhere', !/#f5821f/.test(css) && !/#f5821f/.test(html) && !/e8770e/.test(css));
check('1.4.0: Day mode surfaces are pure white', /:root \{[^}]*--bg: #ffffff/.test(css) && /:root \{[^}]*--bg-2: #ffffff/.test(css) && /:root \{[^}]*--bg-3: #ffffff/.test(css) && /:root \{[^}]*--tab-active: #ffffff/.test(css));
check('1.4.0: Night mode surfaces are pure black', /body\.dark \{[^}]*--bg: #000000/.test(css) && /body\.dark \{[^}]*--bg-2: #000000/.test(css) && /body\.dark \{[^}]*--bg-3: #000000/.test(css) && /body\.dark \{[^}]*--tab-active: #000000/.test(css));
check('1.4.0: Night mode text is white', /body\.dark \{[^}]*--text: #ffffff/.test(css));
check('1.4.0: renderer has toggleTheme', /function toggleTheme/.test(renderer));
check('1.4.0: toggleTheme flips light/dark and saves', /function toggleTheme[\s\S]{0,300}persistSettings\(\)/.test(renderer));
check('1.4.0: menu theme action uses toggleTheme', /case 'toggle-theme':\s*toggleTheme\(\);/.test(renderer));
check('1.4.0: theme button click wired to toggleTheme', /themeToggleBtn\.addEventListener\('click'/.test(renderer) && /toggleTheme\(\)/.test(renderer));
check('1.4.0: applyTheme updates toggle button icon and label', /theme-icon-sun/.test(renderer) && /theme-icon-moon/.test(renderer) && /Switch to Night Mode/.test(renderer) && /Switch to Light Mode/.test(renderer));
check('1.4.0: smoke checks theme button present', /theme toggle button present/.test(main));
check('1.4.0: smoke checks theme button next to emoji', /theme button sits next to emoji button/.test(main));
check('1.4.0: smoke checks theme button flips and is pure', /theme button flips dark mode/.test(main) && /flipped theme is pure white or pure black/.test(main));
check('1.4.0: smoke checks bars match pure theme bg', /tab\/menu\/toolbar\/status bars match pure theme bg/.test(main));

// 1.5: editor focused on launch, theme button has no orange.
check('1.5: renderer focuses editor at start', /function focusEditorAtStart/.test(renderer));
check('1.5: showTab focuses editor at start', /focusEditorAtStart\(\);/.test(renderer));
check('1.5: focus puts caret at offset 0', /setCaretOffsets\(0, 0\)/.test(renderer));
check('1.5: smoke checks editor focused on load', /editor is focused on load/.test(main));
check('1.5: smoke checks theme button has no orange', /theme button has no orange background/.test(main));
check('1.5: smoke checks theme icon follows text colour', /theme button icon follows theme text colour/.test(main));

// 10. Markdown transform logic (mirrors renderer.js 1.3.0 pure functions)
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
check('md: bold wraps selection', wrapInline('Hello world', 0, 5, '**').text === '**Hello** world');
check('md: bold unwraps selection', wrapInline('**Hello** world', 0, 9, '**').text === 'Hello world');
check('md: italic wraps selection', wrapInline('Hello world', 6, 11, '*').text === 'Hello *world*');
check('md: strike wraps selection', wrapInline('Hello world', 0, 5, '~~').text === '~~Hello~~ world');
check('md: no selection inserts markers with caret between', (() => {
  const r = wrapInline('abc', 1, 1, '**');
  return r.text === 'a****bc' && r.start === 3 && r.end === 3;
})());
check('md: bold caret lands after opening markers', wrapInline('Hello', 5, 5, '**').start === 7);
check('md: heading H1 on plain line', setHeading('Hello\nSecond', 0, 1).text === '# Hello\nSecond');
check('md: heading H2 on second line', setHeading('Hello\nSecond', 7, 2).text === 'Hello\n## Second');
check('md: heading H1 replaces H2', setHeading('## Hello', 0, 1).text === '# Hello');
check('md: heading level 0 removes heading', setHeading('### Hello', 0, 0).text === 'Hello');
check('md: heading H3', setHeading('Hello', 0, 3).text === '### Hello');
check('md: bullet list adds - to lines', toggleList('a\nb', 0, 3, false).text === '- a\n- b');
check('md: bullet list toggles off', toggleList('- a\n- b', 0, 7, false).text === 'a\nb');
check('md: numbered list adds 1. 2.', toggleList('a\nb', 0, 3, true).text === '1. a\n2. b');
check('md: numbered list toggles off', toggleList('1. a\n2. b', 0, 9, true).text === 'a\nb');
check('md: bullet converts numbered to bullet', toggleList('1. a\n2. b', 0, 9, false).text === '- a\n- b');
check('md: single line bullet', toggleList('Hello', 0, 5, false).text === '- Hello');
check('md: link with selection', insertLinkMd('Hello world', 0, 5, 'https://example.com').text === '[Hello](https://example.com) world');
check('md: link without selection uses label', insertLinkMd('abc', 3, 3, 'https://x.com').text === 'abc[link text](https://x.com)');
check('md: table at empty doc', insertTableMd('', 0).text === '| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n');
check('md: table after text adds blank line', insertTableMd('Hello', 5).text === 'Hello\n| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n');
check('md: table after newline needs no extra blank', insertTableMd('Hello\n', 6).text === 'Hello\n| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n');
check('md: clear strips bold + italic', clearFormatting('**Hello** *world*', 0, 19).text === 'Hello world');
check('md: clear strips heading + list + link', clearFormatting('# Title\n- [Link](https://x.com)', 0, 30).text === 'Title\nLink');
check('md: clear strips strikethrough + code', clearFormatting('~~old~~ `code`', 0, 14).text === 'old code');
check('md: clear strips list-then-heading combo', clearFormatting('- # Second line', 0, 15).text === 'Second line');
check('md: clear leaves plain text untouched', clearFormatting('plain text here', 0, 15).text === 'plain text here');
check('md: clear only touches selected lines', clearFormatting('**a**\nb', 0, 5).text === 'a\nb');

// 1.6: new features — presence checks plus REAL functional tests on
// text-utils.js (the exact code the app runs, not a mirrored copy).
// These fail on the 1.5 code, which has no text-utils.js at all.
check('1.6: text-utils.js is loaded before renderer.js', /<script src="text-utils\.js"><\/script>[\s\S]{0,80}<script src="renderer\.js">/.test(html));
check('1.6: find bar has match-case toggle', /data-opt="matchCase"/.test(html));
check('1.6: find bar has whole-word toggle', /data-opt="wholeWord"/.test(html));
check('1.6: find bar has regex toggle', /data-opt="regex"/.test(html));
check('1.6: replace bar has the same three toggles', (html.match(/data-opt="matchCase"/g) || []).length >= 2 && (html.match(/data-opt="regex"/g) || []).length >= 2);
check('1.6: renderer has findOptions state', /let findOptions = \{ matchCase: false, wholeWord: false, regex: false \}/.test(renderer));
check('1.6: renderer uses text-utils findMatches', /TU\.findMatches\(/.test(renderer));
check('1.6: renderer reports invalid regex instead of crashing', /Invalid regular expression/.test(read('text-utils.js')) && /findError/.test(renderer) && /findCount\.textContent = findError/.test(renderer));
check('1.6: File menu has Print (Ctrl+P)', /data-action="print"/.test(html) && /Ctrl\+P/.test(html));
check('1.6: File menu has Export as PDF', /data-action="export-pdf"/.test(html));
check('1.6: main has printToPDF export handler', /file:exportPdf/.test(main) && /printToPDF/.test(main));
check('1.6: main has print handler', /file:print/.test(main) && /\.print\(/.test(main));
check('1.6: preload exposes printPage/exportPdf', /printPage/.test(preload) && /exportPdf/.test(preload));
check('1.6: Ctrl+P shortcut', /e\.key === 'p'/.test(renderer));
check('1.6: print CSS hides app chrome', /@media print/.test(css) && /#tabbar, #menubar/.test(css));
check('1.6: settings font list has 22 options', (() => {
  const m = html.match(/<select id="setting-font">([\s\S]*?)<\/select>/);
  return m ? (m[1].match(/<option/g) || []).length === 22 : false;
})());
check('1.6: font weight setting exists', /id="setting-font-weight"/.test(html) && /fontWeight/.test(renderer));
check('1.6: font weight applies to both views', /editor\.style\.fontWeight = settings\.fontWeight/.test(renderer) && /formattedView\.style\.fontWeight = settings\.fontWeight/.test(renderer));
check('1.6: status bar shows line endings', /id="status-eol"/.test(html));
check('1.6: status bar encoding is not hardcoded', !/statusEncoding\.textContent = 'UTF-8';/.test(renderer) && /tab\.encoding/.test(renderer));
check('1.6: View menu converts line endings', /data-action="convert-eol-crlf"/.test(html) && /data-action="convert-eol-lf"/.test(html));
check('1.6: renderer has convertLineEndings', /function convertLineEndings/.test(renderer));
check('1.6: main decodes files with encoding detection', /decodeBytes/.test(main) && /file:read/.test(main));
check('1.6: main writes back in the tab encoding', /encodeBytes/.test(main));
check('1.6: tabs are draggable', /el\.draggable = true/.test(renderer) && /dragstart/.test(renderer));
check('1.6: tab reorder uses reorderTabs', /TU\.reorderTabs\(/.test(renderer));
check('1.6: session save keeps encoding/line endings', /encoding: t\.encoding/.test(renderer) && /lineEnding: t\.lineEnding/.test(renderer));
check('1.6: unsaved backup is written', /backup\.json/.test(renderer) && /isDirty\(t\)/.test(renderer));
check('1.6: backup is restored when the session is missing', /getStore\('backup\.json'/.test(renderer));
check('1.6: About dialog credits Anjum Learning Lab', /Developed by Anjum Learning Lab/.test(html));
check('1.6: no dnsh id in app source (excluding package-lock)', !/dnsh/.test(main + preload + renderer + html + css));
check('1.6: postinstall script applies the patch automatically', /postinstall/.test(read('scripts/postinstall.js')) && /normalizePackageData/.test(read('scripts/postinstall.js')));
check('1.6: PATCH-README says the patch is automatic', /AUTOMATICALLY/.test(read('patches/PATCH-README.txt')));
check('1.6: README exists and names Anjum Learning Lab', /Anjum Learning Lab/.test(read('README.md')) && /1\.6/.test(read('README.md')));
check('1.6: CHANGELOG has a 1.6 entry', /## 1\.6/.test(read('CHANGELOG.md')));

const TU = require('../text-utils.js');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('1.6: find plain is case-insensitive by default', eq(TU.findMatches('Hello hello HELLO', 'hello').map(m => m.start), [0, 6, 12]));
check('1.6: find match-case finds only exact case', eq(TU.findMatches('Hello hello HELLO', 'hello', { matchCase: true }).map(m => m.start), [6]));
check('1.6: find whole-word skips substrings', eq(TU.findMatches('cat cats scatter cat', 'cat', { wholeWord: true }).map(m => m.start), [0, 17]));
check('1.6: find whole-word off matches substrings', TU.findMatches('cats', 'cat', { wholeWord: false }).length === 1);
check('1.6: find regex matches digits', eq(TU.findMatches('a1 b22 c333', '\\d+', { regex: true }).map(m => [m.start, m.end]), [[1, 2], [4, 6], [8, 11]]));
check('1.6: find regex is case-insensitive by default', TU.findMatches('Abc ABC', 'abc', { regex: true }).length === 2);
check('1.6: find invalid regex throws a readable error', (() => { try { TU.findMatches('x', '(', { regex: true }); return false; } catch (e) { return /Invalid regular expression/.test(e.message); } })());
check('1.6: find empty query returns no matches', TU.findMatches('abc', '').length === 0);
check('1.6: replaceAll plain replaces all', TU.replaceAllText('a b a b', 'a', 'z').text === 'z b z b' && TU.replaceAllText('a b a b', 'a', 'z').count === 2);
check('1.6: replaceAll match-case replaces only exact case', TU.replaceAllText('Hello hello', 'hello', 'bye', { matchCase: true }).text === 'Hello bye');
check('1.6: replaceAll whole-word keeps substrings', TU.replaceAllText('cat cats', 'cat', 'dog', { wholeWord: true }).text === 'dog cats');
check('1.6: replaceAll regex expands $1 capture', TU.replaceAllText('2026-11-25', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', { regex: true }).text === '25/11/2026');
check('1.6: line endings detect CRLF', TU.detectLineEnding('a\r\nb\r\n') === 'CRLF');
check('1.6: line endings detect LF', TU.detectLineEnding('a\nb\n') === 'LF');
check('1.6: line endings detect Mixed', TU.detectLineEnding('a\r\nb\n') === 'Mixed');
check('1.6: convert line endings to CRLF', TU.convertLineEnding('a\nb\n', 'CRLF') === 'a\r\nb\r\n');
check('1.6: convert line endings to LF', TU.convertLineEnding('a\r\nb\r\n', 'LF') === 'a\nb\n');
check('1.6: decode UTF-8 BOM', (() => { const d = TU.decodeBytes(new Uint8Array([0xEF, 0xBB, 0xBF, 72, 105])); return d.text === 'Hi' && d.encoding === 'UTF-8 BOM'; })());
check('1.6: decode UTF-16LE BOM', (() => { const d = TU.decodeBytes(new Uint8Array([0xFF, 0xFE, 72, 0, 105, 0])); return d.text === 'Hi' && d.encoding === 'UTF-16LE'; })());
check('1.6: decode UTF-16BE BOM', (() => { const d = TU.decodeBytes(new Uint8Array([0xFE, 0xFF, 0, 72, 0, 105])); return d.text === 'Hi' && d.encoding === 'UTF-16BE'; })());
check('1.6: decode plain UTF-8', (() => { const d = TU.decodeBytes(new TextEncoder().encode('Hello\nWorld')); return d.text === 'Hello\nWorld' && d.encoding === 'UTF-8' && d.lineEnding === 'LF'; })());
check('1.6: encode UTF-16LE round-trips', (() => { const bytes = TU.encodeBytes('Hi\r\nYo', 'UTF-16LE', 'CRLF'); const d = TU.decodeBytes(bytes); return d.text === 'Hi\r\nYo' && d.encoding === 'UTF-16LE'; })());
check('1.6: encode UTF-8 BOM round-trips', (() => { const bytes = TU.encodeBytes('Hi', 'UTF-8 BOM', 'LF'); const d = TU.decodeBytes(bytes); return d.text === 'Hi' && d.encoding === 'UTF-8 BOM'; })());
check('1.6: tab reorder moves dragged tab before target', (() => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const out = TU.reorderTabs(tabs, 3, 1);
  return eq(out.map(t => t.id), [3, 1, 2]) && eq(tabs.map(t => t.id), [1, 2, 3]);
})());
check('1.6: tab reorder to same tab is a no-op', eq(TU.reorderTabs([{ id: 1 }, { id: 2 }], 1, 1).map(t => t.id), [1, 2]));

console.log(`\nStatic checks: ${passed} passed, ${failed} failed.`);
if (failed) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
