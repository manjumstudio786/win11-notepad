'use strict';

/*
 * Notepad 1.6 - shared pure text helpers.
 * Used by the renderer (loaded as a plain <script>, exposes
 * window.NotepadTextUtils), by main.js (require) and by tests/test.js
 * (require). No DOM, no Electron, no Node-only APIs except the
 * TextDecoder/TextEncoder globals, which exist in Node 11+ and in
 * Chromium. Keeping the logic here means the tests exercise the exact
 * code the app runs, instead of a mirrored copy.
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFindRegExp(query, opts) {
  opts = opts || {};
  var pattern = opts.regex ? String(query) : escapeRegExp(String(query));
  if (opts.wholeWord) pattern = '\\b(?:' + pattern + ')\\b';
  var flags = opts.matchCase ? 'g' : 'gi';
  return new RegExp(pattern, flags);
}

// Returns [{start, end}, ...] for every non-overlapping match.
// Throws an Error with a readable message on an invalid regex.
function findMatches(text, query, opts) {
  if (!query) return [];
  var re;
  try {
    re = buildFindRegExp(query, opts);
  } catch (e) {
    throw new Error('Invalid regular expression: ' + (e && e.message ? e.message : String(e)));
  }
  var out = [];
  var m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
    // Zero-length matches (e.g. /x*/ on "") must advance, or exec loops forever.
    if (m[0].length === 0) re.lastIndex += 1;
    if (re.lastIndex > text.length) break;
  }
  return out;
}

function replaceAllText(text, query, withText, opts) {
  if (!query) return { text: text, count: 0 };
  var matches = findMatches(text, query, opts);
  if (!matches.length) return { text: text, count: 0 };
  var re;
  try {
    re = buildFindRegExp(query, opts);
  } catch (e) {
    throw new Error('Invalid regular expression: ' + (e && e.message ? e.message : String(e)));
  }
  // String.replace with a RegExp honours $1/$& in the replacement, so
  // regex replace keeps capture-group references working.
  return { text: String(text).replace(re, String(withText)), count: matches.length };
}

function detectLineEnding(text) {
  var hasCRLF = text.indexOf('\r\n') !== -1;
  var bareLF = text.replace(/\r\n/g, '').indexOf('\n') !== -1;
  var bareCR = text.replace(/\r\n/g, '').indexOf('\r') !== -1;
  if (hasCRLF && (bareLF || bareCR)) return 'Mixed';
  if (hasCRLF) return 'CRLF';
  return 'LF';
}

function convertLineEnding(text, style) {
  var lf = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return style === 'CRLF' ? lf.replace(/\n/g, '\r\n') : lf;
}

function decodeBytes(bytes) {
  var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  var encoding = 'UTF-8';
  var offset = 0;
  var hadBom = false;
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    encoding = 'UTF-8 BOM'; offset = 3; hadBom = true;
  } else if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) {
    encoding = 'UTF-16LE'; offset = 2; hadBom = true;
  } else if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
    encoding = 'UTF-16BE'; offset = 2; hadBom = true;
  } else if (b.length >= 4) {
    // No BOM: a UTF-16 file is mostly NUL bytes on one parity.
    var oddNul = 0; var evenNul = 0; var sample = Math.min(b.length, 200);
    for (var i = 0; i < sample; i++) {
      if (b[i] === 0) { if (i % 2 === 1) oddNul += 1; else evenNul += 1; }
    }
    if (oddNul > sample * 0.15 && evenNul < sample * 0.05) encoding = 'UTF-16LE';
    else if (evenNul > sample * 0.15 && oddNul < sample * 0.05) encoding = 'UTF-16BE';
  }
  var slice = b.subarray(offset);
  var text;
  if (encoding === 'UTF-16LE') text = new TextDecoder('utf-16le').decode(slice);
  else if (encoding === 'UTF-16BE') text = new TextDecoder('utf-16be').decode(slice);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(slice);
    } catch (e) {
      // Not valid UTF-8 and no BOM: fall back to UTF-16LE, the most
      // common non-UTF-8 text encoding on Windows.
      encoding = 'UTF-16LE';
      text = new TextDecoder('utf-16le').decode(slice);
    }
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return { text: text, encoding: encoding, lineEnding: detectLineEnding(text), hadBom: hadBom };
}

function encodeBytes(text, encoding, lineEnding) {
  var converted = convertLineEnding(text, lineEnding === 'CRLF' ? 'CRLF' : 'LF');
  if (encoding === 'UTF-16LE' || encoding === 'UTF-16BE') {
    var le = encoding === 'UTF-16LE';
    var out = new Uint8Array(2 + converted.length * 2);
    out[0] = le ? 0xFF : 0xFE; out[1] = le ? 0xFE : 0xFF;
    for (var i = 0; i < converted.length; i++) {
      var code = converted.charCodeAt(i);
      out[2 + i * 2] = le ? (code & 0xFF) : (code >> 8);
      out[2 + i * 2 + 1] = le ? (code >> 8) : (code & 0xFF);
    }
    return out;
  }
  var bytes = new TextEncoder().encode(converted);
  if (encoding === 'UTF-8 BOM') {
    var withBom = new Uint8Array(bytes.length + 3);
    withBom[0] = 0xEF; withBom[1] = 0xBB; withBom[2] = 0xBF;
    withBom.set(bytes, 3);
    return withBom;
  }
  return bytes;
}

// Pure tab reorder: move the tab with draggedId to just before the tab
// with targetId. Returns a new array; the input is never mutated.
function reorderTabs(tabs, draggedId, targetId) {
  var list = (tabs || []).slice();
  var from = -1; var to = -1;
  list.forEach(function (t, i) {
    if (t.id === draggedId) from = i;
    if (t.id === targetId) to = i;
  });
  if (from === -1 || to === -1 || from === to) return list;
  var moved = list.splice(from, 1)[0];
  var insertAt = from < to ? to - 1 : to;
  list.splice(insertAt, 0, moved);
  return list;
}

var api = {
  escapeRegExp: escapeRegExp,
  buildFindRegExp: buildFindRegExp,
  findMatches: findMatches,
  replaceAllText: replaceAllText,
  detectLineEnding: detectLineEnding,
  convertLineEnding: convertLineEnding,
  decodeBytes: decodeBytes,
  encodeBytes: encodeBytes,
  reorderTabs: reorderTabs
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.NotepadTextUtils = api;
