import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { QuestionType } from '../../api/types'
import type { MindNodeKind } from '../../lib/trees'
import { questionTypeClass } from '../../lib/questionTypes'
import { NODE_WIDTH, type MindFlowNode } from './layout'

const KIND_CLASS: Record<Exclude<MindNodeKind, 'type'>, string> = {
  root: 'bg-slate-800 border-slate-900 text-white font-semibold',
  week: 'bg-indigo-100 border-indigo-400 text-indigo-900 font-medium',
  topic: 'bg-sky-100 border-sky-400 text-sky-900',
  concept: 'bg-emerald-50 border-emerald-400 text-emerald-900',
  group: 'bg-gray-100 border-gray-400 text-gray-700',
  question: 'bg-white border-amber-400 text-gray-800'
}

const handleClass = '!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-slate-400'

export default function MindNodeView({ data }: NodeProps<MindFlowNode>): React.JSX.Element {
  const { mind, expanded, open, selected, height } = data
  const colorClass =
    mind.kind === 'type'
      ? questionTypeClass(mind.id.slice('type-'.length) as QuestionType)
      : KIND_CLASS[mind.kind]
  const hiddenChildren = mind.children.length > 0 && !expanded ? mind.children.length : 0
  const showDetail = mind.kind === 'question' && open && mind.detail

  return (
    <div
      className={`relative flex cursor-pointer items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-sm shadow-sm ${colorClass} ${
        selected ? 'ring-2 ring-offset-1 ring-blue-500' : ''
      }`}
      style={{ width: NODE_WIDTH, minHeight: height - 4 }}
      title={mind.kind === 'question' ? undefined : mind.detail}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={handleClass}
        isConnectable={false}
      />
      <div className="min-w-0 flex-1">
        {showDetail ? (
          <p className="whitespace-pre-wrap break-words text-xs leading-[18px]">{mind.detail}</p>
        ) : (
          <p className="truncate">{mind.label}</p>
        )}
        {mind.badge && (
          <span className="mt-0.5 inline-block rounded bg-black/10 px-1.5 text-[10px] leading-4">
            {mind.badge}
          </span>
        )}
      </div>
      {mind.count != null && mind.count > 0 && (
        <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-xs font-semibold leading-5 text-white">
          {mind.count}
        </span>
      )}
      {hiddenChildren > 0 && (
        <span className="shrink-0 rounded bg-black/10 px-1 text-xs leading-5">
          +{hiddenChildren}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={handleClass}
        isConnectable={false}
      />
    </div>
  )
}
