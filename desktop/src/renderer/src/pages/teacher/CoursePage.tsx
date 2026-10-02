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
  SessionSummary,
  TeacherQuestionOut,
  WeekOut
} from '../../api/types'
import AppHeader from '../../components/AppHeader'
import MindMap from '../../components/MindMap/MindMap'
import NodeEditorPanel from '../../components/NodeEditorPanel'
import { buildCourseTree, buildWeekTree, idOf, type MindNode } from '../../lib/trees'
import { formatDateTime } from '../../lib/format'
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
            dragOver ? 'border-brand-500 bg-brand-50' : 'border-gray-300'
          }`}
        >
          {busy ? '업로드 중…' : '강의계획서 PDF를 끌어다 놓거나 클릭해서 업로드하세요'}
        </div>
      )}
      {course.syllabus_status === 'parsing' && (
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
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

/** Past and current sessions: open any to review its questions, reopen a finished one. */
function SessionHistoryCard({
  courseId,
  hasOpenSession
}: {
  courseId: number
  hasOpenSession: boolean
}): React.JSX.Element {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<SessionSummary[]>(`/api/courses/${courseId}/sessions`)
      .then(setSessions)
      .catch((err) => setError(errorMessage(err)))
  }, [courseId, hasOpenSession])

  const reopen = async (s: SessionSummary): Promise<void> => {
    try {
      const opened = await api<SessionOut>(`/api/sessions/${s.id}/reopen`, { method: 'POST' })
      navigate(`/teacher/sessions/${opened.id}/live`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section className={`${card} flex-1 space-y-2`}>
      <h2 className="font-semibold">수업 기록</h2>
      {error && <p className={errorText}>{error}</p>}
      {sessions?.length === 0 && <p className="text-sm text-gray-400">아직 연 수업이 없습니다.</p>}
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {sessions?.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-gray-50"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${s.status === 'open' ? 'bg-red-500' : 'bg-gray-300'}`}
            />
            <button
              className="min-w-0 flex-1 truncate text-left"
              title="수업 화면에서 질문 보기"
              onClick={() => navigate(`/teacher/sessions/${s.id}/live`)}
            >
              <span className="font-medium">{s.week_no}주차</span>
              <span className="text-gray-500"> · {formatDateTime(s.opened_at).slice(0, 16)}</span>
            </button>
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">
              💬 {s.question_count}
            </span>
            {s.status === 'closed' && (
              <button
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-gray-300"
                disabled={hasOpenSession}
                title={
                  hasOpenSession ? '진행 중인 수업을 먼저 종료해 주세요' : '이 수업을 다시 엽니다'
                }
                onClick={() => void reopen(s)}
              >
                다시 열기
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function WeekControls({
  week,
  onChanged
}: {
  week: WeekOut
  onChanged: () => Promise<void>
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
        <span className="font-semibold text-brand-800">{week.week_no}주차</span>
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
  const [showQuestions, setShowQuestions] = useState(true)
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
    if (effectiveTab === 'all') return buildCourseTree(graph, showQuestions ? questions : undefined)
    return buildWeekTree(graph, effectiveTab, showQuestions ? questions : undefined)
  }, [graph, effectiveTab, showQuestions, questions])

  const canMove = useCallback(
    (node: MindNode) => idOf(node.id, 'node') != null || idOf(node.id, 'q') != null,
    []
  )
  const canDrop = useCallback((node: MindNode, target: MindNode) => {
    if (idOf(target.id, 'node') == null && idOf(target.id, 'week') == null) return false
    if (target.children.some((c) => c.id === node.id)) return false // already there
    const inSubtree = (n: MindNode): boolean => n.id === target.id || n.children.some(inSubtree)
    return !inSubtree(node)
  }, [])

  const moveNode = useCallback(
    async (node: MindNode, target: MindNode) => {
      if (!graph) return
      const targetNode = idOf(target.id, 'node')
      const targetWeek =
        targetNode != null
          ? graph.weeks.find((w) => w.nodes.some((n) => n.id === targetNode))?.id
          : idOf(target.id, 'week')
      const questionId = idOf(node.id, 'q')
      const nodeId = idOf(node.id, 'node')
      try {
        if (questionId != null) {
          await api(`/api/teacher-questions/${questionId}`, {
            method: 'PATCH',
            json: targetNode != null ? { concept_node_id: targetNode } : { week_id: targetWeek }
          })
        } else if (nodeId != null) {
          await api(`/api/nodes/${nodeId}`, {
            method: 'PATCH',
            json: { parent_id: targetNode, week_id: targetWeek }
          })
        }
        await Promise.all([loadGraph(), loadQuestions()])
      } catch (err) {
        setError(errorMessage(err))
      }
    },
    [graph, loadGraph, loadQuestions]
  )

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
        <Link to="/teacher" className="text-brand-600 hover:underline">
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
        ? 'border-brand-600 font-semibold text-brand-700'
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
          <SessionHistoryCard courseId={courseId} hasOpenSession={!!graph.open_session} />
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
          <label className="ml-auto flex shrink-0 items-center gap-1.5 pb-1 text-sm">
            <input
              type="checkbox"
              checked={showQuestions}
              onChange={(e) => setShowQuestions(e.target.checked)}
            />
            학생 질문 보기
          </label>
        </nav>
        {activeWeek && (
          <WeekControls
            key={`${activeWeek.id}:${activeWeek.title}`}
            week={activeWeek}
            onChanged={reload}
          />
        )}
        <div className="flex min-h-[520px] flex-1 gap-3">
          <div className="min-w-0 flex-1">
            {tree ? (
              <MindMap
                root={tree}
                selectedId={selected?.id}
                onSelect={setSelected}
                height="100%"
                markQuestions
                onMoveNode={(node, target) => void moveNode(node, target)}
                canMove={canMove}
                canDrop={canDrop}
              />
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
