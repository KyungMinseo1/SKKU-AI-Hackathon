import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, errorMessage, wsUrl } from '../../api/client'
import type { LiveMessage, SessionOut, TeacherQuestionOut } from '../../api/types'
import AppHeader from '../../components/AppHeader'
import MindMap from '../../components/MindMap/MindMap'
import QuestionFeed from '../../components/QuestionFeed'
import { buildLiveConceptTree, buildTypeTree } from '../../lib/trees'
import { useAuth } from '../../stores/auth'
import { btnDanger, errorText } from '../../lib/ui'

function upsert(list: TeacherQuestionOut[], q: TeacherQuestionOut): TeacherQuestionOut[] {
  const i = list.findIndex((x) => x.id === q.id)
  if (i === -1) return [...list, q]
  const next = [...list]
  next[i] = q
  return next
}

export default function LiveSessionPage(): React.JSX.Element {
  const sessionId = Number(useParams().sessionId)
  const navigate = useNavigate()
  const token = useAuth((s) => s.token)
  const [session, setSession] = useState<SessionOut | null>(null)
  const [questions, setQuestions] = useState<TeacherQuestionOut[]>([])
  const [mode, setMode] = useState<'concept' | 'type'>('concept')
  const [closed, setClosed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadQuestions = useCallback(
    () =>
      api<TeacherQuestionOut[]>(`/api/sessions/${sessionId}/questions`)
        .then(setQuestions)
        .catch((err) => setError(errorMessage(err))),
    [sessionId]
  )

  useEffect(() => {
    api<SessionOut>(`/api/sessions/${sessionId}`)
      .then((s) => {
        setSession(s)
        if (s.status === 'closed') setClosed(true)
      })
      .catch((err) => setError(errorMessage(err)))
    void loadQuestions()
  }, [sessionId, loadQuestions])

  // WebSocket with 2s reconnect; resync questions after each reconnect.
  useEffect(() => {
    if (!token) return
    let ws: WebSocket | null = null
    let retry: number | undefined
    let disposed = false
    let reconnecting = false

    const connect = (): void => {
      ws = new WebSocket(wsUrl(`/ws/sessions/${sessionId}?token=${encodeURIComponent(token)}`))
      ws.onopen = () => {
        if (reconnecting) void loadQuestions()
        reconnecting = false
      }
      ws.onmessage = (ev) => {
        let msg: LiveMessage
        try {
          msg = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (msg.type === 'question.created' || msg.type === 'question.updated') {
          const q = msg.question
          setQuestions((list) => upsert(list, q))
        } else if (msg.type === 'session.closed') {
          setClosed(true)
        }
      }
      ws.onclose = (ev) => {
        if (disposed || ev.code === 4403) return
        reconnecting = true
        retry = window.setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(retry)
      ws?.close()
    }
  }, [sessionId, token, loadQuestions])

  const tree = useMemo(() => {
    if (!session) return null
    return mode === 'concept'
      ? buildLiveConceptTree(session, questions)
      : buildTypeTree('질문 유형', questions)
  }, [session, questions, mode])

  const closeSession = async (): Promise<void> => {
    if (
      !session ||
      !window.confirm('수업을 종료할까요? 종료 후에는 학생이 질문을 등록할 수 없습니다.')
    )
      return
    try {
      await api(`/api/sessions/${session.id}/close`, { method: 'POST' })
      navigate(`/teacher/courses/${session.course_id}`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const toggleClass = (active: boolean): string =>
    `px-3 py-1 text-sm ${active ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <AppHeader
        actions={
          session && !closed ? (
            <button className={btnDanger} onClick={() => void closeSession()}>
              수업 종료
            </button>
          ) : undefined
        }
      >
        {session && (
          <>
            <button
              className="text-sm text-gray-500 hover:text-gray-800"
              onClick={() => navigate(`/teacher/courses/${session.course_id}`)}
            >
              ←
            </button>
            <h1 className="truncate text-lg font-bold">
              {session.course_name} · {session.week_no}주차 {session.week_title}
            </h1>
            <span className="rounded-lg bg-indigo-50 px-4 py-1 font-mono text-3xl font-bold tracking-[0.3em] text-indigo-700">
              {session.code}
            </span>
          </>
        )}
      </AppHeader>
      {closed && (
        <div className="bg-gray-800 px-6 py-2 text-sm text-white">
          수업이 종료되었습니다.{' '}
          {session && (
            <button
              className="underline"
              onClick={() => navigate(`/teacher/courses/${session.course_id}`)}
            >
              강의로 돌아가기
            </button>
          )}
        </div>
      )}
      {error && <p className={`${errorText} px-6 pt-2`}>{error}</p>}
      <main className="flex min-h-0 flex-1 gap-4 p-4">
        <section className="flex min-w-0 flex-[2] flex-col gap-2">
          <div className="inline-flex self-start overflow-hidden rounded-md border border-gray-300">
            <button className={toggleClass(mode === 'concept')} onClick={() => setMode('concept')}>
              개념별
            </button>
            <button className={toggleClass(mode === 'type')} onClick={() => setMode('type')}>
              유형별
            </button>
          </div>
          <div className="min-h-0 flex-1">{tree && <MindMap root={tree} height="100%" />}</div>
        </section>
        <section className="min-w-0 flex-1">
          <QuestionFeed questions={questions} />
        </section>
      </main>
    </div>
  )
}
