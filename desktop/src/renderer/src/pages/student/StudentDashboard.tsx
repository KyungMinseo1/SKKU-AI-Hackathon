import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../../api/client'
import type { SessionOut, StudentQuestionOut } from '../../api/types'
import AppHeader from '../../components/AppHeader'
import MindMap from '../../components/MindMap/MindMap'
import QuestionDetail from '../../components/QuestionDetail'
import { buildStudentTree, idOf, type MindNode } from '../../lib/trees'
import { btnPrimary, card, errorText, input } from '../../lib/ui'

function JoinCard(): React.JSX.Element {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const join = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const s = await api<SessionOut>('/api/sessions/join', {
        json: { code: code.trim().toUpperCase() }
      })
      window.askkup.openOverlay({
        sessionId: s.id,
        courseName: s.course_name,
        weekNo: s.week_no,
        weekTitle: s.week_title
      })
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
    </section>
  )
}

export default function StudentDashboard(): React.JSX.Element {
  const [questions, setQuestions] = useState<StudentQuestionOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [courseId, setCourseId] = useState<number | null>(null)
  const [mode, setMode] = useState<'concept' | 'type'>('concept')
  const [selected, setSelected] = useState<MindNode | null>(null)

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

  const pill = (active: boolean): string =>
    `px-3 py-1 text-sm ${active ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`
  const tabClass = (active: boolean): string =>
    `shrink-0 border-b-2 px-3 py-1.5 text-sm ${
      active
        ? 'border-indigo-600 font-semibold text-indigo-700'
        : 'border-transparent text-gray-600 hover:text-gray-900'
    }`

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <AppHeader>
        <h1 className="text-lg font-bold text-indigo-700">ASKKUP</h1>
        <span className="text-gray-500">학생</span>
      </AppHeader>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <JoinCard />
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
              {selectedQuestion && <QuestionDetail question={selectedQuestion} />}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
