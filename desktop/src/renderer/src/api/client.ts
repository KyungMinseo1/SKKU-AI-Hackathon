import { useAuth } from '../stores/auth'

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

interface ApiOptions {
  method?: string
  json?: unknown
  form?: FormData
}

function detailText(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = body.detail
    if (typeof detail === 'string') return detail
    // FastAPI validation errors: [{msg, loc, ...}]
    if (Array.isArray(detail) && detail.length > 0) {
      const first: unknown = detail[0]
      if (first && typeof first === 'object' && 'msg' in first && typeof first.msg === 'string')
        return first.msg
    }
  }
  return `요청에 실패했습니다 (${status})`
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { serverUrl, token } = useAuth.getState()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (options.form) {
    body = options.form
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }

  let res: Response
  try {
    res = await fetch(`${serverUrl}${path}`, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body
    })
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 서버 주소를 확인해 주세요')
  }

  if (!res.ok) {
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      // non-JSON error body
    }
    if (res.status === 401 && token) {
      useAuth.getState().logout()
      window.location.hash = '#/login'
    }
    throw new ApiError(res.status, detailText(parsed, res.status))
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Fetch a binary resource with Bearer auth and return a blob URL (caller revokes). */
export async function apiBlobUrl(path: string): Promise<string> {
  const { serverUrl, token } = useAuth.getState()
  const res = await fetch(`${serverUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (!res.ok) throw new ApiError(res.status, `이미지를 불러올 수 없습니다 (${res.status})`)
  return URL.createObjectURL(await res.blob())
}

export function wsUrl(path: string): string {
  return `${useAuth.getState().serverUrl.replace(/^http/, 'ws')}${path}`
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.detail
  if (e instanceof Error) return e.message
  return String(e)
}
