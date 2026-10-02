import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, errorMessage } from '../../api/client'
import type { AuthOut, Role } from '../../api/types'
import { roleHome, useAuth } from '../../stores/auth'
import { btnPrimary, card, errorText, input } from '../../lib/ui'

export default function SignupPage(): React.JSX.Element {
  const navigate = useNavigate()
  const login = useAuth((s) => s.login)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('student')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await api<AuthOut>('/api/auth/signup', { json: { email, password, name, role } })
      login(res.token, res.user)
      navigate(roleHome(res.user.role), { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-50 to-sky-50 p-6">
      <form onSubmit={submit} className={`${card} w-full max-w-sm space-y-4 p-8`}>
        <h1 className="text-center text-xl font-bold text-brand-700">회원가입</h1>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">이름</span>
          <input
            className={input}
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">이메일</span>
          <input
            className={input}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">비밀번호 (8자 이상)</span>
          <input
            className={input}
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <fieldset className="flex gap-6">
          <legend className="mb-1 text-sm text-gray-700">역할</legend>
          {(
            [
              ['student', '학생'],
              ['teacher', '교사']
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="role"
                checked={role === value}
                onChange={() => setRole(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {error && <p className={errorText}>{error}</p>}
        <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? '가입 중…' : '가입하기'}
        </button>
        <p className="text-center text-sm text-gray-600">
          이미 계정이 있나요?{' '}
          <Link to="/login" className="text-brand-600 hover:underline">
            로그인
          </Link>
        </p>
      </form>
    </div>
  )
}
