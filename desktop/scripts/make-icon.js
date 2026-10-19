// One-off: electron-builder needs a >=256px square icon; the Teams app icon
// is 192px, so scale it up with Electron's own image API (no extra deps).
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

app.whenReady().then(() => {
  const src = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'teams-app', 'color.png'))
  if (src.isEmpty()) {
    console.error('Could not read teams-app/color.png — check the file exists.')
    app.exit(1)
    return
  }
  const out = path.join(__dirname, '..', 'assets', 'icon.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, src.resize({ width: 256, height: 256, quality: 'best' }).toPNG())
  console.log('Wrote', out)
  app.exit(0)
})
