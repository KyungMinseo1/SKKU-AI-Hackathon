import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../../api/client'
import type { SessionOut, StudentQuestionOut } from '../../api/types'
import AppHeader from '../../components/AppHeader'
import MindMap from '../../components/MindMap/MindMap'
import QuestionDetail, { Modal, RecallButton, RecallQuiz } from '../../components/QuestionDetail'
import { isRecallDue, useNow } from '../../lib/recall'
import { formatDateTime } from '../../lib/format'
import { buildStudentTree, idOf, type MindNode } from '../../lib/trees'
import { btnPrimary, btnSecondary, card, errorText, input } from '../../lib/ui'
import Logo from '../../components/Logo'

async function enterSession(code: string): Promise<void> {
  const s = await api<SessionOut>('/api/sessions/join', {
    json: { code: code.trim().toUpperCase() }
  })
  window.askkup.openOverlay({
    sessionId: s.id,
    courseName: s.course_name,
    weekNo: s.week_no,
    weekTitle: s.week_title
  })
}

/** Sessions the student joined (or asked in): open ones can be re-entered without typing the code. */
function MySessions({
  onViewCourse
}: {
  onViewCourse: (courseId: number) => void
}): React.JSX.Element | null {
  const [sessions, setSessions] = useState<SessionOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api<SessionOut[]>('/api/me/sessions')
        .then(setSessions)
        .catch((err) => setError(errorMessage(err))),
    []
  )
  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  if (!sessions?.length && !error) return null
  return (
    <div className="space-y-1.5 pt-2">
      <h3 className="text-sm font-medium text-gray-600">참여한 수업</h3>
      {error && <p className={errorText}>{error}</p>}
      <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
        {sessions?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${s.status === 'open' ? 'bg-brand-500' : 'bg-gray-300'}`}
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{s.course_name}</span>
              <span className="text-gray-500">
                {' '}
                · {s.week_no}주차 {s.week_title}
              </span>
            </span>
            <span className="shrink-0 text-xs text-gray-400">{formatDateTime(s.opened_at)}</span>
            {s.status === 'open' ? (
              <button
                className={`${btnPrimary} shrink-0 py-1 text-xs`}
                onClick={() =>
                  enterSession(s.code).catch((err) => {
                    setError(errorMessage(err))
                    void load()
                  })
                }
              >
                다시 들어가기
              </button>
            ) : (
              <button
                className={`${btnSecondary} shrink-0 py-1 text-xs`}
                title="종료된 수업입니다. 이 과목에서 남긴 질문을 봅니다"
                onClick={() => onViewCourse(s.course_id)}
              >
                종료됨 · 질문 보기
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function JoinCard({
  onViewCourse
}: {
  onViewCourse: (courseId: number) => void
}): React.JSX.Element {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const join = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await enterSession(code)
      setCode('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${card} space-y-2`}>
      <h2 className="font-semibold">수업 참여</h2>
      <form onSubmit={join} className="flex gap-2">
        <input
          className={`${input} max-w-xs font-mono text-lg tracking-[0.3em] uppercase`}
          placeholder="수업 코드 6자리"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button type="submit" className={btnPrimary} disabled={busy || code.trim().length !== 6}>
          참여하기
        </button>
      </form>
      {error && <p className={errorText}>{error}</p>}
      <MySessions onViewCourse={onViewCourse} />
    </section>
  )
}

export default function StudentDashboard(): React.JSX.Element {
  const [questions, setQuestions] = useState<StudentQuestionOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [courseId, setCourseId] = useState<number | null>(null)
  const [mode, setMode] = useState<'concept' | 'type'>('concept')
  const [selected, setSelected] = useState<MindNode | null>(null)
  const [recallId, setRecallId] = useState<number | null>(null)
  const now = useNow()

  const replaceQuestion = useCallback((q: StudentQuestionOut) => {
    setQuestions((list) => list?.map((x) => (x.id === q.id ? q : x)) ?? list)
  }, [])

  const load = useCallback(
    () =>
      api<StudentQuestionOut[]>('/api/me/questions')
        .then((list) => {
          setQuestions(list)
          setError(null)
        })
        .catch((err) => setError(errorMessage(err))),
    []
  )

  useEffect(() => {
    void load()
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)
    const unsubscribe = window.askkup.onOverlayClosed(() => void load())
    return () => {
      window.removeEventListener('focus', onFocus)
      unsubscribe()
    }
  }, [load])

  const hasPending = !!questions?.some((q) => q.status === 'pending')
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => void load(), 5000)
    return () => clearInterval(timer)
  }, [hasPending, load])

  const courses = useMemo(() => {
    const seen = new Map<number, { id: number; name: string }>()
    for (const q of questions ?? []) if (!seen.has(q.course.id)) seen.set(q.course.id, q.course)
    return [...seen.values()]
  }, [questions])

  const activeCourse = courses.find((c) => c.id === courseId) ?? courses[0]
  const courseQuestions = useMemo(
    () => (activeCourse ? (questions ?? []).filter((q) => q.course.id === activeCourse.id) : []),
    [questions, activeCourse]
  )
  const tree = useMemo(
    () => (activeCourse ? buildStudentTree(activeCourse, courseQuestions, mode) : null),
    [activeCourse, courseQuestions, mode]
  )
  const selectedQuestionId = selected ? idOf(selected.id, 'q') : null
  const selectedQuestion = courseQuestions.find((q) => q.id === selectedQuestionId)

  const dueRecalls = (questions ?? []).filter((q) => isRecallDue(q, now))
  const recallQuestion = questions?.find((q) => q.id === recallId)

  const pill = (active: boolean): string =>
    `px-3 py-1 text-sm ${active ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`
  const tabClass = (active: boolean): string =>
    `shrink-0 border-b-2 px-3 py-1.5 text-sm ${
      active
        ? 'border-brand-600 font-semibold text-brand-700'
        : 'border-transparent text-gray-600 hover:text-gray-900'
    }`

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <AppHeader>
        <Logo />
        <span className="text-gray-500">학생</span>
      </AppHeader>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <JoinCard
          onViewCourse={(id) => {
            setCourseId(id)
            setSelected(null)
          }}
        />
        <section className="flex min-h-[520px] flex-1 flex-col gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">내 질문</h2>
            <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
              <button className={pill(mode === 'concept')} onClick={() => setMode('concept')}>
                주제별
              </button>
              <button className={pill(mode === 'type')} onClick={() => setMode('type')}>
                유형별
              </button>
            </div>
            {dueRecalls.length > 0 && (
              <div className="ml-auto">
                <RecallButton
                  label={`리콜 퀴즈 ${dueRecalls.length}개 대기 중`}
                  onClick={() => setRecallId(dueRecalls[0].id)}
                />
              </div>
            )}
          </div>
          {error && <p className={errorText}>{error}</p>}
          {questions === null && !error && <p className="text-gray-500">불러오는 중…</p>}
          {questions?.length === 0 && <p className="text-gray-500">아직 등록한 질문이 없습니다.</p>}
          {courses.length > 0 && (
            <nav className="flex gap-1 overflow-x-auto border-b border-gray-200">
              {courses.map((c) => (
                <button
                  key={c.id}
                  className={tabClass(c.id === activeCourse?.id)}
                  onClick={() => {
                    setCourseId(c.id)
                    setSelected(null)
                  }}
                >
                  {c.name}
                </button>
              ))}
            </nav>
          )}
          {tree && (
            <div className="flex min-h-0 flex-1 gap-3">
              <div className="min-w-0 flex-1">
                <MindMap
                  key={`${tree.id}:${mode}`}
                  root={tree}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                  height="100%"
                />
              </div>
              {selectedQuestion && (
                <QuestionDetail question={selectedQuestion} onUpdated={replaceQuestion} />
              )}
            </div>
          )}
        </section>
      </main>
      {recallQuestion && (
        <Modal onClose={() => setRecallId(null)}>
          <RecallQuiz
            question={recallQuestion}
            onUpdated={replaceQuestion}
            onDone={() => setRecallId(null)}
          />
        </Modal>
      )}
    </div>
  )
}
