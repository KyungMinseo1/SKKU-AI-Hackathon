import { useEffect, useState, type RefObject } from 'react'
import { api, errorMessage } from '../../../api/client'
import type { RefineOut, StudentQuestionOut } from '../../../api/types'
import { btnPrimary, btnSecondary, errorText, input } from '../../../lib/ui'
import { composeCapture } from './strokes'

type Phase =
  'compose' | 'refining' | 'review' | 'feedback' | 'submitting' | 'done' | 'blocked' | 'error'

interface QuestionPanelProps {
  sessionId: number
  strokeCount: number
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** Composited capture (screenshot + strokes), reused for re-refine and submit; cleared when strokes change. */
  capture: string | null
  setCapture: (capture: string) => void
  /** Clears strokes and capture after a successful submit. */
  onSubmitted: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export default function QuestionPanel({
  sessionId,
  strokeCount,
  canvasRef,
  capture,
  setCapture,
  onSubmitted,
  onMouseEnter,
  onMouseLeave
}: QuestionPanelProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('compose')
  const [text, setText] = useState('')
  const [refined, setRefined] = useState<string | null>(null)
  const [rounds, setRounds] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [reason, setReason] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [failedAction, setFailedAction] = useState<'refine' | 'refine-feedback' | 'submit'>(
    'refine'
  )

  // done → after 2s reset everything back to compose.
  useEffect(() => {
    if (phase !== 'done') return
    const timer = setTimeout(() => {
      setText('')
      setRefined(null)
      setRounds(0)
      setFeedback('')
      onSubmitted()
      setPhase('compose')
    }, 2000)
    return () => clearTimeout(timer)
  }, [phase, onSubmitted])

  const ensureCapture = async (): Promise<string | null> => {
    if (strokeCount === 0) return null
    if (capture) return capture
    const canvas = canvasRef.current
    if (!canvas) return null
    const screenshot = await window.askkup.captureScreen()
    const composed = await composeCapture(screenshot, canvas)
    setCapture(composed)
    return composed
  }

  const refine = async (withFeedback: boolean): Promise<void> => {
    setPhase('refining')
    try {
      const image = await ensureCapture()
      const res = await api<RefineOut>('/api/questions/refine', {
        json: {
          session_id: sessionId,
          raw_text: text,
          image,
          previous_refined: withFeedback ? refined : null,
          feedback: withFeedback ? feedback.trim() : null
        }
      })
      if (res.status === 'blocked') {
        setReason(res.reason ?? '질문을 등록할 수 없어요.')
        setPhase('blocked')
        return
      }
      setRefined(res.refined_text ?? '')
      setRounds((r) => (withFeedback ? r + 1 : 1))
      setFeedback('')
      setPhase('review')
    } catch (err) {
      setErrorMsg(errorMessage(err))
      setFailedAction(withFeedback ? 'refine-feedback' : 'refine')
      setPhase('error')
    }
  }

  const submit = async (): Promise<void> => {
    setPhase('submitting')
    try {
      const image = await ensureCapture()
      await api<StudentQuestionOut>('/api/questions', {
        json: {
          session_id: sessionId,
          raw_text: text,
          image,
          refined_text: refined,
          refine_rounds: rounds
        }
      })
      setPhase('done')
    } catch (err) {
      setErrorMsg(errorMessage(err))
      setFailedAction('submit')
      setPhase('error')
    }
  }

  const retry = (): void => {
    if (failedAction === 'submit') void submit()
    else void refine(failedAction === 'refine-feedback')
  }

  const refinedCard = refined && (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-gray-900">
      {refined}
    </div>
  )

  let body: React.JSX.Element
  switch (phase) {
    case 'compose':
      body = (
        <>
          <textarea
            className={`${input} min-h-28 resize-none`}
            autoFocus
            placeholder="궁금한 점을 대충 적어도 괜찮아요 (단어만 적어도 OK)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {strokeCount > 0 && (
            <p className="text-xs text-red-600">
              펜 표시 {strokeCount}개가 화면 캡처와 함께 전송됩니다
            </p>
          )}
          <button
            className={`${btnPrimary} w-full`}
            disabled={!text.trim() && strokeCount === 0}
            onClick={() => void refine(false)}
          >
            질문 다듬기
          </button>
        </>
      )
      break
    case 'refining':
    case 'submitting':
      body = (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-600">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          {phase === 'refining' ? '질문을 다듬고 있어요…' : '질문을 등록하고 있어요…'}
        </div>
      )
      break
    case 'review':
      body = (
        <>
          {refinedCard}
          <p className="text-sm font-medium text-gray-800">이 의미가 맞나요?</p>
          <div className="flex gap-2">
            <button className={`${btnPrimary} flex-1`} onClick={() => void submit()}>
              예, 등록할게요
            </button>
            <button className={`${btnSecondary} flex-1`} onClick={() => setPhase('feedback')}>
              아니요
            </button>
          </div>
        </>
      )
      break
    case 'feedback':
      body = (
        <>
          {refinedCard}
          <textarea
            className={`${input} min-h-20 resize-none`}
            autoFocus
            placeholder="어떻게 고치면 좋을까요?"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className={`${btnPrimary} flex-1`}
              disabled={!feedback.trim()}
              onClick={() => void refine(true)}
            >
              다시 다듬기
            </button>
            <button className={`${btnSecondary} flex-1`} onClick={() => setPhase('review')}>
              취소
            </button>
          </div>
        </>
      )
      break
    case 'done':
      body = <p className="py-6 text-center font-medium text-emerald-700">질문이 등록되었어요</p>
      break
    case 'blocked':
      body = (
        <>
          <p className={errorText}>{reason}</p>
          <button className={`${btnSecondary} w-full`} onClick={() => setPhase('compose')}>
            수정하기
          </button>
        </>
      )
      break
    case 'error':
      body = (
        <>
          <p className={errorText}>{errorMsg}</p>
          <div className="flex gap-2">
            <button className={`${btnPrimary} flex-1`} onClick={retry}>
              다시 시도
            </button>
            <button
              className={`${btnSecondary} flex-1`}
              onClick={() => setPhase(refined ? 'review' : 'compose')}
            >
              취소
            </button>
          </div>
        </>
      )
      break
  }

  return (
    <div
      className="fixed right-24 top-1/2 w-80 -translate-y-1/2 space-y-3 rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-xl"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <h2 className="text-sm font-semibold text-brand-700">질문하기</h2>
      {body}
    </div>
  )
}
