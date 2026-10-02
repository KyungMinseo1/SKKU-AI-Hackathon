import { useEffect, useState } from 'react'
import { apiBlobUrl, errorMessage } from '../api/client'
import type { StudentQuestionOut } from '../api/types'
import { formatDateTime } from '../lib/format'
import { questionTypeClass, questionTypeLabel } from '../lib/questionTypes'
import { card, errorText } from '../lib/ui'

const STATUS_LABEL: Record<StudentQuestionOut['status'], string> = {
  pending: '분류 중',
  classified: '분류 완료',
  failed: '분류 실패'
}

function CaptureImage({ questionId }: { questionId: number }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null
    apiBlobUrl(`/api/questions/${questionId}/capture`)
      .then((u) => {
        if (revoked) URL.revokeObjectURL(u)
        else {
          objectUrl = u
          setUrl(u)
        }
      })
      .catch((err) => setError(errorMessage(err)))
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [questionId])

  if (error) return <p className={errorText}>{error}</p>
  if (!url) return <p className="text-sm text-gray-400">캡처 이미지 불러오는 중…</p>
  return <img src={url} alt="질문 화면 캡처" className="w-full rounded-md border border-gray-200" />
}

export default function QuestionDetail({
  question: q
}: {
  question: StudentQuestionOut
}): React.JSX.Element {
  return (
    <aside className={`${card} w-96 shrink-0 space-y-3 overflow-y-auto text-sm`}>
      <div>
        <h3 className="text-xs text-gray-500">다듬은 질문</h3>
        <p className="whitespace-pre-wrap rounded-md bg-amber-50 p-2 text-gray-900">
          {q.refined_text}
        </p>
      </div>
      <div>
        <h3 className="text-xs text-gray-500">원래 입력</h3>
        <p className="whitespace-pre-wrap text-gray-700">
          {q.raw_text || '(텍스트 없음 – 화면 표시만 있음)'}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-gray-500">수업 주차</dt>
        <dd>
          {q.session_week.week_no}주차 · {q.session_week.title}
        </dd>
        <dt className="text-gray-500">배정 주차</dt>
        <dd>
          {q.assigned_week ? `${q.assigned_week.week_no}주차 · ${q.assigned_week.title}` : '-'}
          {q.off_week && (
            <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-800">
              다른 주차
            </span>
          )}
        </dd>
        {q.concept_path.length > 0 && (
          <>
            <dt className="text-gray-500">개념</dt>
            <dd>{q.concept_path.map((p) => p.title).join(' > ')}</dd>
          </>
        )}
        <dt className="text-gray-500">유형</dt>
        <dd>
          {q.status === 'pending' ? (
            <span className="text-gray-500">{STATUS_LABEL.pending}</span>
          ) : (
            <span
              className={`rounded border px-1.5 py-0.5 text-xs ${questionTypeClass(q.question_type)}`}
            >
              {questionTypeLabel(q.question_type)}
            </span>
          )}
        </dd>
        <dt className="text-gray-500">상태</dt>
        <dd>{STATUS_LABEL[q.status]}</dd>
        <dt className="text-gray-500">시각</dt>
        <dd>{formatDateTime(q.created_at)}</dd>
      </dl>
      {q.has_capture && <CaptureImage questionId={q.id} />}
    </aside>
  )
}
