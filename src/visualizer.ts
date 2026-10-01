// Shared types and helpers for the step-by-step execution visualizer. The
// worker (public/pyodide-worker.js) runs a small hand-written tree-walking
// interpreter over the student's own ast.parse() tree (real CPython tracing
// APIs never expose values sitting on the internal bytecode evaluation
// stack, so there is no way to observe e.g. "3 * 4" collapsing to "12"
// mid-expression without controlling the evaluator). Each recorded step
// carries the `nodeId` of the exact AST node it corresponds to - the same
// stable id embedded in the AST-as-JSON tree - so the UI can substitute that
// node's original source with the step's computed value inline.

export type TraceStepKind = 'eval' | 'exec' | 'branch' | 'loop-iter' | 'call-enter'

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
  // Which call frame this step executed in (0 = module scope). Lets the UI
  // isolate exactly the steps belonging to one open function-call box, even
  // across recursive calls that reuse the same AST nodes.
  frameId: number
  // Only present on "call-enter" steps (the moment a user-defined function
  // starts running): the frame that opened, its caller's frame, the
  // FunctionDef node whose source is the box's content, which file that
  // def lives in, and the "=value" annotations to show next to each bound
  // parameter name in the box's header (same mechanism as loop-variable
  // annotations).
  parentFrameId: number | null
  funcDefNodeId: number | null
  funcDefPath: string | null
  paramAnnotations: Array<[number, string]>
  // Only present on the "eval" step of a Call node that just finished
  // running a user-defined function: the frame id that just closed, so the
  // UI knows this is the step where that frame's box collapses into this
  // step's own substituted return value.
  closesFrameId: number | null
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
// `resetNodeIds` (every node id inside that loop's body, plus - for "while"
// loops - every node id inside the condition expression too) which is
// cleared from the state *before* applying the step's own value - this is
// what makes a loop body (and, for "while" loops, its condition) visibly
// "reset" to its original source at the start of every iteration instead of
// staying stuck showing the previous iteration's substituted values.
//
// `frameId` scopes the replay to steps that executed in exactly one call
// frame (0 = module scope). This is what keeps recursive/nested calls from
// clobbering each other's displayed values even though they share the exact
// same AST node ids: each invocation's own steps are tagged with its own
// unique frame id (see public/pyodide-worker.js), so filtering by frame id
// isolates "this specific call's" substitutions from any other open call to
// the same function.
export function buildSubstitutionsUpTo(trace: TraceStep[], uptoStep: number, frameId = 0): SubstitutionState {
  const state: SubstitutionState = new Map()

  for (const step of trace) {
    if (step.step > uptoStep) break
    if (step.frameId !== frameId) continue

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
// loop-variable annotation state (see AnnotationState) to render, scoped to
// one call frame (see buildSubstitutionsUpTo).
export function buildAnnotationsUpTo(trace: TraceStep[], uptoStep: number, frameId = 0): AnnotationState {
  const state: AnnotationState = new Map()

  for (const step of trace) {
    if (step.step > uptoStep) break
    if (step.frameId !== frameId) continue
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

// One user-defined function call whose box is (or was, up to the replayed
// step) open: which frame it is, where its call site is (the box's anchor
// position), and where its own def's source lives (the box's content).
export type OpenFrame = {
  frameId: number
  parentFrameId: number
  funcName: string
  // Call site (in the *caller's* file) the box is anchored at.
  anchorPath: string
  anchorNodeId: number
  // Where the "def ...:" itself lives - may be a different file than the
  // call site (e.g. calling into an imported module).
  funcDefPath: string
  funcDefNodeId: number
  paramAnnotations: Array<[number, string]>
}

// Replays the trace up to (and including) `uptoStep`, returning every call
// frame that is still "open" at that point (i.e. its call-enter step has
// been reached but the step that closes it has not), keyed by frame id.
// Frame 0 (module scope) is never included - it's always implicitly open.
export function computeOpenFramesUpTo(trace: TraceStep[], uptoStep: number): Map<number, OpenFrame> {
  const open = new Map<number, OpenFrame>()

  for (const step of trace) {
    if (step.step > uptoStep) break

    if (step.kind === 'call-enter' && step.funcDefNodeId !== null && step.funcDefPath !== null) {
      open.set(step.frameId, {
        frameId: step.frameId,
        parentFrameId: step.parentFrameId ?? 0,
        funcName: step.func,
        anchorPath: step.path,
        anchorNodeId: step.nodeId,
        funcDefPath: step.funcDefPath,
        funcDefNodeId: step.funcDefNodeId,
        paramAnnotations: step.paramAnnotations ?? [],
      })
    }

    if (step.closesFrameId !== null && step.closesFrameId !== undefined) {
      open.delete(step.closesFrameId)
    }
  }

  return open
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

export function nodeRange(node: AstNode, lineOffsets: number[]): { start: number; end: number } | null {
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
type MergedInsert = { start: number; end: number; value: string; kind: 'substitution' | 'annotation' }

// Shared by applySubstitutions and locateNodeRenderedRange: the sorted list
// of every text replacement/insert that would be spliced into `source`,
// without actually building the resulting string yet - so both "produce the
// rendered text" and "find where some other node's span ends up in that
// rendered text" can walk the exact same splice plan.
function buildMergedInserts(
  source: string,
  lineOffsets: number[],
  nodeIndex: Map<number, AstNode>,
  substitutions: Map<number, string> | undefined,
  annotations: Map<number, string> | undefined,
): MergedInsert[] {
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

  const selected: Array<{ start: number; end: number; value: string }> = []
  for (const candidate of candidates) {
    const overlapsSelected = selected.some((s) => candidate.start >= s.start && candidate.end <= s.end)
    if (!overlapsSelected) selected.push(candidate)
  }

  // Annotations are zero-width inserts placed right after their node's
  // source span (e.g. the "=0" after a for-loop's target name "i") rather
  // than replacements, so the original text they're attached to is never
  // hidden. Skip any annotation whose position falls inside a substituted
  // span, since that source text isn't visible to attach the annotation to
  // anymore.
  const inserts: Array<{ start: number; end: number; value: string; kind: 'annotation' }> = []
  for (const [nodeId, text] of annotations ?? []) {
    const node = nodeIndex.get(nodeId)
    if (!node) continue
    const range = nodeRange(node, lineOffsets)
    if (!range) continue
    const hiddenBySubstitution = selected.some((s) => range.end > s.start && range.end < s.end)
    if (hiddenBySubstitution) continue
    inserts.push({ start: range.end, end: range.end, value: text, kind: 'annotation' })
  }

  return [
    ...selected.map((s) => ({ ...s, kind: 'substitution' as const })),
    ...inserts,
  ].sort((a, b) => a.start - b.start || (a.kind === 'substitution' ? -1 : 1))
}

// Maps one offset in the *original* source to where it ends up in the
// rendered text produced by splicing in `merged`'s inserts. Only valid for
// offsets that don't fall strictly inside a splice's original span (true
// for any AST node's own start/end as long as that exact node isn't itself
// being substituted - its descendants being substituted is fine).
function locateOffset(merged: MergedInsert[], offset: number): number {
  let cursor = 0
  let renderedLen = 0
  for (const item of merged) {
    if (item.start >= offset) break
    renderedLen += (item.start - cursor) + item.value.length
    cursor = item.end
  }
  return renderedLen + (offset - cursor)
}

// Finds where `node`'s own span (untouched, i.e. assuming `node` itself is
// not among the substituted nodes) ends up in the text applySubstitutions
// would produce for the same source/substitutions/annotations - e.g. so a
// call-frame box can be positioned exactly where its call site's `fact(2)`
// text sits within its *parent* frame's already-substituted rendering, in
// order to render the nested box inline there instead of the plain text.
export function locateNodeRenderedRange(
  source: string,
  lineOffsets: number[],
  nodeIndex: Map<number, AstNode>,
  substitutions: Map<number, string> | undefined,
  annotations: Map<number, string> | undefined,
  node: AstNode,
): { start: number; end: number } | null {
  const range = nodeRange(node, lineOffsets)
  if (!range) return null
  const merged = buildMergedInserts(source, lineOffsets, nodeIndex, substitutions, annotations)
  return { start: locateOffset(merged, range.start), end: locateOffset(merged, range.end) }
}

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

  const merged = buildMergedInserts(source, lineOffsets, nodeIndex, substitutions, annotations)

  let text = ''
  let cursor = 0
  const highlights: Array<{ start: number; end: number }> = []
  const annotationHighlights: Array<{ start: number; end: number }> = []
  for (const { start, end, value, kind } of merged) {
    if (start < cursor) continue
    text += source.slice(cursor, start)
    const highlightStart = text.length
    text += value
    if (kind === 'substitution') highlights.push({ start: highlightStart, end: text.length })
    else if (kind === 'annotation') annotationHighlights.push({ start: highlightStart, end: text.length })
    cursor = end
  }
  text += source.slice(cursor)

  return { text, highlights, annotationHighlights }
}

// Like applySubstitutions, but clips the result down to just one span of
// the source (used to render a call-frame's box: only the "def foo(...):"
// node's own text, not the rest of the file it lives in) - or, when
// `clipRange` is null, returns the whole file untouched, which is what
// lets the exact same renderer draw both a function call's box and the
// outermost module/global frame.
//
// This works by running the normal whole-file substitution pass and then
// trimming the result down, rather than re-implementing the splicing logic
// on a pre-sliced string, which is what makes it safe: as long as every
// substitution/annotation passed in belongs to a node *inside* `clipRange`
// (true here, since callers scope them to one call frame - see
// buildSubstitutionsUpTo's `frameId` parameter - and a frame's own steps
// can only ever touch nodes inside its own function body), the text before
// clipRange's start and after its end is guaranteed untouched/same-length
// in the rendered output, so the original character offsets still line up.
export function renderFrameSource(
  source: string,
  lineOffsets: number[],
  nodeIndex: Map<number, AstNode>,
  clipRange: { start: number; end: number } | null,
  substitutions: Map<number, string> | undefined,
  annotations: Map<number, string> | undefined,
): { text: string; highlights: Array<{ start: number; end: number }>; annotationHighlights: Array<{ start: number; end: number }> } | null {
  const { text, highlights, annotationHighlights } = applySubstitutions(source, lineOffsets, nodeIndex, substitutions, annotations)
  if (!clipRange) return { text, highlights, annotationHighlights }

  const tailLength = source.length - clipRange.end
  const clippedEnd = text.length - tailLength
  const inClip = (r: { start: number; end: number }) => r.start >= clipRange.start && r.end <= clippedEnd
  const shift = (r: { start: number; end: number }) => ({ start: r.start - clipRange.start, end: r.end - clipRange.start })

  return {
    text: text.slice(clipRange.start, clippedEnd),
    highlights: highlights.filter(inClip).map(shift),
    annotationHighlights: annotationHighlights.filter(inClip).map(shift),
  }
}

// Binary-searches `lineOffsets` (see computeLineOffsets) for the 1-based
// line number containing a given character offset - used to figure out
// which source line a clipped frame's first rendered line corresponds to,
// without needing the clipping AST node's own `.line` field (so the same
// code path works for the module/global frame, whose clip range is just
// "the whole file" with no single AST node to read a line number from).
export function lineNumberAtOffset(lineOffsets: number[], offset: number): number {
  let lo = 0
  let hi = lineOffsets.length - 1
  let line = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineOffsets[mid] <= offset) { line = mid; lo = mid + 1 } else hi = mid - 1
  }
  return line + 1
}

// Returns the most recent non-empty locals snapshot recorded for one call
// frame (0 = module scope) at or before `uptoStep` - i.e. "what this
// frame's own variables currently look like", persisted across any later
// steps that don't themselves carry a fresh snapshot (most step kinds only
// attach one on assignment/loop-iter/call-enter, see
// public/pyodide-worker.js's _glpython_record call sites - every other
// step kind, e.g. a plain "eval" or "branch" step, would otherwise blank
// the panel out on every single expression/condition evaluation).
export function buildLocalsUpTo(trace: TraceStep[], uptoStep: number, frameId = 0): Record<string, string> {
  let locals: Record<string, string> = {}
  for (const step of trace) {
    if (step.step > uptoStep) break
    if (step.frameId !== frameId) continue
    if (Object.keys(step.locals).length > 0) locals = step.locals
  }
  return locals
}
