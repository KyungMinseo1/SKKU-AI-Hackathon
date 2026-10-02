import { useEffect, useRef } from 'react'
import type { TeacherQuestionOut } from '../api/types'
import { formatTime } from '../lib/format'
import { questionTypeClass, questionTypeLabel } from '../lib/questionTypes'

/** Chronological chat-style feed (oldest on top); auto-scrolls to bottom when new items arrive. */
export default function QuestionFeed({
  questions
}: {
  questions: TeacherQuestionOut[]
}): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const sorted = [...questions].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id
  )
  const count = sorted.length

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [count])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h2 className="border-b border-gray-200 px-4 py-2 font-semibold">질문 ({count})</h2>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {count === 0 && <p className="text-sm text-gray-400">아직 질문이 없습니다.</p>}
        {sorted.map((q) => (
          <article key={q.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <time className="font-mono text-gray-500">{formatTime(q.created_at)}</time>
              <span
                className={`rounded border px-1.5 py-0.5 ${questionTypeClass(q.question_type)}`}
              >
                {questionTypeLabel(q.question_type)}
              </span>
              <span className="font-semibold text-gray-800">{q.keyword}</span>
              {q.off_week && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                  → {q.assigned_week.week_no}주차
                </span>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{q.refined_text}</p>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
