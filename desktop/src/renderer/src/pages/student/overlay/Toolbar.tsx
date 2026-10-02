export type OverlayMode = 'idle' | 'pen' | 'eraser'

interface ToolbarProps {
  courseName: string
  weekNo: number
  mode: OverlayMode
  setMode: (mode: OverlayMode) => void
  onClear: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function ToolButton({
  label,
  icon,
  active,
  onClick
}: {
  label: string
  icon: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`flex w-14 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] transition ${
        active ? 'bg-brand-600 text-white' : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      <span className="text-lg leading-none">{icon}</span>
      {label}
    </button>
  )
}

export default function Toolbar({
  courseName,
  weekNo,
  mode,
  setMode,
  onClear,
  panelOpen,
  onTogglePanel,
  onMouseEnter,
  onMouseLeave
}: ToolbarProps): React.JSX.Element {
  // Drawing tools and the question panel are mutually exclusive: picking one switches off the other.
  const toggleMode = (m: OverlayMode): void => {
    const next = mode === m ? 'idle' : m
    if (next !== 'idle' && panelOpen) onTogglePanel()
    setMode(next)
  }
  const togglePanel = (): void => {
    if (!panelOpen) setMode('idle')
    onTogglePanel()
  }
  return (
    <div
      className="fixed right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-gray-200 bg-white/95 p-1.5 shadow-xl"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="max-w-16 px-1 pb-1 text-center text-[10px] leading-tight text-gray-500">
        {courseName} · {weekNo}주차
      </div>
      <ToolButton label="펜" icon="✏️" active={mode === 'pen'} onClick={() => toggleMode('pen')} />
      <ToolButton
        label="지우개"
        icon="🧽"
        active={mode === 'eraser'}
        onClick={() => toggleMode('eraser')}
      />
      <ToolButton label="모두 지우기" icon="🗑️" onClick={onClear} />
      <div className="my-0.5 h-px w-10 bg-gray-200" />
      <ToolButton label="질문" icon="💬" active={panelOpen} onClick={togglePanel} />
      <ToolButton label="대시보드" icon="🏠" onClick={() => window.askkup.showDashboard()} />
      <ToolButton label="나가기" icon="✖️" onClick={() => window.askkup.closeOverlay()} />
    </div>
  )
}
