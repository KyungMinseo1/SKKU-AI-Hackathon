import { BrowserWindow, desktopCapturer, ipcMain, screen, type Display } from 'electron'
import { join } from 'path'
import { setTimeout as sleep } from 'timers/promises'
import { is } from '@electron-toolkit/utils'
import type { OverlayParams } from '../preload/index.d'

let overlay: BrowserWindow | null = null
let overlayDisplay: Display | null = null
let interactive = false

function applyInteractive(): void {
  overlay?.setIgnoreMouseEvents(!interactive, { forward: true })
}

function destroyOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
  overlayDisplay = null
  interactive = false
}

// macOS: hiding a native-fullscreen window leaves its Space behind as a black screen,
// so drop back to the desktop Space before the main window is hidden.
async function leaveFullScreen(win: BrowserWindow): Promise<void> {
  if (!win.isFullScreen()) return
  await new Promise<void>((resolve) => {
    win.once('leave-full-screen', () => resolve())
    win.setFullScreen(false)
  })
}

async function openOverlay(params: OverlayParams, mainWindow: BrowserWindow | null): Promise<void> {
  destroyOverlay()
  if (mainWindow && !mainWindow.isDestroyed()) await leaveFullScreen(mainWindow)
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const win = new BrowserWindow({
    ...display.bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  overlay = win
  overlayDisplay = display
  interactive = false
  win.setAlwaysOnTop(true, 'screen-saver')
  // macOS: also float over other apps' fullscreen Spaces (e.g. slides in fullscreen).
  if (process.platform === 'darwin')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  applyInteractive()
  win.on('closed', () => {
    if (overlay === win) {
      overlay = null
      overlayDisplay = null
    }
  })

  const query =
    `sessionId=${encodeURIComponent(String(params.sessionId))}` +
    `&courseName=${encodeURIComponent(params.courseName)}` +
    `&weekNo=${encodeURIComponent(String(params.weekNo))}` +
    `&weekTitle=${encodeURIComponent(params.weekTitle)}`
  const hash = `/overlay?${query}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }

  mainWindow?.hide()
}

async function captureScreen(): Promise<string> {
  const win = overlay
  const display = overlayDisplay
  if (!win || !display) throw new Error('오버레이가 열려 있지 않습니다')
  try {
    win.hide()
    await sleep(200)
    const { bounds, scaleFactor } = display
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(bounds.width * scaleFactor),
        height: Math.round(bounds.height * scaleFactor)
      }
    })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source) throw new Error('화면을 캡처할 수 없습니다')
    return `data:image/jpeg;base64,${source.thumbnail.toJPEG(90).toString('base64')}`
  } finally {
    if (!win.isDestroyed()) {
      win.show()
      win.setAlwaysOnTop(true, 'screen-saver')
      applyInteractive()
    }
  }
}

export function registerOverlayIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.on('overlay:open', (_event, params: OverlayParams) => {
    void openOverlay(params, getMainWindow())
  })

  ipcMain.on('overlay:set-interactive', (_event, value: boolean) => {
    interactive = Boolean(value)
    applyInteractive()
  })

  ipcMain.handle('overlay:capture', () => captureScreen())

  ipcMain.on('overlay:close', () => {
    destroyOverlay()
    const main = getMainWindow()
    if (main && !main.isDestroyed()) {
      main.show()
      main.webContents.send('overlay:closed')
    }
  })

  ipcMain.on('main:show', () => {
    const main = getMainWindow()
    if (main && !main.isDestroyed()) {
      main.show()
      main.focus()
    }
  })
}
