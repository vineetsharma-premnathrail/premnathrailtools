// Premnathrail Portal — Windows desktop shell.
// Loads the live production site, so every deploy to main reaches desktop
// users with no reinstall. The shell only decides where links open:
//   - portal pages + Microsoft sign-in stay in the app
//   - popups the portal opens (documents, PDFs, blobs) open as app windows
//   - Word Online / SharePoint and any other site open in the default browser
//     (the user is already signed into Microsoft 365 there)
const { app, BrowserWindow, Menu, shell, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

const APP_URL = process.env.PORTAL_URL || 'https://erp.premnathrailtools.cloud'
const APP_HOST = new URL(APP_URL).host
const LOGIN_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'aadcdn.msauth.net', 'aadcdn.msftauth.net']
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

app.setAppUserModelId('com.premnathrail.portal')

let mainWindow = null

function hostOf(url) {
  try { return new URL(url).host } catch { return '' }
}

const isAppUrl = (url) => hostOf(url) === APP_HOST
const isLoginUrl = (url) => LOGIN_HOSTS.includes(hostOf(url))
const isInternal = (url) => !url || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file:')

function openExternal(url) {
  if (/^(https?|mailto|tel|ms-word|ms-excel|ms-powerpoint):/i.test(url)) shell.openExternal(url)
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return { width: 1400, height: 900, maximized: true } }
}

function saveState(win) {
  if (win.isDestroyed()) return
  const state = { ...(win.isMaximized() ? loadState() : win.getBounds()), maximized: win.isMaximized() }
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)) } catch { /* non-fatal */ }
}

// Popups the portal opens: blank tabs it later points at a document,
// blob/PDF previews, or same-site pages → in-app window. Anything else → browser.
function attachPopupRules(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url) || isAppUrl(url) || isLoginUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100, height: 800, autoHideMenuBar: true,
          icon: path.join(__dirname, 'assets', 'icon.png'),
          webPreferences: { contextIsolation: true, sandbox: true, plugins: true },
        },
      }
    }
    openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('did-create-window', (child) => {
    attachPopupRules(child)
    // A blank tab the portal redirects to Word Online / SharePoint: hand the
    // URL to the browser and close the empty in-app window.
    child.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame) return
      const url = details.url
      if (isInternal(url) || isAppUrl(url) || isLoginUrl(url)) return
      openExternal(url)
      if (!child.isDestroyed()) child.close()
    })
  })
}

function createWindow() {
  const state = loadState()
  mainWindow = new BrowserWindow({
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: 900, minHeight: 600,
    title: 'Premnathrail Portal',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    // Menu stays for its shortcuts (Alt+←, Alt+Home, F5, zoom); Alt reveals it.
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, plugins: true, spellcheck: true },
  })
  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', () => saveState(mainWindow))

  // Main window may move between the portal and Microsoft sign-in; any other
  // site goes to the browser so the portal page is never lost.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || isLoginUrl(url) || url.startsWith('file:')) return
    event.preventDefault()
    openExternal(url)
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 = aborted (normal when a navigation is replaced); ignore it.
    if (!isMainFrame || code === -3) return
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), {
      query: { url: url || APP_URL, error: `${description} (${code})` },
    })
  })

  attachPopupRules(mainWindow)
  mainWindow.loadURL(APP_URL)
}

function buildMenu() {
  const focused = () => BrowserWindow.getFocusedWindow()
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Home', accelerator: 'Alt+Home', click: () => mainWindow?.loadURL(APP_URL) },
        { label: 'Open in Browser', click: () => { const w = focused(); if (w) openExternal(w.webContents.getURL()) } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: () => focused()?.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => focused()?.webContents.navigationHistory.goForward() },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [{
        label: 'About',
        click: () => dialog.showMessageBox({
          type: 'info', title: 'About',
          message: 'Premnathrail Portal',
          detail: `Version ${app.getVersion()}\nServer: ${APP_URL}`,
        }),
      }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// One copy only: launching again focuses the open window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(() => {
    buildMenu()
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
