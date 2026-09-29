// Shared types and helpers for the step-by-step execution visualizer. The
// worker (public/pyodide-worker.js) runs a small hand-written tree-walking
// interpreter over the student's own ast.parse() tree (real CPython tracing
// APIs never expose values sitting on the internal bytecode evaluation
// stack, so there is no way to observe e.g. "3 * 4" collapsing to "12"
// mid-expression without controlling the evaluator). Each recorded step
// carries the `nodeId` of the exact AST node it corresponds to - the same
// stable id embedded in the AST-as-JSON tree - so the UI can substitute that
// node's original source with the step's computed value inline.

export type TraceStepKind = 'eval' | 'exec' | 'branch' | 'loop-iter'

export type TraceStep = {
  step: number
  path: string
  func: string
  line: number
  endLine: number
  col: number
  endCol: number
  kind: TraceStepKind
  label: string
  nodeId: number
  // The computed value's repr (for "eval"/"loop-iter"), "true"/"false" (for
  // "branch"), or null (for plain "exec" steps with no single result value,
  // e.g. a bare `pass` or an assignment target already covered by locals).
  valueText: string | null
  locals: Record<string, string>
  stdoutLen: number
  graphicsLen: number
  // Only present on "loop-iter" steps: every node id inside the loop body,
  // to be cleared from the substitution state so the body's source visibly
  // resets to its un-substituted form at the start of each new iteration.
  resetNodeIds: number[]
  // Only present on "loop-iter" steps for a simple "for x in ...:" target:
  // the node id of the target name, and the text to show *appended right
  // after* it (e.g. "=0"), without replacing/hiding the target's own source
  // text the way a normal substitution would. Lets "for i in range(3):"
  // render as "for i=0 in range(3):" during the first iteration while
  // leaving "range(3)" completely untouched.
  annotateNodeId: number | null
  annotateText: string | null
}

export type AstNode = {
  id: number
  type: string
  summary: string
  line?: number
  endLine?: number
  col?: number
  endCol?: number
  fields: Record<string, AstNode | AstNode[] | string | null>
}

export type AstFile = AstNode | { error: string }

export type TraceResult = {
  trace: TraceStep[]
  ast: Record<string, AstFile>
  output: string
  graphics: unknown[]
  error: string | null
  truncated: boolean
}

// Builds a nodeId -> AstNode index for one parsed file, so steps can be
// matched back to their AST node in O(1) instead of walking the tree per
// step (a trace can contain thousands of steps).
export function indexAstNodes(root: AstFile | undefined): Map<number, AstNode> {
  const index = new Map<number, AstNode>()
  if (!root || 'error' in root) return index

  const visit = (node: AstNode) => {
    index.set(node.id, node)
    for (const value of Object.values(node.fields)) {
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item === 'object') visit(item as AstNode)
      } else if (value && typeof value === 'object') {
        visit(value as AstNode)
      }
    }
  }

  visit(root as AstNode)
  return index
}

// Every AST node touched by any step up to and including `uptoStep` (across
// all files), keyed by path -> nodeId -> the value to substitute its source
// with. Used to build the "original code with computed values inlined"
// rendering for a given point in the trace.
export type SubstitutionState = Map<string, Map<number, string>>

// Like SubstitutionState, but for the loop-variable "=value" annotations:
// path -> nodeId (of the loop target) -> text to append right after it.
// Unlike substitutions, these are never cleared by resetNodeIds - each new
// iteration simply overwrites the previous one's annotation for the same
// target node id, and the last iteration's annotation is left in place
// afterwards (matching how substituted values elsewhere in the trace stay
// visible once computed, e.g. `total = 14` doesn't revert after the loop).
export type AnnotationState = Map<string, Map<number, string>>

// Replays the trace from the start up to (and including) `uptoStep`,
// producing the substitution state to render. Each "loop-iter" step carries
// `resetNodeIds` (every node id inside that loop's body) which is cleared
// from the state *before* applying the iteration's own value - this is what
// makes a loop body visibly "reset" to its original source at the start of
// every iteration instead of staying stuck showing the previous iteration's
// substituted values.
export function buildSubstitutionsUpTo(trace: TraceStep[], uptoStep: number): SubstitutionState {
  const state: SubstitutionState = new Map()

  for (const step of trace) {
    if (step.step > uptoStep) break

    if (step.kind === 'loop-iter' && step.resetNodeIds?.length) {
      const byNode = state.get(step.path)
      if (byNode) for (const id of step.resetNodeIds) byNode.delete(id)
    }

    if (step.valueText === null) continue
    if (step.kind !== 'eval') continue

    let byNode = state.get(step.path)
    if (!byNode) {
      byNode = new Map()
      state.set(step.path, byNode)
    }
    byNode.set(step.nodeId, step.valueText)
  }

  return state
}

// Replays the trace up to (and including) `uptoStep`, producing the
// loop-variable annotation state (see AnnotationState) to render.
export function buildAnnotationsUpTo(trace: TraceStep[], uptoStep: number): AnnotationState {
  const state: AnnotationState = new Map()

  for (const step of trace) {
    if (step.step > uptoStep) break
    if (step.kind !== 'loop-iter' || step.annotateNodeId === null || step.annotateText === null) continue

    let byNode = state.get(step.path)
    if (!byNode) {
      byNode = new Map()
      state.set(step.path, byNode)
    }
    byNode.set(step.annotateNodeId, step.annotateText)
  }

  return state
}

// Absolute character offset (into the whole source string) of the start of
// each line, so an AST node's (line, col) - both from Python's ast module,
// 1-based line / 0-based column - can be converted to a plain [start, end)
// character range for string splicing.
export function computeLineOffsets(source: string): number[] {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function nodeRange(node: AstNode, lineOffsets: number[]): { start: number; end: number } | null {
  if (node.line === undefined || node.endLine === undefined || node.col === undefined || node.endCol === undefined) return null
  const start = (lineOffsets[node.line - 1] ?? 0) + node.col
  const end = (lineOffsets[node.endLine - 1] ?? 0) + node.endCol
  return { start, end }
}

// Produces the source text for one file with every currently-substituted
// AST node's original text replaced by its computed value, plus the
// character ranges (in the *new* text) that are substituted values, for
// highlighting. When both a node and one of its descendants are
// substituted (e.g. `2 + 3 * 4` mid-evaluation: the `3 * 4` sub-expression
// resolves before the outer `+` does), only the outermost substitution is
// applied - the inner one is naturally superseded once the outer node's own
// step fires, which is exactly what produces the requested one-step-at-a-
// time collapse (`2 + 3 * 4` -> `2 + 12` -> `14`).
export function applySubstitutions(
  source: string,
  lineOffsets: number[],
  nodeIndex: Map<number, AstNode>,
  substitutions: Map<number, string> | undefined,
  annotations?: Map<number, string>,
): { text: string; highlights: Array<{ start: number; end: number }>; annotationHighlights: Array<{ start: number; end: number }> } {
  if ((!substitutions || substitutions.size === 0) && (!annotations || annotations.size === 0)) {
    return { text: source, highlights: [], annotationHighlights: [] }
  }

  const candidates: Array<{ start: number; end: number; value: string }> = []
  for (const [nodeId, value] of substitutions ?? []) {
    const node = nodeIndex.get(nodeId)
    if (!node) continue
    const range = nodeRange(node, lineOffsets)
    if (!range) continue
    candidates.push({ ...range, value })
  }

  // Larger spans first, so a containing node is selected before any
  // descendant node whose span it fully covers.
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start))

  const selected: Array<{ start: number; end: number; value: string; isAnnotation: false }> = []
  for (const candidate of candidates) {
    const overlapsSelected = selected.some((s) => candidate.start >= s.start && candidate.end <= s.end)
    if (!overlapsSelected) selected.push({ ...candidate, isAnnotation: false })
  }

  // Annotations are zero-width inserts placed right after their node's
  // source span (e.g. the "=0" after a for-loop's target name "i") rather
  // than replacements, so the original text they're attached to is never
  // hidden. Skip any annotation whose position falls inside a substituted
  // span, since that source text isn't visible to attach the annotation to
  // anymore.
  const inserts: Array<{ start: number; end: number; value: string; isAnnotation: true }> = []
  for (const [nodeId, text] of annotations ?? []) {
    const node = nodeIndex.get(nodeId)
    if (!node) continue
    const range = nodeRange(node, lineOffsets)
    if (!range) continue
    const hiddenBySubstitution = selected.some((s) => range.end > s.start && range.end < s.end)
    if (hiddenBySubstitution) continue
    inserts.push({ start: range.end, end: range.end, value: text, isAnnotation: true })
  }

  const merged = [...selected, ...inserts].sort((a, b) => a.start - b.start || (a.isAnnotation ? 1 : -1))

  let text = ''
  let cursor = 0
  const highlights: Array<{ start: number; end: number }> = []
  const annotationHighlights: Array<{ start: number; end: number }> = []
  for (const { start, end, value, isAnnotation } of merged) {
    if (start < cursor) continue
    text += source.slice(cursor, start)
    const highlightStart = text.length
    text += value
    ;(isAnnotation ? annotationHighlights : highlights).push({ start: highlightStart, end: text.length })
    cursor = end
  }
  text += source.slice(cursor)

  return { text, highlights, annotationHighlights }
}
