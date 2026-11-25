'use strict';
/*
 * Generator for emoji-data.js.
 * Source: Unicode emoji-test.txt (UTS #51, Version 18.0) — the authoritative
 * list of fully-qualified emoji, with their official CLDR names.
 * Run: node tools/gen-emoji.js
 * Output: emoji-data.js (window.EMOJI_DATA, also require-able in Node).
 * Rules:
 *  - only fully-qualified emoji (no components, no unqualified duplicates)
 *  - skip skin-tone variants (1F3FB-1F3FF) — WhatsApp shows those via
 *    long-press, not as separate grid entries
 *  - de-duplicate by rendered character
 *  - keywords = name words + stems (smiling -> smile, hearts -> heart)
 */
const fs = require('fs');
const path = require('path');

const SRC = '/tmp/emoji-test.txt';
const OUT = path.join(__dirname, '..', 'emoji-data.js');

const GROUP_MAP = {
  'Smileys & Emotion': 'Smileys',
  'People & Body': 'People',
  'Animals & Nature': 'Animals',
  'Food & Drink': 'Food',
  'Activities': 'Activities',
  'Travel & Places': 'Travel',
  'Objects': 'Objects',
  'Symbols': 'Symbols',
  'Flags': 'Flags'
};

function stem(word) {
  const out = new Set();
  const w = word.toLowerCase();
  out.add(w);
  if (w.length > 4 && w.endsWith('ing')) {
    out.add(w.slice(0, -3));
    out.add(w.slice(0, -3) + 'e');
  }
  if (w.length > 3 && w.endsWith('ed')) out.add(w.slice(0, -2));
  if (w.length > 3 && w.endsWith('es')) out.add(w.slice(0, -2));
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss')) out.add(w.slice(0, -1));
  return out;
}

function keywordsFor(name) {
  const kws = new Set();
  const clean = name.toLowerCase().replace(/[^a-z0-9 :]+/g, ' ');
  clean.split(/[\s:]+/).filter(Boolean).forEach(w => {
    stem(w).forEach(s => kws.add(s));
  });
  // Common aliases so plain searches work like WhatsApp.
  const alias = {
    'heart': ['love'],
    'smile': ['happy'],
    'smiling': ['happy'],
    'grin': ['happy'],
    'cry': ['sad'],
    'tear': ['sad'],
    'fire': ['flame', 'hot'],
    'cat': ['kitten'],
    'dog': ['puppy'],
    'sun': ['sunny'],
    'moon': ['night'],
    'star': ['sparkle']
  };
  [...kws].forEach(k => {
    if (alias[k]) alias[k].forEach(a => kws.add(a));
  });
  return [...kws].sort();
}

const text = fs.readFileSync(SRC, 'utf8');
const lines = text.split('\n');
let group = '';
const seen = new Set();
const data = [];
const byGroup = {};

for (const line of lines) {
  const gm = line.match(/^# group:\s*(.+?)\s*$/);
  if (gm) { group = GROUP_MAP[gm[1].trim()] || gm[1].trim(); continue; }
  if (!line || line.startsWith('#')) continue;
  // "1F600 ; fully-qualified # 😀 E1.0 grinning face"
  const m = line.match(/^([0-9A-F ]+)\s*;\s*(\S+)\s*#\s*(\S+)\s+E[\d.]+\s+(.+?)\s*$/);
  if (!m) continue;
  const codes = m[1].trim().split(/\s+/);
  const status = m[2];
  const name = m[4].trim();
  if (status !== 'fully-qualified') continue;
  if (codes.some(c => {
    const v = parseInt(c, 16);
    return (v >= 0x1F3FB && v <= 0x1F3FF); // skin tone modifier
  })) continue;
  let ch = '';
  try { ch = String.fromCodePoint(...codes.map(c => parseInt(c, 16))); } catch (e) { continue; }
  if (!ch || seen.has(ch)) continue;
  seen.add(ch);
  const entry = { c: ch, n: name, k: keywordsFor(name), g: group || 'Symbols' };
  data.push(entry);
  byGroup[entry.g] = (byGroup[entry.g] || 0) + 1;
}

console.log('Groups:', JSON.stringify(byGroup));
console.log('Total emojis:', data.length);
if (data.length < 800) { console.error('TOO FEW EMOJIS'); process.exit(1); }

const header = "'use strict';\n\n" +
  "/*\n * Emoji data for Notepad 1.0.2 - generated from Unicode emoji-test.txt\n" +
  " * (UTS #51, fully-qualified emoji only, skin-tone variants excluded).\n" +
  " * Do not edit by hand - regenerate with: node tools/gen-emoji.js\n" +
  " * Format: { c: character, n: name, k: keywords, g: category }\n" +
  " * Categories: Smileys, People, Animals, Food, Activities, Travel,\n" +
  " * Objects, Symbols, Flags. Emojis render with the system emoji font\n" +
  " * (Segoe UI Emoji on Windows) - these are standard Unicode emoji,\n" +
  " * the same free set WhatsApp uses, not copied WhatsApp images.\n" +
  " */\n" +
  "(function () {\n" +
  "  var EMOJI_DATA = " + JSON.stringify(data) + ";\n" +
  "  if (typeof window !== 'undefined') window.EMOJI_DATA = EMOJI_DATA;\n" +
  "  if (typeof module !== 'undefined' && module.exports) module.exports = EMOJI_DATA;\n" +
  "})();\n";
fs.writeFileSync(OUT, header, 'utf8');
console.log('Wrote', OUT);
