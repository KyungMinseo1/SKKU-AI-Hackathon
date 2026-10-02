import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Role, UserOut } from '../api/types'

interface AuthState {
  serverUrl: string
  token: string | null
  user: UserOut | null
  setServerUrl: (url: string) => void
  login: (token: string, user: UserOut) => void
  logout: () => void
}

export const DEFAULT_SERVER_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export const roleHome = (role: Role): string => (role === 'teacher' ? '/teacher' : '/student')

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      token: null,
      user: null,
      setServerUrl: (url) =>
        set({ serverUrl: url.trim().replace(/\/+$/, '') || DEFAULT_SERVER_URL }),
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null })
    }),
    { name: 'askkup-auth' }
  )
)
