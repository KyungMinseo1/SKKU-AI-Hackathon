import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes
} from '@xyflow/react'
import type { MindNode } from '../../lib/trees'
import { layoutMindMap, type MindFlowNode } from './layout'
import MindNodeView from './MindNodeView'

export interface MindMapProps {
  root: MindNode
  selectedId?: string
  onSelect?: (node: MindNode) => void
  height?: number | string
}

const nodeTypes: NodeTypes = { mind: MindNodeView }

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function MindMapInner({ root, selectedId, onSelect }: MindMapProps): React.JSX.Element {
  const { fitView } = useReactFlow()
  // Only the root and its direct children are visible initially (max-depth = 1).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root.id]))
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(() => new Set())

  const { nodes, edges } = useMemo(
    () => layoutMindMap(root, expanded, openQuestions, selectedId),
    [root, expanded, openQuestions, selectedId]
  )

  // Fit only on first render and when the expansion state changes — not on live data updates.
  useEffect(() => {
    const timer = setTimeout(() => {
      void fitView({ padding: 0.2, duration: 300 })
    }, 50)
    return () => clearTimeout(timer)
  }, [expanded, fitView])

  const onNodeClick: NodeMouseHandler<MindFlowNode> = useCallback(
    (_event, node) => {
      const mind = node.data.mind
      if (mind.kind === 'question') {
        setOpenQuestions((s) => toggled(s, mind.id))
      } else if (mind.children.length > 0) {
        setExpanded((s) => toggled(s, mind.id))
      }
      onSelect?.(mind)
    },
    [onSelect]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export default function MindMap(props: MindMapProps): React.JSX.Element {
  return (
    <div
      style={{ height: props.height ?? '100%', width: '100%' }}
      className="rounded-lg border border-gray-200 bg-gray-50"
    >
      <ReactFlowProvider>
        {/* Remount (reset expansion) when the root identity changes, e.g. switching tabs/modes. */}
        <MindMapInner key={props.root.id} {...props} />
      </ReactFlowProvider>
    </div>
  )
}
