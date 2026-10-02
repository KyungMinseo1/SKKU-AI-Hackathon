import { useMemo, useState } from 'react'
import { api, errorMessage } from '../api/client'
import type { GraphOut, NodeOut, TeacherQuestionOut, WeekOut } from '../api/types'
import { idOf, type MindNode } from '../lib/trees'
import { questionTypeClass, questionTypeLabel } from '../lib/questionTypes'
import { formatDateTime } from '../lib/format'
import { btnDanger, btnPrimary, btnSecondary, card, errorText, input } from '../lib/ui'

interface PanelProps {
  graph: GraphOut
  selected: MindNode | null
  questions: TeacherQuestionOut[]
  /** Called after every mutation; parent refetches the graph. */
  onChanged: () => Promise<void> | void
  onDeselect: () => void
}

type Run = (fn: () => Promise<unknown>) => Promise<void>

function useRunner(onChanged: PanelProps['onChanged']): {
  run: Run
  busy: boolean
  error: string | null
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run: Run = async (fn) => {
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
  return { run, busy, error }
}

function AddNodeForm({
  label,
  placeholder,
  onAdd,
  busy
}: {
  label: string
  placeholder: string
  onAdd: (title: string) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!title.trim()) return
        await onAdd(title.trim())
        setTitle('')
      }}
    >
      <input
        className={input}
        placeholder={placeholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" className={`${btnSecondary} shrink-0`} disabled={busy || !title.trim()}>
        {label}
      </button>
    </form>
  )
}

function WeekEditor({
  week,
  onChanged,
  onDeselect
}: { week: WeekOut } & Pick<PanelProps, 'onChanged' | 'onDeselect'>): React.JSX.Element {
  const { run, busy, error } = useRunner(onChanged)
  const [title, setTitle] = useState(week.title)
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-brand-800">{week.week_no}주차</h3>
      <label className="block space-y-1">
        <span className="text-xs text-gray-600">제목</span>
        <div className="flex gap-2">
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button
            className={`${btnPrimary} shrink-0`}
            disabled={busy || !title.trim() || title.trim() === week.title}
            onClick={() =>
              run(() =>
                api(`/api/weeks/${week.id}`, { method: 'PATCH', json: { title: title.trim() } })
              )
            }
          >
            저장
          </button>
        </div>
      </label>
      <label className="flex items-center gap-2 text-sm">
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
      <div className="flex flex-wrap gap-2">
        <button
          className={btnSecondary}
          disabled={busy || week.gen_status === 'running'}
          onClick={() => run(() => api(`/api/weeks/${week.id}/regenerate`, { method: 'POST' }))}
        >
          다시 생성
        </button>
        <button
          className={btnDanger}
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`${week.week_no}주차를 삭제할까요?`)) return
            void run(async () => {
              await api(`/api/weeks/${week.id}`, { method: 'DELETE' })
              onDeselect()
            })
          }}
        >
          주차 삭제
        </button>
      </div>
      <div className="space-y-1 border-t border-gray-100 pt-3">
        <span className="text-xs text-gray-600">주제 추가</span>
        <AddNodeForm
          label="주제 추가"
          placeholder="새 주제 이름"
          busy={busy}
          onAdd={(t) =>
            run(() => api(`/api/weeks/${week.id}/nodes`, { json: { parent_id: null, title: t } }))
          }
        />
      </div>
      {error && <p className={errorText}>{error}</p>}
    </div>
  )
}

/** Ids of `nodeId` and all its descendants within the week. */
function subtreeIds(nodes: NodeOut[], nodeId: number): Set<number> {
  const ids = new Set([nodeId])
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) {
      if (n.parent_id != null && ids.has(n.parent_id) && !ids.has(n.id)) {
        ids.add(n.id)
        grew = true
      }
    }
  }
  return ids
}

function ConceptEditor({
  graph,
  week,
  node,
  onChanged,
  onDeselect
}: { graph: GraphOut; week: WeekOut; node: NodeOut } & Pick<
  PanelProps,
  'onChanged' | 'onDeselect'
>): React.JSX.Element {
  const { run, busy, error } = useRunner(onChanged)
  const [title, setTitle] = useState(node.title)
  const [summary, setSummary] = useState(node.summary)
  const [moveWeekId, setMoveWeekId] = useState(week.id)
  const [moveParent, setMoveParent] = useState<string>(
    node.parent_id == null ? '' : String(node.parent_id)
  )

  const moveWeek = graph.weeks.find((w) => w.id === moveWeekId) ?? week
  const parentOptions = useMemo(() => {
    const excluded = moveWeek.id === week.id ? subtreeIds(week.nodes, node.id) : new Set<number>()
    return moveWeek.nodes.filter((n) => !excluded.has(n.id))
  }, [moveWeek, week, node.id])

  const dirty = title.trim() !== node.title || summary !== node.summary
  const moveChanged =
    moveWeekId !== week.id || moveParent !== (node.parent_id == null ? '' : String(node.parent_id))

  const move = async (): Promise<void> => {
    const parentId = moveParent === '' ? null : Number(moveParent)
    if (moveWeekId !== week.id) {
      // Changing week moves the whole subtree and resets the parent to null on the server.
      await api(`/api/nodes/${node.id}`, { method: 'PATCH', json: { week_id: moveWeekId } })
      if (parentId != null)
        await api(`/api/nodes/${node.id}`, { method: 'PATCH', json: { parent_id: parentId } })
    } else {
      await api(`/api/nodes/${node.id}`, { method: 'PATCH', json: { parent_id: parentId } })
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-emerald-800">
        {node.parent_id == null ? '주제' : '개념'} · {week.week_no}주차
      </h3>
      <label className="block space-y-1">
        <span className="text-xs text-gray-600">제목</span>
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-gray-600">요약</span>
        <textarea
          className={`${input} min-h-20`}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className={btnPrimary}
          disabled={busy || !dirty || !title.trim()}
          onClick={() =>
            run(() =>
              api(`/api/nodes/${node.id}`, {
                method: 'PATCH',
                json: { title: title.trim(), summary }
              })
            )
          }
        >
          저장
        </button>
        <button
          className={btnDanger}
          disabled={busy}
          onClick={() => {
            if (!window.confirm('하위 개념도 함께 삭제됩니다')) return
            void run(async () => {
              await api(`/api/nodes/${node.id}`, { method: 'DELETE' })
              onDeselect()
            })
          }}
        >
          삭제
        </button>
      </div>
      <div className="space-y-1 border-t border-gray-100 pt-3">
        <span className="text-xs text-gray-600">하위 개념 추가</span>
        <AddNodeForm
          label="하위 개념 추가"
          placeholder="새 개념 이름"
          busy={busy}
          onAdd={(t) =>
            run(() =>
              api(`/api/weeks/${week.id}/nodes`, { json: { parent_id: node.id, title: t } })
            )
          }
        />
      </div>
      <div className="space-y-2 border-t border-gray-100 pt-3">
        <span className="text-xs text-gray-600">이동</span>
        <select
          className={input}
          value={moveWeekId}
          onChange={(e) => {
            setMoveWeekId(Number(e.target.value))
            setMoveParent('')
          }}
        >
          {graph.weeks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.week_no}주차 · {w.title}
            </option>
          ))}
        </select>
        <select
          className={input}
          value={moveParent}
          onChange={(e) => setMoveParent(e.target.value)}
        >
          <option value="">주차 최상위</option>
          {parentOptions.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
        <button className={btnSecondary} disabled={busy || !moveChanged} onClick={() => run(move)}>
          이동
        </button>
      </div>
      {error && <p className={errorText}>{error}</p>}
    </div>
  )
}

function QuestionView({ q }: { q: TeacherQuestionOut }): React.JSX.Element {
  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-semibold text-amber-700">질문</h3>
      <p className="whitespace-pre-wrap rounded-md bg-amber-50 p-2">{q.refined_text}</p>
      <p>
        <span
          className={`rounded border px-1.5 py-0.5 text-xs ${questionTypeClass(q.question_type)}`}
        >
          {questionTypeLabel(q.question_type)}
        </span>
      </p>
      <p className="text-gray-600">
        배정 주차: {q.assigned_week.week_no}주차 · {q.assigned_week.title}
        {q.off_week && ` (${q.session_week_no}주차 수업에서)`}
      </p>
      {q.concept_path.length > 0 && (
        <p className="text-gray-600">개념: {q.concept_path.map((p) => p.title).join(' > ')}</p>
      )}
      <p className="text-gray-500">{formatDateTime(q.created_at)}</p>
    </div>
  )
}

export default function NodeEditorPanel({
  graph,
  selected,
  questions,
  onChanged,
  onDeselect
}: PanelProps): React.JSX.Element {
  let body: React.JSX.Element
  const weekId = selected ? idOf(selected.id, 'week') : null
  const nodeId = selected ? idOf(selected.id, 'node') : null
  const questionId = selected ? idOf(selected.id, 'q') : null
  const week = weekId != null ? graph.weeks.find((w) => w.id === weekId) : undefined
  const nodeWeek =
    nodeId != null ? graph.weeks.find((w) => w.nodes.some((n) => n.id === nodeId)) : undefined
  const node = nodeWeek?.nodes.find((n) => n.id === nodeId)
  const question = questionId != null ? questions.find((q) => q.id === questionId) : undefined

  if (week) {
    body = <WeekEditor key={week.id} week={week} onChanged={onChanged} onDeselect={onDeselect} />
  } else if (nodeWeek && node) {
    body = (
      <ConceptEditor
        key={`${node.id}:${node.title}:${node.summary}:${node.parent_id}:${nodeWeek.id}`}
        graph={graph}
        week={nodeWeek}
        node={node}
        onChanged={onChanged}
        onDeselect={onDeselect}
      />
    )
  } else if (question) {
    body = <QuestionView q={question} />
  } else {
    body = (
      <p className="text-sm text-gray-500">
        마인드맵에서 주차·주제·개념을 선택하면 여기에서 편집할 수 있어요.
      </p>
    )
  }
  return <aside className={`${card} w-80 shrink-0 overflow-y-auto`}>{body}</aside>
}
