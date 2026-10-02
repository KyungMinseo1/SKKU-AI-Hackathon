import { useEffect, useState } from 'react'
import type { StudentQuestionOut } from '../api/types'

/** Current time, re-read every `intervalMs` so time-based UI (recall due) updates on its own. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** A question's recall quiz is waiting once its due time has passed and it has no answer yet. */
export function isRecallDue(q: StudentQuestionOut, now: number): boolean {
  return !q.recall_answer && Date.parse(q.recall_due_at) <= now
}
