import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { api, errorMessage } from '../../api/client'
import type { AuthOut } from '../../api/types'
import { roleHome, useAuth } from '../../stores/auth'
import { btnPrimary, card, errorText, input } from '../../lib/ui'

export default function LoginPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { token, user, serverUrl, setServerUrl, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serverDraft, setServerDraft] = useState(serverUrl)
  const [showServer, setShowServer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (token && user) return <Navigate to={roleHome(user.role)} replace />

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    setServerUrl(serverDraft)
    try {
      const res = await api<AuthOut>('/api/auth/login', { json: { email, password } })
      login(res.token, res.user)
      navigate(roleHome(res.user.role), { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-indigo-50 to-sky-50 p-6">
      <form onSubmit={submit} className={`${card} w-full max-w-sm space-y-4 p-8`}>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-indigo-700">ASKKUP</h1>
          <p className="text-sm text-gray-500">질문, 잇다</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">이메일</span>
          <input
            className={input}
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">비밀번호</span>
          <input
            className={input}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div>
          <button
            type="button"
            className="text-xs text-gray-500 hover:text-gray-700"
            onClick={() => setShowServer((v) => !v)}
          >
            {showServer ? '▾' : '▸'} 서버 주소
          </button>
          {showServer && (
            <input
              className={`${input} mt-1`}
              value={serverDraft}
              onChange={(e) => setServerDraft(e.target.value)}
              placeholder="http://localhost:8000"
            />
          )}
        </div>
        {error && <p className={errorText}>{error}</p>}
        <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        <p className="text-center text-sm text-gray-600">
          계정이 없나요?{' '}
          <Link to="/signup" className="text-indigo-600 hover:underline">
            회원가입
          </Link>
        </p>
      </form>
    </div>
  )
}
