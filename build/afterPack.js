'use strict';

/*
 * electron-builder afterPack hook.
 * Removes unused Chromium locale files (the app is English-only) to slim
 * down the Windows installer. Chromium falls back to en-US when a locale
 * file is missing, so this is safe.
 */
const fs = require('fs');
const path = require('path');

async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;
  let removed = 0;
  for (const file of fs.readdirSync(localesDir)) {
    if (file.toLowerCase() !== 'en-us.pak') {
      fs.rmSync(path.join(localesDir, file), { force: true });
      removed += 1;
    }
  }
  console.log(`[afterPack] removed ${removed} unused locale files`);
}

module.exports = afterPack;
