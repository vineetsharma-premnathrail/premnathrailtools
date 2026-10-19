# Premnathrail Portal — Windows app

An Electron shell around the live portal (`https://erp.premnathrailtools.cloud`).
It loads the production site, so every deploy reaches desktop users with no reinstall.
You only need a new installer if this folder (`main.js` etc.) changes.

## Run / build

```
cd desktop
npm install
npm run icon      # once: makes assets/icon.png (256px) from teams-app/color.png
npm start         # try it
npm run build     # installer → dist/Premnathrail Portal Setup 1.0.0.exe
```

If the build fails with `EBUSY`/`EPERM` on `default_app.asar`, VS Code is watching `dist/` — build
outside the repo: `npx electron-builder --win -c.directories.output=C:\temp\portal-dist`.

Point at another server for testing: `$env:PORTAL_URL="http://localhost:3000"; npm start`

## What the shell does

- Portal pages and Microsoft sign-in stay inside the app; the sign-in is remembered between launches.
- Popups the portal opens (documents, PDF/blob previews) open as app windows.
- Word Online / SharePoint ("Edit in Word") and every other site open in the default browser.
- Window size/position remembered; only one copy runs at a time.
- Menu bar hidden (press Alt to show it): Home (Alt+Home), Back/Forward (Alt+←/→), Zoom, Open in Browser.
- If the server is unreachable, shows the real error and a Retry button.

The installer is unsigned, so Windows SmartScreen shows "Windows protected your PC" on first
run → **More info → Run anyway**. A code-signing certificate removes that warning.
