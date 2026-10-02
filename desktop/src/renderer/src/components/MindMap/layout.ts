import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import type { Edge, Node } from '@xyflow/react'
import type { MindNode } from '../../lib/trees'

export const NODE_WIDTH = 240
const LEVEL_GAP = 280
const BASE_HEIGHT = 40

export interface MindNodeData extends Record<string, unknown> {
  mind: MindNode
  expanded: boolean
  open: boolean
  selected: boolean
  height: number
}

export type MindFlowNode = Node<MindNodeData, 'mind'>

interface VisibleNode {
  mind: MindNode
  children: VisibleNode[]
}

/** Estimated rendered height: open questions grow with their text (≈22 chars per line, max 8 lines). */
function nodeHeight(mind: MindNode, openQuestions: Set<string>): number {
  if (mind.kind === 'question' && openQuestions.has(mind.id)) {
    const len = (mind.detail ?? mind.label).length
    return BASE_HEIGHT + 18 * Math.min(8, Math.ceil(len / 22))
  }
  return BASE_HEIGHT
}

function visible(mind: MindNode, expanded: Set<string>): VisibleNode {
  return {
    mind,
    children: expanded.has(mind.id) ? mind.children.map((c) => visible(c, expanded)) : []
  }
}

export function layoutMindMap(
  root: MindNode,
  expanded: Set<string>,
  openQuestions: Set<string>,
  selectedId: string | undefined
): { nodes: MindFlowNode[]; edges: Edge[] } {
  const h = (d: HierarchyPointNode<VisibleNode>): number => nodeHeight(d.data.mind, openQuestions)
  const laidOut = tree<VisibleNode>()
    .nodeSize([1, LEVEL_GAP])
    .separation((a, b) => (h(a) + h(b)) / 2 + 16)(hierarchy(visible(root, expanded)))

  const nodes: MindFlowNode[] = []
  const edges: Edge[] = []
  for (const d of laidOut.descendants()) {
    const mind = d.data.mind
    const height = h(d)
    // Horizontal layout: d3 x (breadth) → screen y, d3 y (depth) → screen x; root on the left.
    nodes.push({
      id: mind.id,
      type: 'mind',
      position: { x: d.y, y: d.x - height / 2 },
      data: {
        mind,
        expanded: expanded.has(mind.id),
        open: openQuestions.has(mind.id),
        selected: mind.id === selectedId,
        height
      },
      draggable: false,
      connectable: false
    })
    if (d.parent) {
      edges.push({
        id: `${d.parent.data.mind.id}->${mind.id}`,
        source: d.parent.data.mind.id,
        target: mind.id,
        type: 'smoothstep'
      })
    }
  }
  return { nodes, edges }
}
