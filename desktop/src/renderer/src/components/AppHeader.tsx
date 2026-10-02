import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../stores/auth'
import { btnGhost } from '../lib/ui'

/** Top bar shared by main-window pages: title area, optional actions, user name + logout. */
export default function AppHeader({
  children,
  actions
}: {
  children: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  return (
    <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      {actions}
      <span className="text-sm text-gray-500">
        {user?.name} ({user?.role === 'teacher' ? '교사' : '학생'})
      </span>
      <button
        className={btnGhost}
        onClick={() => {
          logout()
          navigate('/login', { replace: true })
        }}
      >
        로그아웃
      </button>
    </header>
  )
}
