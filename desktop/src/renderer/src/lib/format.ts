const pad = (n: number): string => String(n).padStart(2, '0')

/** Server ISO string (UTC, `Z`) → local `HH:mm:ss`. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Server ISO string (UTC, `Z`) → local `YYYY-MM-DD HH:mm:ss`. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(iso)}`
}
