export interface OverlayParams {
  sessionId: number
  courseName: string
  weekNo: number
  weekTitle: string
}

export interface AskkupApi {
  openOverlay(params: OverlayParams): void
  closeOverlay(): void
  setOverlayInteractive(value: boolean): void
  /** Hides the overlay, captures its display, restores it. Returns a JPEG data URL. */
  captureScreen(): Promise<string>
  showDashboard(): void
  /** Returns an unsubscribe function. */
  onOverlayClosed(cb: () => void): () => void
}

declare global {
  interface Window {
    askkup: AskkupApi
  }
}
