'use strict';

/*
 * Notepad 1.6 - postinstall hook (runs automatically after npm install).
 * The app uses a two-part version (1.6, never 1.6.0), but electron-builder
 * only accepts three-part versions (x.y.z). This script copies
 * patches/normalizePackageData.js into
 * node_modules/app-builder-lib/out/util/normalizePackageData.js, where
 * it coerces a two-part version to x.y.0 for the builder's own checks
 * only; package.json, the About dialog and the installer file name all
 * stay "1.6". Idempotent: if the installed file already contains the
 * patch marker it is left alone. Never fails the install: if
 * node_modules is absent or the target file is missing, it logs a
 * warning and exits 0.
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'Patched 2026-11-25 (Notepad v1.6)';
const src = path.join(__dirname, '..', 'patches', 'normalizePackageData.js');
const dest = path.join(
  __dirname, '..', 'node_modules', 'app-builder-lib', 'out', 'util', 'normalizePackageData.js'
);

try {
  if (!fs.existsSync(src)) {
    console.log('[postinstall] patch source not found, skipping: ' + src);
    process.exit(0);
  }
  if (!fs.existsSync(dest)) {
    console.log('[postinstall] app-builder-lib not installed yet, skipping version patch (run npm install again if the build complains about the version).');
    process.exit(0);
  }
  const current = fs.readFileSync(dest, 'utf8');
  if (current.indexOf(MARKER) !== -1) {
    console.log('[postinstall] version patch already applied.');
    process.exit(0);
  }
  fs.copyFileSync(src, dest);
  console.log('[postinstall] applied two-part version patch to app-builder-lib.');
} catch (e) {
  console.log('[postinstall] WARNING: could not apply version patch: ' + (e && e.message ? e.message : e));
  process.exit(0);
}
