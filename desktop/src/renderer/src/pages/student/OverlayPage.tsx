import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useSearchParams } from 'react-router'
import QuestionPanel from './overlay/QuestionPanel'
import Toolbar, { type OverlayMode } from './overlay/Toolbar'
import { eraseAt, redraw, type Point, type Stroke } from './overlay/strokes'

export default function OverlayPage(): React.JSX.Element {
  const [params] = useSearchParams()
  const sessionId = Number(params.get('sessionId'))
  const courseName = params.get('courseName') ?? ''
  const weekNo = Number(params.get('weekNo'))

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef<Stroke | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [capture, setCapture] = useState<string | null>(null)
  const [mode, setMode] = useState<OverlayMode>('idle')
  const [hovering, setHovering] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [size, setSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio
  })

  // The overlay window is transparent: make sure no page background paints over the desktop.
  useEffect(() => {
    const targets = [document.documentElement, document.body, document.getElementById('root')]
    for (const el of targets) if (el) el.style.background = 'transparent'
  }, [])

  // Click-through except while drawing/erasing or hovering the toolbar/panel.
  useEffect(() => {
    window.askkup.setOverlayInteractive(mode !== 'idle' || hovering)
  }, [mode, hovering])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMode('idle')
    }
    const onResize = (): void =>
      setSize({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const paint = useCallback(
    (list: Stroke[]) => {
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx) redraw(ctx, list, size.w, size.h)
    },
    [size]
  )

  // Backing store = CSS size × dpr; repaint on resize and whenever strokes change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bw = Math.round(size.w * size.dpr)
    const bh = Math.round(size.h * size.dpr)
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
    paint(strokes)
  }, [size, strokes, paint])

  const updateStrokes = (next: Stroke[]): void => {
    setStrokes(next)
    setCapture(null) // stale once the marks change
  }

  const pointOf = (e: PointerEvent<HTMLCanvasElement>): Point => ({ x: e.clientX, y: e.clientY })

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (mode === 'idle') return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (mode === 'pen') {
      drawingRef.current = { points: [pointOf(e)] }
      paint([...strokes, drawingRef.current])
    } else {
      const next = eraseAt(strokes, pointOf(e))
      if (next.length !== strokes.length) updateStrokes(next)
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>): void => {
    if (mode === 'pen' && drawingRef.current) {
      drawingRef.current.points.push(pointOf(e))
      paint([...strokes, drawingRef.current])
    } else if (mode === 'eraser' && e.buttons & 1) {
      const next = eraseAt(strokes, pointOf(e))
      if (next.length !== strokes.length) updateStrokes(next)
    }
  }

  const onPointerUp = (): void => {
    const stroke = drawingRef.current
    drawingRef.current = null
    if (stroke) updateStrokes([...strokes, stroke])
  }

  const onSubmitted = useCallback(() => {
    setStrokes([])
    setCapture(null)
  }, [])

  const enter = useCallback(() => setHovering(true), [])
  const leave = useCallback(() => setHovering(false), [])

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-transparent">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          width: size.w,
          height: size.h,
          cursor: mode === 'idle' ? 'default' : 'crosshair',
          touchAction: 'none'
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className={panelOpen ? undefined : 'hidden'}>
        <QuestionPanel
          sessionId={sessionId}
          strokeCount={strokes.length}
          canvasRef={canvasRef}
          capture={capture}
          setCapture={setCapture}
          onSubmitted={onSubmitted}
          onMouseEnter={enter}
          onMouseLeave={leave}
        />
      </div>
      <Toolbar
        courseName={courseName}
        weekNo={weekNo}
        mode={mode}
        setMode={setMode}
        onClear={() => updateStrokes([])}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onMouseEnter={enter}
        onMouseLeave={leave}
      />
    </div>
  )
}
