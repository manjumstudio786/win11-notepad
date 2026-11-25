Notepad 1.6 - build patch note
================================
This app uses a two-part version (1.6, never 1.6.0), but electron-builder
only accepts three-part versions (x.y.z). The patch is now applied
AUTOMATICALLY: "npm install" runs scripts/postinstall.js, which copies
normalizePackageData.js into:

  node_modules/app-builder-lib/out/util/normalizePackageData.js

(replacing the file there). The patched file coerces a two-part version
like "1.6" to "1.6.0" for the builder's own checks only; package.json,
the About dialog and the installer file names all stay "1.6".

No manual step is needed any more. If you ever need to re-apply it by
hand, just run "node scripts/postinstall.js".

Then build the installers with:

  npm run dist

The installers are created as:
  dist/Notepad-1.6-Setup.exe      (NSIS installer)
  dist/Notepad-1.6-Portable.exe   (portable, no install)

Linux build note (NSIS, 2026-11-25)
------------------------------------
After makensis builds the NSIS uninstaller stub, electron-builder runs
that stub under wine to write out the real uninstaller file. On a Linux
machine with no working 32-bit wine that step fails ("wine process
failed"). The pure-JS UninstallerReader already shipped inside
app-builder-lib does the same job with no wine at all, so patch
node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js locally
(build machine only, not part of this repo): in
computeScriptAndSignUninstaller, in the non-macOS branch, try
  await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
first, and only fall back to the wineVm.exec call if it throws.
(The macOS .dmg has the same class of problem: it needs Apple's sips
tool, so build the .dmg on a Mac; on Linux the .zip target works.)
