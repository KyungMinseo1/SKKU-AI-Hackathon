import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent
} from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, errorMessage } from '../../api/client'
import type {
  BannedWordOut,
  GraphOut,
  SessionOut,
  TeacherQuestionOut,
  WeekOut
} from '../../api/types'
import AppHeader from '../../components/AppHeader'
import MindMap from '../../components/MindMap/MindMap'
import NodeEditorPanel from '../../components/NodeEditorPanel'
import { buildCourseTree, buildWeekTree, type MindNode } from '../../lib/trees'
import { btn, btnPrimary, btnSecondary, card, errorText, input } from '../../lib/ui'

const uploadForm = (file: File): FormData => {
  const form = new FormData()
  form.append('file', file)
  return form
}

function genBadge(week: WeekOut): { text: string; className: string } | null {
  if (week.gen_status === 'running')
    return { text: '생성 중…', className: 'bg-yellow-100 text-yellow-800' }
  if (week.gen_status === 'failed')
    return { text: `실패: ${week.gen_error ?? ''}`, className: 'bg-red-100 text-red-700' }
  if (week.gen_status !== 'done') return null
  if (week.gen_source === 'material')
    return { text: '교안 기반', className: 'bg-emerald-100 text-emerald-800' }
  if (week.gen_source === 'web')
    return { text: '웹 검색 기반', className: 'bg-sky-100 text-sky-800' }
  if (week.gen_source === 'llm')
    return { text: 'AI 생성(검색 실패)', className: 'bg-purple-100 text-purple-800' }
  return null
}

function OpenSessionModal({
  graph,
  onClose
}: {
  graph: GraphOut
  onClose: () => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const weeks = useMemo(() => [...graph.weeks].sort((a, b) => a.week_no - b.week_no), [graph.weeks])
  const defaultWeekId = useMemo(() => {
    const lectures = weeks.filter((w) => w.is_lecture)
    const lastWeek = weeks.find((w) => w.id === graph.course.last_session_week_id)
    const next = lastWeek ? lectures.find((w) => w.week_no > lastWeek.week_no) : undefined
    return (next ?? lectures[0] ?? weeks[0])?.id
  }, [weeks, graph.course.last_session_week_id])
  const [weekId, setWeekId] = useState<number | undefined>(defaultWeekId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (weekId == null) return
    setBusy(true)
    setError(null)
    try {
      const session = await api<SessionOut>(`/api/courses/${graph.course.id}/sessions`, {
        json: { week_id: weekId }
      })
      navigate(`/teacher/sessions/${session.id}/live`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className={`${card} w-full max-w-md space-y-3 p-6`}
      >
        <h2 className="text-lg font-semibold">수업 열기</h2>
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">주차</span>
          <select
            className={input}
            value={weekId}
            onChange={(e) => setWeekId(Number(e.target.value))}
          >
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.week_no}주차 · {w.title}
                {w.is_lecture ? '' : ' (수업 없음)'}
              </option>
            ))}
          </select>
        </label>
        {error && <p className={errorText}>{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || weekId == null}>
            수업 시작
          </button>
        </div>
      </form>
    </div>
  )
}

function SyllabusCard({
  graph,
  onChanged
}: {
  graph: GraphOut
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const { course } = graph
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/courses/${course.id}/syllabus`, { form: uploadForm(file) })
      await onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    void upload(e.dataTransfer.files[0])
  }

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept=".pdf,application/pdf"
      className="hidden"
      onChange={(e) => void upload(e.target.files?.[0])}
    />
  )
  const reupload = (
    <button className={btnSecondary} disabled={busy} onClick={() => fileRef.current?.click()}>
      재업로드
    </button>
  )

  return (
    <section className={`${card} flex-1 space-y-2`}>
      <h2 className="font-semibold">실라버스</h2>
      {picker}
      {course.syllabus_status === 'none' && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`flex h-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed text-sm text-gray-500 ${
            dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300'
          }`}
        >
          {busy ? '업로드 중…' : '강의계획서 PDF를 끌어다 놓거나 클릭해서 업로드하세요'}
        </div>
      )}
      {course.syllabus_status === 'parsing' && (
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          실라버스 분석 중…
        </div>
      )}
      {course.syllabus_status === 'failed' && (
        <div className="space-y-2">
          <p className={errorText}>{course.syllabus_error ?? '실라버스 분석에 실패했습니다'}</p>
          {reupload}
        </div>
      )}
      {course.syllabus_status === 'done' && (
        <div className="flex items-center gap-3 text-sm">
          <span className="truncate text-gray-700">📄 {course.syllabus_filename}</span>
          {reupload}
        </div>
      )}
      {error && <p className={errorText}>{error}</p>}
    </section>
  )
}

function BannedWordsCard({ courseId }: { courseId: number }): React.JSX.Element {
  const [words, setWords] = useState<BannedWordOut[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api<BannedWordOut[]>(`/api/courses/${courseId}/banned-words`)
        .then(setWords)
        .catch((err) => setError(errorMessage(err))),
    [courseId]
  )

  useEffect(() => {
    void load()
  }, [load])

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!draft.trim()) return
    setError(null)
    try {
      await api(`/api/courses/${courseId}/banned-words`, { json: { word: draft.trim() } })
      setDraft('')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const remove = async (id: number): Promise<void> => {
    setError(null)
    try {
      await api(`/api/banned-words/${id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section className={`${card} flex-1 space-y-2`}>
      <h2 className="font-semibold">금지어</h2>
      <div className="flex flex-wrap gap-1.5">
        {words.length === 0 && (
          <span className="text-sm text-gray-400">등록된 금지어가 없습니다</span>
        )}
        {words.map((w) => (
          <span
            key={w.id}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-sm"
          >
            {w.word}
            <button
              className="text-gray-400 hover:text-red-600"
              onClick={() => void remove(w.id)}
              aria-label="삭제"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input
          className={input}
          placeholder="금지어 입력"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className={`${btnSecondary} shrink-0`} disabled={!draft.trim()}>
          추가
        </button>
      </form>
      {error && <p className={errorText}>{error}</p>}
    </section>
  )
}

function WeekControls({
  week,
  onChanged,
  showQuestions,
  setShowQuestions
}: {
  week: WeekOut
  onChanged: () => Promise<void>
  showQuestions: boolean
  setShowQuestions: (v: boolean) => void
}): React.JSX.Element {
  const [title, setTitle] = useState(week.title)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const badge = genBadge(week)

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const saveTitle = (): void => {
    const t = title.trim()
    if (!t || t === week.title) {
      setTitle(week.title)
      return
    }
    void run(() => api(`/api/weeks/${week.id}`, { method: 'PATCH', json: { title: t } }))
  }

  const uploadMaterials = (files: FileList | null): void => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    void run(async () => {
      for (const file of list)
        await api(`/api/weeks/${week.id}/materials`, { form: uploadForm(file) })
    }).finally(() => {
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-indigo-800">{week.week_no}주차</span>
        <input
          className={`${input} max-w-sm font-medium`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setTitle(week.title)
          }}
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={week.is_lecture}
            disabled={busy}
            onChange={(e) =>
              run(() =>
                api(`/api/weeks/${week.id}`, {
                  method: 'PATCH',
                  json: { is_lecture: e.target.checked }
                })
              )
            }
          />
          수업 주차
        </label>
        {!week.is_lecture && (
          <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">수업 없음</span>
        )}
        {badge && (
          <span className={`rounded px-2 py-0.5 text-xs ${badge.className}`}>{badge.text}</span>
        )}
        <button
          className={btnSecondary}
          disabled={busy || week.gen_status === 'running'}
          onClick={() => run(() => api(`/api/weeks/${week.id}/regenerate`, { method: 'POST' }))}
        >
          다시 생성
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={showQuestions}
            onChange={(e) => setShowQuestions(e.target.checked)}
          />
          질문 보기
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">교안:</span>
        {week.materials.length === 0 && <span className="text-gray-400">없음</span>}
        {week.materials.map((m) => (
          <span
            key={m.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5"
          >
            <span>{m.filename}</span>
            <span
              className={
                m.status === 'done'
                  ? 'text-emerald-700'
                  : m.status === 'failed'
                    ? 'text-red-600'
                    : 'text-yellow-700'
              }
              title={m.error ?? undefined}
            >
              {m.status === 'done'
                ? `완료 (${m.page_count}p)`
                : m.status === 'failed'
                  ? `실패: ${m.error ?? ''}`
                  : '처리 중…'}
            </span>
            <button
              className="text-gray-400 hover:text-red-600"
              disabled={busy}
              aria-label="교안 삭제"
              onClick={() => {
                if (window.confirm(`${m.filename} 교안을 삭제할까요?`))
                  void run(() => api(`/api/materials/${m.id}`, { method: 'DELETE' }))
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.pptx"
          className="hidden"
          onChange={(e) => uploadMaterials(e.target.files)}
        />
        <button className={btnSecondary} disabled={busy} onClick={() => fileRef.current?.click()}>
          교안 업로드
        </button>
      </div>
      {week.gen_status === 'failed' && week.gen_error && (
        <p className={errorText}>{week.gen_error}</p>
      )}
      {error && <p className={errorText}>{error}</p>}
    </section>
  )
}

export default function CoursePage(): React.JSX.Element {
  const courseId = Number(useParams().courseId)
  const navigate = useNavigate()
  const [graph, setGraph] = useState<GraphOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | number>('all')
  const [selected, setSelected] = useState<MindNode | null>(null)
  const [showQuestions, setShowQuestions] = useState(false)
  const [questions, setQuestions] = useState<TeacherQuestionOut[]>([])
  const [showSessionModal, setShowSessionModal] = useState(false)
  const [newWeekTitle, setNewWeekTitle] = useState<string | null>(null)

  const loadGraph = useCallback(
    () =>
      api<GraphOut>(`/api/courses/${courseId}/graph`)
        .then((g) => {
          setGraph(g)
          setError(null)
        })
        .catch((err) => setError(errorMessage(err))),
    [courseId]
  )

  const loadQuestions = useCallback(
    () =>
      api<TeacherQuestionOut[]>(`/api/courses/${courseId}/questions`)
        .then(setQuestions)
        .catch((err) => setError(errorMessage(err))),
    [courseId]
  )

  const reload = useCallback(async () => {
    await Promise.all([loadGraph(), showQuestions ? loadQuestions() : Promise.resolve()])
  }, [loadGraph, loadQuestions, showQuestions])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  useEffect(() => {
    if (showQuestions) void loadQuestions()
  }, [showQuestions, loadQuestions])

  const busyBackground =
    !!graph &&
    (graph.course.syllabus_status === 'parsing' ||
      graph.weeks.some(
        (w) => w.gen_status === 'running' || w.materials.some((m) => m.status === 'processing')
      ))

  useEffect(() => {
    if (!busyBackground) return
    const timer = setInterval(() => void loadGraph(), 2000)
    return () => clearInterval(timer)
  }, [busyBackground, loadGraph])

  const weeks = useMemo(
    () => (graph ? [...graph.weeks].sort((a, b) => a.week_no - b.week_no) : []),
    [graph]
  )
  const activeWeek = tab === 'all' ? undefined : weeks.find((w) => w.id === tab)
  const effectiveTab = activeWeek ? activeWeek.id : 'all'

  const tree = useMemo(() => {
    if (!graph) return null
    if (effectiveTab === 'all') return buildCourseTree(graph)
    return buildWeekTree(graph, effectiveTab, showQuestions ? questions : undefined)
  }, [graph, effectiveTab, showQuestions, questions])

  const addWeek = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const title = newWeekTitle?.trim()
    if (!title) return
    try {
      const week = await api<WeekOut>(`/api/courses/${courseId}/weeks`, { json: { title } })
      await loadGraph()
      setTab(week.id)
      setSelected(null)
      setNewWeekTitle(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (!graph) {
    return (
      <div className="p-6">
        {error ? (
          <p className={errorText}>{error}</p>
        ) : (
          <p className="text-gray-500">불러오는 중…</p>
        )}
        <Link to="/teacher" className="text-indigo-600 hover:underline">
          ← 강의 목록
        </Link>
      </div>
    )
  }

  const sessionButton = graph.open_session ? (
    <button
      className={`${btn} bg-red-600 text-white hover:bg-red-700`}
      onClick={() => navigate(`/teacher/sessions/${graph.open_session!.id}/live`)}
    >
      진행 중인 수업 보기 (코드 {graph.open_session.code})
    </button>
  ) : (
    <span title={weeks.length === 0 ? '주차를 먼저 만들어 주세요' : undefined}>
      <button
        className={btnPrimary}
        disabled={weeks.length === 0}
        onClick={() => setShowSessionModal(true)}
      >
        수업 열기
      </button>
    </span>
  )

  const tabClass = (active: boolean): string =>
    `shrink-0 rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
      active
        ? 'border-indigo-600 font-semibold text-indigo-700'
        : 'border-transparent text-gray-600 hover:text-gray-900'
    }`

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <AppHeader actions={sessionButton}>
        <Link to="/teacher" className="text-sm text-gray-500 hover:text-gray-800">
          ← 강의 목록
        </Link>
        <h1 className="truncate text-lg font-bold">{graph.course.name}</h1>
        <span className="text-sm text-gray-500">
          {[graph.course.code, graph.course.semester].filter(Boolean).join(' · ')}
        </span>
      </AppHeader>
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {error && <p className={errorText}>{error}</p>}
        <div className="flex gap-3">
          <SyllabusCard graph={graph} onChanged={loadGraph} />
          <BannedWordsCard courseId={courseId} />
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-gray-200">
          <button
            className={tabClass(effectiveTab === 'all')}
            onClick={() => {
              setTab('all')
              setSelected(null)
            }}
          >
            전체
          </button>
          {weeks.map((w) => (
            <button
              key={w.id}
              className={tabClass(effectiveTab === w.id)}
              onClick={() => {
                setTab(w.id)
                setSelected(null)
              }}
            >
              {w.week_no}주차
            </button>
          ))}
          {newWeekTitle === null ? (
            <button className={tabClass(false)} onClick={() => setNewWeekTitle('')}>
              + 주차 추가
            </button>
          ) : (
            <form onSubmit={addWeek} className="flex shrink-0 items-center gap-1 pb-1">
              <input
                className={`${input} w-48`}
                autoFocus
                placeholder="새 주차 제목"
                value={newWeekTitle}
                onChange={(e) => setNewWeekTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setNewWeekTitle(null)}
              />
              <button type="submit" className={btnPrimary} disabled={!newWeekTitle.trim()}>
                추가
              </button>
              <button type="button" className={btnSecondary} onClick={() => setNewWeekTitle(null)}>
                취소
              </button>
            </form>
          )}
        </nav>
        {activeWeek && (
          <WeekControls
            key={`${activeWeek.id}:${activeWeek.title}`}
            week={activeWeek}
            onChanged={reload}
            showQuestions={showQuestions}
            setShowQuestions={setShowQuestions}
          />
        )}
        <div className="flex min-h-[520px] flex-1 gap-3">
          <div className="min-w-0 flex-1">
            {tree ? (
              <MindMap root={tree} selectedId={selected?.id} onSelect={setSelected} height="100%" />
            ) : (
              <p className="text-gray-500">주차가 없습니다.</p>
            )}
          </div>
          <NodeEditorPanel
            graph={graph}
            selected={selected}
            questions={questions}
            onChanged={reload}
            onDeselect={() => setSelected(null)}
          />
        </div>
      </main>
      {showSessionModal && (
        <OpenSessionModal graph={graph} onClose={() => setShowSessionModal(false)} />
      )}
    </div>
  )
}
