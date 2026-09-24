import type { PageViewport } from 'pdfjs-dist'
import type { Color, Mark, Quad, QuadMark, TextMark, Tool } from './types'

export function cssColor(color: Color, alpha = 1): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
}

export function hexColor(color: Color): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(color.r)}${h(color.g)}${h(color.b)}`
}

export function colorFromHex(hex: string): Color {
  const v = hex.replace('#', '')
  return {
    r: Number.parseInt(v.slice(0, 2), 16),
    g: Number.parseInt(v.slice(2, 4), 16),
    b: Number.parseInt(v.slice(4, 6), 16),
  }
}

function contentBox(pageEl: HTMLElement): DOMRect {
  const canvas = pageEl.querySelector<HTMLElement>('.page-canvas')
  return (canvas ?? pageEl).getBoundingClientRect()
}

export function clientPointToPdf(
  pageEl: HTMLElement,
  viewport: PageViewport,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const box = contentBox(pageEl)
  const sx = box.width / viewport.width
  const sy = box.height / viewport.height
  const vx = (clientX - box.left) / sx
  const vy = (clientY - box.top) / sy
  const [x, y] = viewport.convertToPdfPoint(vx, vy)
  return { x, y }
}

export function pdfQuadToCss(
  quad: Quad,
  viewport: PageViewport,
): { left: number; top: number; width: number; height: number } {
  const [x1, y1] = viewport.convertToViewportPoint(quad.x, quad.y + quad.h)
  const [x2, y2] = viewport.convertToViewportPoint(quad.x + quad.w, quad.y)
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

export function pdfPointToCss(
  x: number,
  y: number,
  viewport: PageViewport,
): { left: number; top: number } {
  const [left, top] = viewport.convertToViewportPoint(x, y)
  return { left, top }
}

function mergeLineRects(rects: DOMRect[]): DOMRect[] {
  const raw = [...rects].filter((r) => r.width > 1 && r.height > 1)
  if (raw.length === 0) return []
  const heights = raw.map((r) => r.height).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)]
  const items = raw
    .filter((r) => r.height > median * 0.55 && r.height < median * 1.85)
    .sort((a, b) => a.top - b.top || a.left - b.left)

  const lines: DOMRect[] = []
  for (const r of items) {
    const last = lines.at(-1)
    if (!last) {
      lines.push(new DOMRect(r.x, r.y, r.width, r.height))
      continue
    }
    const sameLine =
      Math.abs(last.top + last.height / 2 - (r.top + r.height / 2)) <
      Math.min(last.height, r.height) * 0.65
    const gap = r.left - last.right
    if (sameLine && gap < Math.max(24, last.height * 1.4)) {
      const left = Math.min(last.left, r.left)
      const top = Math.min(last.top, r.top)
      const right = Math.max(last.right, r.right)
      const bottom = Math.max(last.bottom, r.bottom)
      lines[lines.length - 1] = new DOMRect(left, top, right - left, bottom - top)
    } else {
      lines.push(new DOMRect(r.x, r.y, r.width, r.height))
    }
  }
  return lines
}

export function selectionToQuads(
  pageEl: HTMLElement,
  viewport: PageViewport,
): { quads: Quad[]; text: string } | null {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return null

  const pageBox = contentBox(pageEl)
  const rects: DOMRect[] = []
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i)
    if (!pageEl.contains(range.commonAncestorContainer) && !range.intersectsNode(pageEl)) {
      continue
    }
    for (const rect of range.getClientRects()) {
      const overlap =
        rect.right > pageBox.left &&
        rect.left < pageBox.right &&
        rect.bottom > pageBox.top &&
        rect.top < pageBox.bottom
      if (overlap) rects.push(rect)
    }
  }
  if (rects.length === 0) return null

  const quads: Quad[] = []
  for (const rect of mergeLineRects(rects)) {
    const a = clientPointToPdf(pageEl, viewport, rect.left, rect.bottom)
    const b = clientPointToPdf(pageEl, viewport, rect.right, rect.top)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    if (w > 0.4 && h > 0.4) quads.push({ x, y, w, h })
  }
  if (quads.length === 0) return null
  return { quads, text: selection.toString() }
}

export function rangeToQuads(
  range: Range,
  pageEl: HTMLElement,
  viewport: PageViewport,
): { quads: Quad[]; text: string } | null {
  const pageBox = contentBox(pageEl)
  const rects: DOMRect[] = []
  for (const rect of range.getClientRects()) {
    const overlap =
      rect.right > pageBox.left &&
      rect.left < pageBox.right &&
      rect.bottom > pageBox.top &&
      rect.top < pageBox.bottom
    if (overlap) rects.push(rect)
  }
  if (rects.length === 0) return null
  const quads: Quad[] = []
  for (const rect of mergeLineRects(rects)) {
    const a = clientPointToPdf(pageEl, viewport, rect.left, rect.bottom)
    const b = clientPointToPdf(pageEl, viewport, rect.right, rect.top)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    if (w > 0.4 && h > 0.4) quads.push({ x, y, w, h })
  }
  if (quads.length === 0) return null
  return { quads, text: range.toString() }
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[\p{L}\p{N}'’\-]/u.test(ch))
}

function walkText(root: Node, from: Node, dir: 'prev' | 'next'): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  walker.currentNode = from
  const step = () => (dir === 'prev' ? walker.previousNode() : walker.nextNode())
  let node = step()
  while (node) {
    if (node.textContent?.length) return node as Text
    node = step()
  }
  return null
}

function charRect(node: Node, index: number): DOMRect | null {
  const text = node.textContent ?? ''
  if (index < 0 || index >= text.length) return null
  const range = document.createRange()
  range.setStart(node, index)
  range.setEnd(node, index + 1)
  return range.getClientRects()[0] ?? null
}

function glyphsTouch(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return false
  const sameLine = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < Math.max(a.height, b.height) * 0.75
  const gap = b.left - a.right
  const back = a.left - b.right
  const space = Math.min(Math.abs(gap), Math.abs(back))
  return sameLine && space < Math.max(a.height, b.height, 10) * 0.55
}

export function wordRangeAt(clientX: number, clientY: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let range = doc.caretRangeFromPoint?.(clientX, clientY) ?? null
  if (!range && doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(clientX, clientY)
    if (pos) {
      range = document.createRange()
      range.setStart(pos.offsetNode, pos.offset)
      range.collapse(true)
    }
  }
  if (!range) return null
  let startNode = range.startContainer
  if (startNode.nodeType !== Node.TEXT_NODE) return null
  const root = startNode.parentElement?.closest('.textLayer')
  if (!root) return null

  let startOffset = range.startOffset
  let endNode: Node = startNode
  let endOffset = range.startOffset

  while (true) {
    const text = startNode.textContent ?? ''
    while (startOffset > 0 && isWordChar(text[startOffset - 1])) startOffset--
    if (startOffset > 0) break
    const prev = walkText(root, startNode, 'prev')
    if (!prev) break
    const last = prev.textContent?.at(-1)
    if (!isWordChar(last)) break
    const from = charRect(prev, (prev.textContent?.length ?? 1) - 1)
    const to = charRect(startNode, 0)
    if (!glyphsTouch(from, to)) break
    startNode = prev
    startOffset = prev.textContent?.length ?? 0
  }

  while (true) {
    const text = endNode.textContent ?? ''
    while (endOffset < text.length && isWordChar(text[endOffset])) endOffset++
    if (endOffset < text.length) break
    const next = walkText(root, endNode, 'next')
    if (!next) break
    if (!isWordChar(next.textContent?.[0])) break
    const from = charRect(endNode, Math.max(0, (endNode.textContent?.length ?? 1) - 1))
    const to = charRect(next, 0)
    if (!glyphsTouch(from, to)) break
    endNode = next
    endOffset = 0
  }

  if (startNode === endNode && endOffset <= startOffset) return null
  const out = document.createRange()
  out.setStart(startNode, startOffset)
  out.setEnd(endNode, endOffset)
  if (!pointInClientRects(clientX, clientY, out.getClientRects())) return null
  return out
}

function pointInClientRects(x: number, y: number, rects: DOMRectList): boolean {
  for (const r of rects) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
  }
  return false
}

export function quadsOverlap(a: Quad, b: Quad): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function pointInQuads(x: number, y: number, quads: Quad[]): boolean {
  return quads.some((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h)
}

export function markOverlapsQuads(mark: Mark, quads: Quad[]): boolean {
  return mark.kind !== 'text' && mark.quads.some((mq) => quads.some((q) => quadsOverlap(mq, q)))
}

export function roughlySameRegion(a: Quad[], b: Quad[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const covered = b.filter((bq) => a.some((aq) => quadsOverlap(aq, bq))).length
  return covered / b.length >= 0.6
}

export function collapseStackedMarks(marks: Mark[]): Mark[] {
  const kept: Mark[] = []
  for (const mark of marks) {
    if (mark.kind === 'text') {
      kept.push(mark)
      continue
    }
    const stacked = kept.some(
      (other) =>
        other.kind === mark.kind && other.page === mark.page && markOverlapsQuads(other, mark.quads),
    )
    if (!stacked) kept.push(mark)
  }
  return kept
}

export function pageFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest<HTMLElement>('.page') ?? null
}

export function renderMarks(
  pageEl: HTMLElement,
  viewport: PageViewport,
  marks: Mark[],
  selectedId: string | null,
  onSelect: (id: string) => void,
  onTextChange: (id: string, content: string) => void,
  onTextMove: (id: string, x: number, y: number, began?: boolean) => void,
  onTextCommit: (id: string) => void,
): void {
  const layer = pageEl.querySelector<HTMLElement>('.annot-layer')
  if (!layer) return
  layer.replaceChildren()

  const page = Number(pageEl.dataset.page)
  for (const mark of marks) {
    if (mark.page !== page) continue
    if (mark.kind === 'text') {
      layer.append(
        renderTextMark(mark, viewport, pageEl, selectedId, onSelect, onTextChange, onTextMove, onTextCommit),
      )
    } else {
      layer.append(renderQuadMark(mark, viewport, selectedId, onSelect))
    }
  }
}

function renderQuadMark(
  mark: QuadMark,
  viewport: PageViewport,
  selectedId: string | null,
  onSelect: (id: string) => void,
): HTMLElement {
  const group = document.createElement('div')
  group.className = `mark mark-${mark.kind}${selectedId === mark.id ? ' selected' : ''}`
  group.dataset.id = mark.id
  for (const quad of mark.quads) {
    const box = pdfQuadToCss(quad, viewport)
    const el = document.createElement('div')
    el.className = 'mark-quad'
    el.style.left = `${box.left}px`
    el.style.top = `${box.top}px`
    el.style.width = `${box.width}px`
    el.style.height = `${box.height}px`
    if (mark.kind === 'highlight') {
      el.style.background = cssColor(mark.color, 0.42)
    } else if (mark.kind === 'underline') {
      el.style.borderBottom = `2px solid ${cssColor(mark.color)}`
    } else {
      el.style.background = `linear-gradient(${cssColor(mark.color)} 0 0) center / 100% 2px no-repeat`
    }
    group.append(el)
  }
  group.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    onSelect(mark.id)
  })
  return group
}

function renderTextMark(
  mark: TextMark,
  viewport: PageViewport,
  pageEl: HTMLElement,
  selectedId: string | null,
  onSelect: (id: string) => void,
  onTextChange: (id: string, content: string) => void,
  onTextMove: (id: string, x: number, y: number, began?: boolean) => void,
  onTextCommit: (id: string) => void,
): HTMLElement {
  const pos = pdfPointToCss(mark.x, mark.y, viewport)
  const el = document.createElement('div')
  el.className = `mark mark-text${selectedId === mark.id ? ' selected' : ''}`
  el.dataset.id = mark.id
  el.style.left = `${pos.left}px`
  el.style.top = `${pos.top}px`
  el.style.color = cssColor(mark.color)
  el.style.fontSize = `${mark.fontSize * viewport.scale}px`

  const input = document.createElement('textarea')
  input.value = mark.content
  input.rows = 1
  input.spellcheck = false
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
    onTextChange(mark.id, input.value)
  })
  input.addEventListener('blur', () => onTextCommit(mark.id))

  const beginDrag = (e: PointerEvent) => {
    e.stopPropagation()
    const originX = mark.x
    const originY = mark.y
    const start = clientPointToPdf(pageEl, viewport, e.clientX, e.clientY)
    const pointerId = e.pointerId
    let dragging = false
    let started = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      if (!dragging) {
        if (Math.hypot(dx, dy) < 5) return
        dragging = true
        input.blur()
        el.setPointerCapture(pointerId)
      }
      const now = clientPointToPdf(pageEl, viewport, ev.clientX, ev.clientY)
      const x = originX + (now.x - start.x)
      const y = originY + (now.y - start.y)
      onTextMove(mark.id, x, y, !started)
      started = true
      const next = pdfPointToCss(x, y, viewport)
      el.style.left = `${next.left}px`
      el.style.top = `${next.top}px`
    }
    const up = () => {
      if (dragging) {
        try {
          el.releasePointerCapture(pointerId)
        } catch {
          /* already released */
        }
      }
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (!dragging) {
        onSelect(mark.id)
        input.focus()
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  input.addEventListener('pointerdown', beginDrag)
  el.addEventListener('pointerdown', (e) => {
    if (e.target === input) return
    e.preventDefault()
    beginDrag(e)
  })

  el.append(input)
  queueMicrotask(() => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  })
  return el
}

export function toolKind(tool: Tool): QuadMark['kind'] | 'text' {
  return tool
}
