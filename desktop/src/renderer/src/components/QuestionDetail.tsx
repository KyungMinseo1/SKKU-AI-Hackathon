import { useEffect, useState } from 'react'
import { api, apiBlobUrl, errorMessage } from '../api/client'
import type { StudentQuestionOut } from '../api/types'
import { formatDateTime } from '../lib/format'
import { isRecallDue, useNow } from '../lib/recall'
import { questionTypeClass, questionTypeLabel } from '../lib/questionTypes'
import { btnPrimary, btnSecondary, card, errorText, input } from '../lib/ui'

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

/** Blinking call-to-action shown above the refined question while its recall quiz is waiting. */
export function RecallButton({
  label = '리콜 퀴즈가 도착했어요 · 지금 풀기',
  onClick
}: {
  label?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className="recall-blink flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      🧠 {label}
    </button>
  )
}

function DetailBody({
  question: q,
  large,
  recallDue,
  onRecall
}: {
  question: StudentQuestionOut
  large?: boolean
  recallDue: boolean
  onRecall: () => void
}): React.JSX.Element {
  return (
    <>
      {recallDue && <RecallButton onClick={onRecall} />}
      <div>
        <h3 className="text-xs text-gray-500">다듬은 질문</h3>
        <p
          className={`whitespace-pre-wrap rounded-md bg-brand-50 text-gray-900 ${
            large ? 'p-4 text-lg leading-relaxed' : 'p-2'
          }`}
        >
          {q.refined_text}
        </p>
      </div>
      {q.recall_answer && (
        <div>
          <h3 className="text-xs text-gray-500">
            내 리콜 답변
            {q.recall_answered_at && (
              <span className="ml-1 text-gray-400">· {formatDateTime(q.recall_answered_at)}</span>
            )}
          </h3>
          <p className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-2 text-gray-900">
            {q.recall_answer}
          </p>
        </div>
      )}
      {!large && q.memo && (
        <div>
          <h3 className="text-xs text-gray-500">내 메모</h3>
          <p className="line-clamp-3 whitespace-pre-wrap text-gray-700">{q.memo}</p>
        </div>
      )}
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
    </>
  )
}

function MemoEditor({
  question: q,
  onUpdated
}: {
  question: StudentQuestionOut
  onUpdated: (q: StudentQuestionOut) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(q.memo)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const dirty = draft !== q.memo

  const save = async (): Promise<void> => {
    if (!dirty) return
    setState('saving')
    setError(null)
    try {
      const updated = await api<StudentQuestionOut>(`/api/me/questions/${q.id}/memo`, {
        method: 'PATCH',
        json: { memo: draft }
      })
      onUpdated(updated)
      setState('saved')
    } catch (err) {
      setError(errorMessage(err))
      setState('idle')
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-gray-500">내 메모</h3>
        <span className="text-xs text-gray-400">
          {state === 'saving'
            ? '저장 중…'
            : dirty
              ? '저장되지 않음'
              : state === 'saved'
                ? '저장됨'
                : ''}
        </span>
      </div>
      <textarea
        className={`${input} min-h-28 resize-y`}
        placeholder="이 질문에 대해 기억하고 싶은 내용, 수업에서 들은 답 등을 적어 두세요"
        maxLength={4000}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setState('idle')
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void save()
          }
        }}
      />
      <div className="flex justify-end">
        <button
          className={btnSecondary}
          disabled={!dirty || state === 'saving'}
          onClick={() => void save()}
        >
          메모 저장
        </button>
      </div>
      {error && <p className={errorText}>{error}</p>}
    </div>
  )
}

/** Where the question came from: class, concept, what the student originally typed, the capture. */
function RecallContext({ question: q }: { question: StudentQuestionOut }): React.JSX.Element {
  const rows: [string, React.ReactNode][] = [
    ['수업', `${q.course.name} · ${q.session_week.week_no}주차 ${q.session_week.title}`],
    ['질문한 시각', formatDateTime(q.created_at)]
  ]
  if (q.assigned_week && q.off_week) {
    rows.push(['관련 주차', `${q.assigned_week.week_no}주차 · ${q.assigned_week.title}`])
  }
  if (q.concept_path.length > 0) {
    rows.push(['관련 개념', q.concept_path.map((p) => p.title).join(' › ')])
  }
  if (q.status !== 'pending') {
    rows.push([
      '질문 유형',
      <span
        key="type"
        className={`rounded border px-1.5 py-0.5 text-xs ${questionTypeClass(q.question_type)}`}
      >
        {questionTypeLabel(q.question_type)}
      </span>
    ])
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="mb-3 text-xs font-semibold text-gray-500">질문했던 상황</h3>
      <div className={q.has_capture ? 'grid grid-cols-[1fr_minmax(0,1.1fr)] gap-4' : ''}>
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="text-xs text-gray-500">그때 내가 적은 말</p>
            <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-gray-300 pl-2 text-gray-700">
              {q.raw_text || '(텍스트 없이 화면에 표시만 했어요)'}
            </blockquote>
          </div>
          {q.memo && (
            <div>
              <p className="text-xs text-gray-500">내 메모</p>
              <p className="mt-1 whitespace-pre-wrap text-gray-700">{q.memo}</p>
            </div>
          )}
        </div>
        {q.has_capture && (
          <div className="space-y-1">
            <p className="text-xs text-gray-500">그때 보던 화면</p>
            <CaptureImage questionId={q.id} />
          </div>
        )}
      </div>
    </section>
  )
}

/** Recall quiz: the student answers their own earlier question from memory. */
export function RecallQuiz({
  question: q,
  onUpdated,
  onDone
}: {
  question: StudentQuestionOut
  onUpdated: (q: StudentQuestionOut) => void
  onDone: () => void
}): React.JSX.Element {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api<StudentQuestionOut>(`/api/me/questions/${q.id}/recall`, {
        json: { answer: answer.trim() }
      })
      onUpdated(updated)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold tracking-wide text-amber-600">🧠 RECALL QUIZ</p>
        <h2 className="mt-1 text-lg font-semibold text-gray-900">
          수업 때 남긴 질문, 이제 스스로 답해볼까요?
        </h2>
      </div>
      <p className="whitespace-pre-wrap rounded-lg bg-brand-50 p-4 text-lg leading-relaxed text-gray-900">
        {q.refined_text}
      </p>
      <RecallContext question={q} />
      <textarea
        className={`${input} min-h-36 resize-y text-base`}
        autoFocus
        placeholder="정답이 아니어도 괜찮아요. 지금 기억나는 만큼 설명해 보세요."
        maxLength={4000}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      {error && <p className={errorText}>{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btnSecondary} onClick={onDone}>
          나중에
        </button>
        <button
          className={btnPrimary}
          disabled={busy || !answer.trim()}
          onClick={() => void submit()}
        >
          답변 저장
        </button>
      </div>
    </div>
  )
}

/** Centered modal shell; closes on backdrop click or Esc. */
export function Modal({
  onClose,
  children
}: {
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-8 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="relative max-h-full w-full max-w-4xl space-y-4 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-8 text-base shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-4 top-4 rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100"
          title="닫기 (Esc)"
          onClick={onClose}
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  )
}

/** Side panel for the selected question; clicking it opens an enlarged view with a memo editor. */
export default function QuestionDetail({
  question: q,
  onUpdated
}: {
  question: StudentQuestionOut
  onUpdated: (q: StudentQuestionOut) => void
}): React.JSX.Element {
  const [modal, setModal] = useState<'zoom' | 'recall' | null>(null)
  const now = useNow()
  const recallDue = isRecallDue(q, now)
  const close = (): void => setModal(null)

  return (
    <>
      <aside
        className={`${card} group relative w-96 shrink-0 cursor-zoom-in space-y-3 overflow-y-auto text-sm transition hover:border-brand-300 hover:shadow-md`}
        title="클릭해서 크게 보기"
        onClick={() => setModal('zoom')}
      >
        <span className="absolute right-3 top-3 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 opacity-0 transition group-hover:opacity-100">
          ⤢ 크게 보기 · 메모
        </span>
        <DetailBody question={q} recallDue={recallDue} onRecall={() => setModal('recall')} />
      </aside>
      {modal === 'zoom' && (
        <Modal onClose={close}>
          <DetailBody
            question={q}
            large
            recallDue={recallDue}
            onRecall={() => setModal('recall')}
          />
          <MemoEditor key={q.id} question={q} onUpdated={onUpdated} />
        </Modal>
      )}
      {modal === 'recall' && (
        <Modal onClose={close}>
          <RecallQuiz question={q} onUpdated={onUpdated} onDone={() => setModal('zoom')} />
        </Modal>
      )}
    </>
  )
}
