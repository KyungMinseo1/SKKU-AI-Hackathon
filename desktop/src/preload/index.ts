import { contextBridge, ipcRenderer } from 'electron'
import type { AskkupApi, OverlayParams } from './index.d'

const askkup: AskkupApi = {
  openOverlay: (params: OverlayParams) => ipcRenderer.send('overlay:open', params),
  closeOverlay: () => ipcRenderer.send('overlay:close'),
  setOverlayInteractive: (value: boolean) => ipcRenderer.send('overlay:set-interactive', value),
  captureScreen: () => ipcRenderer.invoke('overlay:capture'),
  showDashboard: () => ipcRenderer.send('main:show'),
  onOverlayClosed: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('overlay:closed', listener)
    return () => {
      ipcRenderer.removeListener('overlay:closed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('askkup', askkup)
