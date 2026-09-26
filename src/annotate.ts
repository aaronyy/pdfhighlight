import type { PageViewport } from 'pdfjs-dist'
import type { Color, ImageMark, Mark, MarkerMark, Point, Quad, QuadMark, TextMark, Tool } from './types'

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

const PAGE_INSET = 12

/** Keep a new note on the page. `y` is the top edge in PDF points. */
export function clampTextOrigin(
  viewport: PageViewport,
  x: number,
  y: number,
  width: number,
  fontSize: number,
): { x: number; y: number; width: number } {
  const [xMin, yMin, xMax, yMax] = viewport.viewBox
  const inner = Math.max(48, xMax - xMin - PAGE_INSET * 2)
  const boxWidth = Math.min(Math.max(48, width), inner)
  const minX = xMin + PAGE_INSET
  const maxX = Math.max(minX, xMax - PAGE_INSET - boxWidth)
  const line = Math.max(fontSize, 8) * 1.8
  const minY = yMin + PAGE_INSET + line
  const maxY = Math.max(minY, yMax - PAGE_INSET)
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
    width: boxWidth,
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

/** PDF line box for a text span: baseline plus the font's ascent and descent. */
type SpanBox = { x: number; y: number; w: number; h: number }

const spanBoxes = new WeakMap<HTMLElement, SpanBox>()

type MeasuredSpan = { box: SpanBox; rect: DOMRect }
const spanMeasureCache = new WeakMap<HTMLElement, { key: string; spans: MeasuredSpan[] }>()

type TextRun = {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
}

function isTextRun(item: unknown): item is TextRun {
  if (!item || typeof item !== 'object') return false
  const row = item as TextRun
  return typeof row.str === 'string' && row.str.length > 0 && Array.isArray(row.transform) && typeof row.fontName === 'string'
}

function emFraction(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const unit = Math.abs(value) > 3 ? value / 1000 : value
  return unit
}

function fontLineBox(item: TextRun, style: { ascent?: number; descent?: number } | undefined): SpanBox | null {
  const t = item.transform
  if (!t || t.length < 6) return null
  if (Math.abs(Math.atan2(t[1], t[0])) > 0.02) return null
  const fontSize = item.height && item.height > 0.4 ? item.height : Math.hypot(t[2], t[3])
  if (fontSize < 0.5) return null
  const ascent = Math.min(1.15, Math.max(0.55, emFraction(style?.ascent, 0.8)))
  const descent = Math.max(-0.45, Math.min(-0.08, emFraction(style?.descent, -0.2)))
  const x = t[4]
  const w = item.width
  const y = t[5] + descent * fontSize
  const h = (ascent - descent) * fontSize
  if (h < 0.5 || !(w > 0.4)) return null
  return { x, y, w, h }
}

/**
 * Remember each span's line box in PDF points. Preview and Acrobat store
 * highlight quads from the font box, then zoom only changes the view.
 */
export function bindTextGeometry(
  pageEl: HTMLElement,
  content: {
    items: readonly unknown[]
    styles: { [name: string]: { ascent?: number; descent?: number } | undefined }
  },
): void {
  const layer = pageEl.querySelector('.textLayer')
  if (!layer) return
  spanMeasureCache.delete(pageEl)
  const spans = [...layer.querySelectorAll('span')].filter(
    (span) => !span.classList.contains('markedContent') && (span.textContent ?? '') !== '',
  )
  let index = 0
  for (const raw of content.items) {
    if (!isTextRun(raw)) continue
    let span = spans[index]
    if (!span) break
    // An extra span (a stale layer that appended late) must not shift the rest.
    if (span.textContent !== raw.str) {
      span = spans[++index]
      if (!span || span.textContent !== raw.str) break
    }
    index++
    const box = fontLineBox(raw, content.styles[raw.fontName])
    if (box) spanBoxes.set(span, box)
  }
}

function measuredSpans(pageEl: HTMLElement): MeasuredSpan[] {
  const layer = pageEl.querySelector('.textLayer')
  if (!layer) return []
  const host = layer.getBoundingClientRect()
  const key = `${host.left.toFixed(1)}:${host.top.toFixed(1)}:${host.width.toFixed(1)}:${host.height.toFixed(1)}`
  const cached = spanMeasureCache.get(pageEl)
  if (cached && cached.key === key) return cached.spans
  const spans: MeasuredSpan[] = []
  for (const span of layer.querySelectorAll('span')) {
    const box = spanBoxes.get(span)
    if (!box) continue
    const rect = span.getBoundingClientRect()
    if (rect.width < 0.5 || rect.height < 0.5) continue
    spans.push({ box, rect })
  }
  spanMeasureCache.set(pageEl, { key, spans })
  return spans
}

function lineFontBox(pageEl: HTMLElement, rect: DOMRect): { y: number; h: number } | null {
  const lines: { y: number; top: number; mid: number; matchH: number; score: number }[] = []
  for (const { box, rect: r } of measuredSpans(pageEl)) {
    const overlapX = Math.min(rect.right, r.right) - Math.max(rect.left, r.left)
    const overlapY = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top)
    if (overlapX < 0.5 || overlapY < Math.min(rect.height, r.height) * 0.35) continue
    const mid = box.y + box.h / 2
    // Match against the line's own height. Growing the window would chain
    // the next lines into one page-tall box.
    let line = lines.find((item) => Math.abs(item.mid - mid) < Math.max(item.matchH, box.h) * 0.45)
    if (!line) {
      line = { y: box.y, top: box.y + box.h, mid, matchH: box.h, score: 0 }
      lines.push(line)
    }
    line.y = Math.min(line.y, box.y)
    line.top = Math.max(line.top, box.y + box.h)
    line.score += overlapX
  }
  if (lines.length === 0) return null
  lines.sort((a, b) => b.score - a.score)
  const best = lines[0]
  return { y: best.y, h: best.top - best.y }
}

/** Line box under a highlight quad, in PDF points. Zoom never changes the match. */
function lineForQuad(pageEl: HTMLElement, quad: Quad): SpanBox | null {
  const layer = pageEl.querySelector('.textLayer')
  if (!layer) return null
  const lines: SpanBox[] = []
  const scores: number[] = []
  const mids: number[] = []
  const matchH: number[] = []
  for (const span of layer.querySelectorAll('span')) {
    const box = spanBoxes.get(span)
    if (!box) continue
    const overlapX = Math.min(quad.x + quad.w, box.x + box.w) - Math.max(quad.x, box.x)
    const overlapY = Math.min(quad.y + quad.h, box.y + box.h) - Math.max(quad.y, box.y)
    if (overlapX < 0.4 || overlapY < Math.min(quad.h, box.h) * 0.35) continue
    const mid = box.y + box.h / 2
    let i = mids.findIndex((item, index) => Math.abs(item - mid) < Math.max(matchH[index], box.h) * 0.45)
    if (i < 0) {
      i = lines.length
      lines.push({ ...box })
      scores.push(0)
      mids.push(mid)
      matchH.push(box.h)
    }
    const line = lines[i]
    const y = Math.min(line.y, box.y)
    const top = Math.max(line.y + line.h, box.y + box.h)
    const x = Math.min(line.x, box.x)
    const right = Math.max(line.x + line.w, box.x + box.w)
    line.x = x
    line.y = y
    line.w = right - x
    line.h = top - y
    scores[i] += overlapX
  }
  if (lines.length === 0) return null
  let best = 0
  for (let i = 1; i < lines.length; i++) if (scores[i] > scores[best]) best = i
  return lines[best]
}

/** Snap a highlight's vertical edge to the font line box. Page points, so zoom does not move it again. */
export function stabilizeHighlights(pageEl: HTMLElement, _viewport: PageViewport, marks: Mark[]): boolean {
  const page = Number(pageEl.dataset.page)
  let changed = false
  for (const mark of marks) {
    if (mark.kind !== 'highlight' || mark.page !== page) continue
    for (const quad of mark.quads) {
      const font = lineForQuad(pageEl, quad)
      if (!font) continue
      const padY = font.h * 0.04
      const fontY = font.y - padY
      const fontTop = font.y + font.h + padY
      const covers = quad.y <= fontY + 0.4 && quad.y + quad.h >= fontTop - 0.4
      const tooTall = quad.h > font.h * 1.8
      if (covers && !tooTall) continue
      const y = tooTall ? fontY : Math.min(quad.y, fontY)
      const top = tooTall ? fontTop : Math.max(quad.y + quad.h, fontTop)
      if (Math.abs(quad.y - y) < 0.35 && Math.abs(quad.h - (top - y)) < 0.35) continue
      quad.y = y
      quad.h = top - y
      changed = true
    }
  }
  return changed
}

function clientRectToQuad(pageEl: HTMLElement, viewport: PageViewport, rect: DOMRect): Quad {
  const a = clientPointToPdf(pageEl, viewport, rect.left, rect.bottom)
  const b = clientPointToPdf(pageEl, viewport, rect.right, rect.top)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

/** One PDF quad for a browser selection rect. Horizontal from the selection, vertical from the font line box. */
function fragmentFromRect(pageEl: HTMLElement, viewport: PageViewport, rect: DOMRect): Quad | null {
  if (rect.width < 0.5 || rect.height < 0.5) return null
  const dom = clientRectToQuad(pageEl, viewport, rect)
  if (dom.w <= 0.4 || dom.h <= 0.4) return null
  const font = lineFontBox(pageEl, rect)
  const padX = 0.35
  const y0 = font ? Math.min(dom.y, font.y) : dom.y
  const top = font ? Math.max(dom.y + dom.h, font.y + font.h) : dom.y + dom.h
  const padY = (top - y0) * 0.04
  return { x: dom.x - padX, y: y0 - padY, w: dom.w + padX * 2, h: top - y0 + padY * 2 }
}

/** Join words on the same baseline into one bar. Gaps are in PDF points, so zoom does not split or merge them. */
function mergePdfLines(quads: Quad[]): Quad[] {
  const pending = quads.map((quad) => ({ ...quad }))
  pending.sort((a, b) => b.y + b.h - (a.y + a.h) || a.x - b.x)
  const lines: Quad[][] = []
  for (const quad of pending) {
    const line = lines.find((group) => {
      const other = group[0]
      const overlap = Math.min(other.y + other.h, quad.y + quad.h) - Math.max(other.y, quad.y)
      return overlap > Math.min(other.h, quad.h) * 0.5
    })
    if (line) line.push(quad)
    else lines.push([quad])
  }
  const out: Quad[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    let cur = { ...line[0] }
    for (const quad of line.slice(1)) {
      const gap = quad.x - (cur.x + cur.w)
      if (gap < Math.max(cur.h, quad.h) * 1.25) {
        const x = Math.min(cur.x, quad.x)
        const y = Math.min(cur.y, quad.y)
        const right = Math.max(cur.x + cur.w, quad.x + quad.w)
        const top = Math.max(cur.y + cur.h, quad.y + quad.h)
        cur = { x, y, w: right - x, h: top - y }
      } else {
        out.push(cur)
        cur = { ...quad }
      }
    }
    out.push(cur)
  }
  return out.filter((quad) => quad.w > 0.4 && quad.h > 0.4)
}

function quadsFromRange(range: Range, pageEl: HTMLElement, viewport: PageViewport): Quad[] {
  const pageBox = contentBox(pageEl)
  const fragments: Quad[] = []
  for (const rect of range.getClientRects()) {
    const overlap =
      rect.right > pageBox.left &&
      rect.left < pageBox.right &&
      rect.bottom > pageBox.top &&
      rect.top < pageBox.bottom
    if (!overlap) continue
    const quad = fragmentFromRect(pageEl, viewport, rect)
    if (quad) fragments.push(quad)
  }
  return mergePdfLines(fragments)
}

export function selectionToQuads(
  pageEl: HTMLElement,
  viewport: PageViewport,
): { quads: Quad[]; text: string } | null {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return null
  const quads: Quad[] = []
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i)
    if (!pageEl.contains(range.commonAncestorContainer) && !range.intersectsNode(pageEl)) continue
    quads.push(...quadsFromRange(range, pageEl, viewport))
  }
  const merged = mergePdfLines(quads)
  if (merged.length === 0) return null
  return { quads: merged, text: selection.toString() }
}

export function rangeToQuads(
  range: Range,
  pageEl: HTMLElement,
  viewport: PageViewport,
): { quads: Quad[]; text: string } | null {
  const quads = quadsFromRange(range, pageEl, viewport)
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

function elementRect(node: Node): DOMRect | null {
  const el = node instanceof Element ? node : node.parentElement
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 0.5 && rect.height < 0.5) return null
  return rect
}

function rangeClientRects(range: Range): DOMRect[] {
  const rects: DOMRect[] = []
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode()
  while (node) {
    if (range.intersectsNode(node) && node.textContent) {
      const start = node === range.startContainer ? range.startOffset : 0
      const end = node === range.endContainer ? range.endOffset : node.textContent.length
      const slice = textSliceRect(node, start, end)
      if (slice) rects.push(slice)
    }
    node = walker.nextNode()
  }
  if (rects.length > 0) return rects
  return [...range.getClientRects()]
}

function textSliceRect(node: Node, start: number, end: number): DOMRect | null {
  const text = node.textContent ?? ''
  const box = elementRect(node)
  if (!box || end <= start || text.length === 0) return null
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  if (to <= from) return null
  const left = box.left + (box.width * from) / text.length
  const right = box.left + (box.width * to) / text.length
  const pad = Math.min(1.5, box.height * 0.06)
  const atStart = from === 0
  const atEnd = to === text.length
  const x = left - (atStart ? pad : 0)
  const r = right + (atEnd ? pad : 0)
  return new DOMRect(x, box.top, Math.max(0.5, r - x), box.height)
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
    if (!glyphsTouch(elementRect(prev), elementRect(startNode))) break
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
    if (!glyphsTouch(elementRect(endNode), elementRect(next))) break
    endNode = next
    endOffset = 0
  }

  if (startNode === endNode && endOffset <= startOffset) return null
  const out = document.createRange()
  out.setStart(startNode, startOffset)
  out.setEnd(endNode, endOffset)
  if (!pointInClientRects(clientX, clientY, rangeClientRects(out))) return null
  return out
}

function pointInClientRects(x: number, y: number, rects: Iterable<DOMRect>): boolean {
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
  if (mark.kind === 'text' || mark.kind === 'marker' || mark.kind === 'image') return false
  return mark.quads.some((mq) => quads.some((q) => quadsOverlap(mq, q)))
}

function dist2ToSeg(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 <= 0) {
    const ex = x - a.x
    const ey = y - a.y
    return ex * ex + ey * ey
  }
  let t = ((x - a.x) * dx + (y - a.y) * dy) / len2
  t = Math.min(1, Math.max(0, t))
  const px = a.x + t * dx
  const py = a.y + t * dy
  const ex = x - px
  const ey = y - py
  return ex * ex + ey * ey
}

export function pointHitsMarker(x: number, y: number, points: Point[], width: number): boolean {
  const r = Math.max(width, 8) / 2
  const r2 = r * r
  if (points.length === 0) return false
  if (points.length === 1) {
    const dx = x - points[0].x
    const dy = y - points[0].y
    return dx * dx + dy * dy <= r2
  }
  for (let i = 1; i < points.length; i++) {
    if (dist2ToSeg(x, y, points[i - 1], points[i]) <= r2) return true
  }
  return false
}

export function roughlySameRegion(a: Quad[], b: Quad[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const covered = b.filter((bq) => a.some((aq) => quadsOverlap(aq, bq))).length
  return covered / b.length >= 0.6
}

export function collapseStackedMarks(marks: Mark[]): Mark[] {
  const kept: Mark[] = []
  for (const mark of marks) {
    if (mark.kind === 'text' || mark.kind === 'marker' || mark.kind === 'image') {
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
  onTextChange: (id: string, content: string, html: string) => void,
  onTextMove: (id: string, x: number, y: number, began?: boolean) => void,
  onTextResize: (id: string, width: number, fontSize: number, began?: boolean) => void,
  onTextCommit: (id: string) => void,
  onTextDelete: (id: string) => void,
  imageUrls: Map<string, string>,
  onImageChange: (id: string, next: Pick<ImageMark, 'x' | 'y' | 'w' | 'h' | 'rotation'>, began?: boolean) => void,
  onImageDelete: (id: string) => void,
): void {
  const layer = pageEl.querySelector<HTMLElement>('.annot-layer')
  if (!layer) return
  layer.replaceChildren()
  for (const old of pageEl.querySelectorAll(':scope > .mark-text, :scope > .mark-image')) old.remove()

  const page = Number(pageEl.dataset.page)
  for (const mark of marks) {
    if (mark.page !== page) continue
    if (mark.kind === 'text') {
      // Above the PDF text layer. Marks inside .annot-layer stay underneath it.
      pageEl.append(
        renderTextMark(
          mark,
          viewport,
          pageEl,
          selectedId,
          onSelect,
          onTextChange,
          onTextMove,
          onTextResize,
          onTextCommit,
          onTextDelete,
        ),
      )
    } else if (mark.kind === 'image') {
      const src = imageUrls.get(mark.imageId)
      if (!src) continue
      pageEl.append(renderImageMark(mark, src, viewport, pageEl, selectedId, onSelect, onImageChange, onImageDelete))
    } else if (mark.kind === 'marker') {
      layer.append(renderMarkerMark(mark, viewport, selectedId, onSelect))
    } else {
      layer.append(renderQuadMark(mark, viewport, selectedId, onSelect))
    }
  }
}

function markerCssPath(points: Point[], viewport: PageViewport): string {
  return points
    .map((p, i) => {
      const [x, y] = viewport.convertToViewportPoint(p.x, p.y)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function applyImageBox(el: HTMLElement, mark: Pick<ImageMark, 'x' | 'y' | 'w' | 'h' | 'rotation'>, viewport: PageViewport): void {
  const box = pdfQuadToCss({ x: mark.x, y: mark.y, w: mark.w, h: mark.h }, viewport)
  el.style.left = `${box.left}px`
  el.style.top = `${box.top}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
  el.style.transformOrigin = 'center center'
  el.style.transform = mark.rotation ? `rotate(${mark.rotation}deg)` : ''
}

function renderImageMark(
  mark: ImageMark,
  src: string,
  viewport: PageViewport,
  pageEl: HTMLElement,
  selectedId: string | null,
  onSelect: (id: string) => void,
  onImageChange: (id: string, next: Pick<ImageMark, 'x' | 'y' | 'w' | 'h' | 'rotation'>, began?: boolean) => void,
  onImageDelete: (id: string) => void,
): HTMLElement {
  const el = document.createElement('div')
  el.className = `mark mark-image${selectedId === mark.id ? ' selected' : ''}`
  el.dataset.id = mark.id
  applyImageBox(el, mark, viewport)

  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  img.draggable = false

  const resize = document.createElement('div')
  resize.className = 'image-resize'
  resize.title = 'Scale'
  resize.setAttribute('role', 'button')
  resize.setAttribute('aria-label', 'Scale')

  const rotate = document.createElement('div')
  rotate.className = 'image-rotate'
  rotate.title = 'Rotate'
  rotate.setAttribute('role', 'button')
  rotate.setAttribute('aria-label', 'Rotate')

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'image-delete'
  remove.title = 'Delete'
  remove.textContent = '×'
  remove.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  remove.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onImageDelete(mark.id)
  })

  const live = { x: mark.x, y: mark.y, w: mark.w, h: mark.h, rotation: mark.rotation }

  resize.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(mark.id)
    const originW = live.w
    const originH = live.h
    const cx = live.x + live.w / 2
    const cy = live.y + live.h / 2
    const start = clientPointToPdf(pageEl, viewport, e.clientX, e.clientY)
    const startDist = Math.hypot(start.x - cx, start.y - cy) || 1
    const pointerId = e.pointerId
    try {
      resize.setPointerCapture(pointerId)
    } catch {
      /* synthetic / already released */
    }
    let started = false
    const move = (ev: PointerEvent) => {
      const now = clientPointToPdf(pageEl, viewport, ev.clientX, ev.clientY)
      const scale = Math.max(0.08, Math.hypot(now.x - cx, now.y - cy) / startDist)
      const w = Math.max(16, originW * scale)
      const h = Math.max(16, originH * scale)
      live.w = w
      live.h = h
      live.x = cx - w / 2
      live.y = cy - h / 2
      onImageChange(mark.id, { ...live }, !started)
      started = true
      applyImageBox(el, live, viewport)
    }
    const up = () => {
      try {
        resize.releasePointerCapture(pointerId)
      } catch {
        /* already released */
      }
      resize.removeEventListener('pointermove', move)
      resize.removeEventListener('pointerup', up)
    }
    resize.addEventListener('pointermove', move)
    resize.addEventListener('pointerup', up)
  })

  rotate.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(mark.id)
    const box = pdfQuadToCss({ x: live.x, y: live.y, w: live.w, h: live.h }, viewport)
    const pageBox = contentBox(pageEl)
    const sx = pageBox.width / viewport.width
    const sy = pageBox.height / viewport.height
    const cx = pageBox.left + (box.left + box.width / 2) * sx
    const cy = pageBox.top + (box.top + box.height / 2) * sy
    const startAngle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
    const originRot = live.rotation
    const pointerId = e.pointerId
    try {
      rotate.setPointerCapture(pointerId)
    } catch {
      /* synthetic / already released */
    }
    let started = false
    const move = (ev: PointerEvent) => {
      const now = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI
      live.rotation = originRot + (now - startAngle)
      onImageChange(mark.id, { ...live }, !started)
      started = true
      applyImageBox(el, live, viewport)
    }
    const up = () => {
      try {
        rotate.releasePointerCapture(pointerId)
      } catch {
        /* already released */
      }
      rotate.removeEventListener('pointermove', move)
      rotate.removeEventListener('pointerup', up)
    }
    rotate.addEventListener('pointermove', move)
    rotate.addEventListener('pointerup', up)
  })

  const beginDrag = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const originX = live.x
    const originY = live.y
    const start = clientPointToPdf(pageEl, viewport, e.clientX, e.clientY)
    const pointerId = e.pointerId
    let dragging = false
    let started = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      if (!dragging) {
        if (Math.hypot(dx, dy) < 4) return
        dragging = true
        el.classList.add('selected', 'dragging')
        try {
          el.setPointerCapture(pointerId)
        } catch {
          /* pointer is no longer active */
        }
      }
      const now = clientPointToPdf(pageEl, viewport, ev.clientX, ev.clientY)
      live.x = originX + (now.x - start.x)
      live.y = originY + (now.y - start.y)
      onImageChange(mark.id, { ...live }, !started)
      started = true
      applyImageBox(el, live, viewport)
    }
    const up = () => {
      el.classList.remove('dragging')
      if (dragging) {
        try {
          el.releasePointerCapture(pointerId)
        } catch {
          /* already released */
        }
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!dragging) onSelect(mark.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  el.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('.image-resize, .image-rotate, .image-delete')) return
    beginDrag(e)
  })

  el.append(img, rotate, resize, remove)
  return el
}

function renderMarkerMark(
  mark: MarkerMark,
  viewport: PageViewport,
  selectedId: string | null,
  onSelect: (id: string) => void,
): HTMLElement {
  const group = document.createElement('div')
  group.className = `mark mark-marker${selectedId === mark.id ? ' selected' : ''}`
  group.dataset.id = mark.id
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'mark-stroke')
  svg.setAttribute('width', String(viewport.width))
  svg.setAttribute('height', String(viewport.height))
  svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`)
  svg.setAttribute('aria-hidden', 'true')
  const d = markerCssPath(mark.points, viewport)
  const stroke = Math.max(2, mark.width * viewport.scale)
  if (selectedId === mark.id && d) {
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    outline.setAttribute('class', 'mark-path-outline')
    outline.setAttribute('d', d)
    outline.setAttribute('fill', 'none')
    outline.setAttribute('stroke-width', String(stroke + 3))
    outline.setAttribute('stroke-linecap', 'round')
    outline.setAttribute('stroke-linejoin', 'round')
    svg.append(outline)
  }
  if (d) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('class', 'mark-path')
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', cssColor(mark.color, 0.45))
    path.setAttribute('stroke-width', String(stroke))
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.append(path)
  }
  group.append(svg)
  group.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    onSelect(mark.id)
  })
  return group
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
    const ink = cssColor(mark.color)
    const thickness = Math.max(1, box.height * 0.07)
    if (mark.kind === 'highlight') {
      el.style.background = cssColor(mark.color, 0.45)
      el.style.borderRadius = `${Math.min(3, box.height * 0.12)}px`
    } else if (mark.kind === 'underline') {
      const y = Math.max(0, box.height * 0.8 - thickness)
      el.style.background = `linear-gradient(${ink}, ${ink}) 0 ${y}px / 100% ${thickness}px no-repeat`
    } else {
      const y = Math.max(0, box.height * 0.42)
      el.style.background = `linear-gradient(${ink}, ${ink}) 0 ${y}px / 100% ${thickness}px no-repeat`
    }
    group.append(el)
  }
  group.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    onSelect(mark.id)
  })
  return group
}

const DEFAULT_TEXT_WIDTH = 180

function plainFromHtml(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  return (root.innerText ?? '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function initialHtml(mark: TextMark): string {
  if (mark.html) return mark.html
  if (!mark.content) return ''
  return escapeHtml(mark.content).replace(/\n/g, '<br>')
}

function sanitizeTextHtml(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  const walk = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode((node.textContent ?? '').replace(/\u200b/g, ''))
    if (!(node instanceof HTMLElement)) return null
    const tag = node.tagName
    if (tag === 'BR') return document.createElement('br')
    const allowed =
      tag === 'B' ||
      tag === 'STRONG' ||
      tag === 'I' ||
      tag === 'EM' ||
      tag === 'U' ||
      tag === 'S' ||
      tag === 'STRIKE' ||
      tag === 'DEL' ||
      tag === 'UL' ||
      tag === 'OL' ||
      tag === 'LI' ||
      tag === 'DIV' ||
      tag === 'P' ||
      tag === 'SPAN' ||
      tag === 'FONT'
    if (!allowed) {
      const frag = document.createDocumentFragment()
      for (const child of [...node.childNodes]) {
        const next = walk(child)
        if (next) frag.append(next)
      }
      return frag
    }
    const el = document.createElement(
      tag === 'FONT' || tag === 'STRONG'
        ? tag === 'STRONG'
          ? 'b'
          : 'span'
        : tag === 'EM'
          ? 'i'
          : tag === 'STRIKE' || tag === 'DEL'
            ? 's'
            : tag.toLowerCase(),
    )
    const color = node.style.color || (tag === 'FONT' ? node.getAttribute('color') ?? '' : '')
    const bg = node.style.backgroundColor
    if (color) el.style.color = color
    const deco = `${node.style.textDecoration} ${node.style.textDecorationLine}`
    const parts: string[] = []
    if (deco.includes('underline')) parts.push('underline')
    if (deco.includes('line-through')) parts.push('line-through')
    if (parts.length) el.style.textDecoration = parts.join(' ')
    const bullet = node.dataset.bullet === '1' || node.classList.contains('li-bullet')
    if (bullet) {
      el.dataset.bullet = '1'
      el.classList.add('li-bullet')
    }
    const blockish = tag === 'LI' || tag === 'DIV' || tag === 'P' || tag === 'UL' || tag === 'OL'
    const paintBg = Boolean(bg) && !isClearBg(bg) && !blockish
    if (paintBg) el.style.backgroundColor = bg
    for (const child of [...node.childNodes]) {
      const next = walk(child)
      if (next) el.append(next)
    }
    if (blockish && bg && !isClearBg(bg)) {
      const already = [...el.querySelectorAll<HTMLElement>('*')].some(
        (n) => n.style.backgroundColor && !isClearBg(n.style.backgroundColor),
      )
      if (!already && el.childNodes.length > 0) {
        const span = document.createElement('span')
        span.style.backgroundColor = bg
        while (el.firstChild) span.append(el.firstChild)
        el.append(span)
      }
    }
    if (bullet && !(el.textContent ?? '').includes('•')) el.textContent = '•'
    if (el.tagName === 'LI') ensureBullet(el)
    return el
  }
  const out = document.createElement('div')
  for (const child of [...root.childNodes]) {
    const next = walk(child)
    if (next) out.append(next)
  }
  return out.innerHTML
}

function isClearBg(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return true
  return /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(v)
}

const INK_COLORS = ['#111111', '#6b7280', '#e5484d', '#f76808', '#e8b931', '#30a46c', '#0090ff', '#8e4ec6']
const BG_COLORS: (string | null)[] = [null, '#fff3a1', '#c8f5d4', '#cce5ff', '#ffd6e8', '#ffe0c2', '#ececee']

function styleCommand(editor: HTMLElement, command: string, value?: string): void {
  editor.focus()
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(command, false, value)
}

function resolvedCss(prop: 'color' | 'backgroundColor', value: string): string {
  const probe = document.createElement('span')
  probe.style[prop] = value
  probe.style.display = 'none'
  document.body.append(probe)
  const out = getComputedStyle(probe)[prop]
  probe.remove()
  return out
}

function placeRange(range: Range): void {
  const sel = document.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Move the caret out of a colored span so the next characters are not stuck with it. */
function leaveStyledSpan(span: HTMLElement): void {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!span.contains(range.startContainer) && range.startContainer !== span) return
  const parent = span.parentNode
  if (!parent) return
  const after = document.createRange()
  after.selectNodeContents(span)
  after.setStart(range.startContainer, range.startOffset)
  const tail = after.extractContents()
  const tailText = (tail.textContent ?? '').replace(/\u200b/g, '')
  const tailEmpty = !tailText && ![...tail.childNodes].some((node) => node.nodeName === 'BR')
  if (!tailEmpty) {
    const right = span.cloneNode(false) as HTMLElement
    right.removeAttribute('data-typing')
    right.append(tail)
    span.after(right)
  }
  const next = document.createRange()
  if (!(span.textContent ?? '').replace(/\u200b/g, '') && !span.querySelector('br')) {
    const previous = span.previousSibling
    const following = span.nextSibling
    span.remove()
    if (following) next.setStartBefore(following)
    else if (previous) next.setStartAfter(previous)
    else next.setStart(parent, parent.childNodes.length)
  } else next.setStartAfter(span)
  next.collapse(true)
  placeRange(next)
}

function exitInlineStyles(editor: HTMLElement): void {
  for (let i = 0; i < 8; i++) {
    const sel = document.getSelection()
    const node = sel?.anchorNode
    if (!node || !editor.contains(node)) return
    let styled: HTMLElement | null = null
    let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement
    while (el && el !== editor) {
      const colored = Boolean(el.style.color)
      const highlighted = Boolean(el.style.backgroundColor) && !isClearBg(el.style.backgroundColor)
      if (isInline(el) && (colored || highlighted)) styled = el
      el = el.parentElement
    }
    if (!styled) return
    leaveStyledSpan(styled)
  }
}

function hasInline(node: Node, editor: HTMLElement, kind: 'bold' | 'italic' | 'underline' | 'strike'): boolean {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement
  while (el && el !== editor) {
    const deco = `${el.style.textDecoration} ${el.style.textDecorationLine}`
    if (kind === 'bold' && (el.tagName === 'B' || el.tagName === 'STRONG')) return true
    if (kind === 'italic' && (el.tagName === 'I' || el.tagName === 'EM')) return true
    if (kind === 'bold' && (el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 600)) return true
    if (kind === 'italic' && (el.style.fontStyle === 'italic' || el.style.fontStyle === 'oblique')) return true
    if (kind === 'underline' && (el.tagName === 'U' || deco.includes('underline'))) return true
    if (
      kind === 'strike' &&
      (el.tagName === 'S' || el.tagName === 'STRIKE' || el.tagName === 'DEL' || deco.includes('line-through'))
    )
      return true
    el = el.parentElement
  }
  return false
}

function stylesAt(node: Node, editor: HTMLElement): { color: string; bg: string } {
  let color = getComputedStyle(editor).color
  let bg = 'transparent'
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement
  while (el && el !== editor) {
    if (el.style.color) color = getComputedStyle(el).color
    if (el.style.backgroundColor && !isClearBg(el.style.backgroundColor)) bg = getComputedStyle(el).backgroundColor
    el = el.parentElement
  }
  return { color, bg }
}

type TypingStyle = { color: string; bg: string }

/** Set when the caret's next characters should ignore the span they were in. */
const pendingTyping = new WeakMap<HTMLElement, TypingStyle>()

function styleAgrees(el: HTMLElement, pending: TypingStyle): boolean {
  const hasBg = Boolean(el.style.backgroundColor) && !isClearBg(el.style.backgroundColor)
  const wantBg = !isClearBg(pending.bg)
  if (hasBg !== wantBg) return false
  if (hasBg && wantBg && getComputedStyle(el).backgroundColor !== pending.bg) return false
  if (el.style.color && getComputedStyle(el).color !== pending.color) return false
  return true
}

/** Pull a just-typed node out of a span whose color does not match the choice. */
function rescueTyped(node: Node, editor: HTMLElement, pending: TypingStyle): void {
  let parent = node.parentElement
  while (parent && parent !== editor && isInline(parent)) {
    if (styleAgrees(parent, pending)) break
    const previous = parent
    previous.after(node)
    if (!(previous.textContent ?? '').replace(/\u200b/g, '') && !previous.querySelector('br')) previous.remove()
    parent = node.parentElement
  }
}

function unwrapMismatchedBreaks(editor: HTMLElement, pending: TypingStyle): void {
  const sel = document.getSelection()
  if (!sel?.anchorNode || !editor.contains(sel.anchorNode)) return
  for (const el of [...editor.querySelectorAll<HTMLElement>('span, font')]) {
    if (!el.isConnected || styleAgrees(el, pending)) continue
    const meaningful = [...el.childNodes].some(
      (node) => node.nodeName !== 'BR' && (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').replace(/\u200b/g, '') !== ''),
    )
    if (meaningful) continue
    const parent = el.parentNode
    if (!parent) continue
    const caretInside = el.contains(sel.anchorNode)
    const next = el.nextSibling
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    el.remove()
    if (!caretInside) continue
    const range = document.createRange()
    if (next?.parentNode) range.setStartBefore(next)
    else range.setStart(parent, parent.childNodes.length)
    range.collapse(true)
    placeRange(range)
  }
}

function insertPendingText(editor: HTMLElement, data: string, pending: TypingStyle): void {
  exitInlineStyles(editor)
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return
  const base = getComputedStyle(editor).color
  const wantBg = !isClearBg(pending.bg)
  const wantInk = pending.color !== base
  const range = sel.getRangeAt(0)
  range.deleteContents()
  let typed: Node
  if (!wantBg && !wantInk) typed = document.createTextNode(data)
  else {
    const span = document.createElement('span')
    if (wantInk) span.style.color = pending.color
    if (wantBg) span.style.backgroundColor = pending.bg
    span.textContent = data
    typed = span
  }
  range.insertNode(typed)
  rescueTyped(typed, editor, pending)
  const text = typed.nodeType === Node.TEXT_NODE ? typed : typed.firstChild
  if (text) placeCaret(text, text.textContent?.length ?? data.length)
}

/** Collapsed caret: remember the color so the next characters are not stuck in the old span. */
function setTypingStyle(editor: HTMLElement, color: string, bg: string): void {
  exitInlineStyles(editor)
  pendingTyping.set(editor, { color, bg })
}

function clearSelectionBackground(editor: HTMLElement): void {
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  for (const span of [...editor.querySelectorAll<HTMLElement>('span, font')]) {
    if (!span.style.backgroundColor || isClearBg(span.style.backgroundColor)) continue
    if (!range.intersectsNode(span)) continue
    span.style.backgroundColor = ''
    if (!span.style.color && !span.getAttribute('style')?.trim()) {
      span.replaceWith(...span.childNodes)
    }
  }
}

function caretInEditor(editor: HTMLElement): { node: Node; offset: number } | null {
  const sel = document.getSelection()
  if (!sel || !sel.isCollapsed || !sel.anchorNode || !editor.contains(sel.anchorNode)) return null
  return { node: sel.anchorNode, offset: sel.anchorOffset }
}

function isBullet(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.bullet === '1'
}

function bulletSpan(): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'li-bullet'
  span.dataset.bullet = '1'
  span.textContent = '•'
  return span
}

function ensureBullet(li: HTMLElement): HTMLElement {
  const existing = [...li.childNodes].find((node) => isBullet(node))
  if (existing instanceof HTMLElement) {
    if (existing !== li.firstChild) li.prepend(existing)
    return existing
  }
  const span = bulletSpan()
  li.prepend(span)
  return span
}

function firstText(root: Node): Text | null {
  if (root.nodeType === Node.TEXT_NODE) return root as Text
  for (const child of root.childNodes) {
    if (child.nodeName === 'BR') continue
    if (isBullet(child)) continue
    if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) continue
    const found = firstText(child)
    if (found) return found
  }
  return null
}

function listItem(node: Node | null): HTMLLIElement | null {
  const el = node instanceof Element ? node : node?.parentElement
  return el?.closest('li') ?? null
}

function itemText(li: HTMLElement): string {
  let text = ''
  for (const child of li.childNodes) {
    if (isBullet(child)) continue
    if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) continue
    text += child.textContent ?? ''
  }
  return text.replace(/\u00a0/g, ' ').trim()
}

function siblingsAfter(node: Node): Node[] {
  const out: Node[] = []
  let next = node.nextSibling
  while (next) {
    out.push(next)
    next = next.nextSibling
  }
  return out
}

function isInline(node: Node): boolean {
  return node instanceof HTMLElement && ['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'FONT', 'A'].includes(node.tagName)
}

/** Only the row the caret is on. A `<br>` inside a div is a new row, not part of the row above. */
function caretLine(editor: HTMLElement): { parent: Node; nodes: Node[]; prev: ChildNode | null; after: ChildNode | null } | null {
  const initial = caretInEditor(editor)
  if (!initial || listItem(initial.node) || !editor.contains(initial.node)) return null
  splitSoftBreak(initial.node, initial.offset)
  const caret = caretInEditor(editor)
  if (!caret || !editor.contains(caret.node)) return null

  let parent: Node
  let index: number
  if (caret.node instanceof Element) {
    parent = caret.node
    index = caret.offset
  } else {
    parent = caret.node.parentNode!
    index = [...parent.childNodes].indexOf(caret.node as ChildNode)
  }
  while (parent !== editor && parent.parentNode && isInline(parent)) {
    const up = parent.parentNode
    index = [...up.childNodes].indexOf(parent as ChildNode)
    parent = up
  }
  if (parent !== editor && !editor.contains(parent)) return null

  const kids = [...parent.childNodes]
  let start = Math.min(Math.max(index, 0), kids.length)
  while (start > 0 && kids[start - 1].nodeName !== 'BR') start--
  let end = Math.min(Math.max(index, 0), kids.length)
  while (end < kids.length && kids[end].nodeName !== 'BR') end++
  // `<div><br></div>` — the br is the empty row, not a break before another row.
  if (start === end && kids[end]?.nodeName === 'BR' && (start === 0 || kids[start - 1]?.nodeName === 'BR')) end++

  return {
    parent,
    nodes: kids.slice(start, end),
    prev: start > 0 ? kids[start - 1] : null,
    after: kids[end] ?? null,
  }
}

function placeCaret(node: Node, offset: number): void {
  const sel = document.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.setStart(node, Math.min(offset, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length))
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

function placeCaretAtStart(el: HTMLElement): void {
  const text = firstText(el)
  if (text && el.contains(text)) placeCaret(text, 0)
  else placeCaret(el, 0)
}

function atVisualLineStart(node: Node, offset: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const chunk = (node.textContent ?? '').slice(0, offset)
    if ((chunk.split('\n').pop() ?? '').replace(/\u00a0/g, '') !== '') return false
    if (chunk.includes('\n')) return true
  } else if (node instanceof Element) {
    for (let i = offset - 1; i >= 0; i--) {
      const child = node.childNodes[i]
      if (!child || child.nodeName === 'BR') return true
      if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').includes('\n')) {
        const tail = (child.textContent ?? '').split('\n').pop() ?? ''
        return tail.replace(/\u00a0/g, '') === ''
      }
      if ((child.textContent ?? '').replace(/\u00a0/g, '') !== '') return false
    }
    return true
  }
  let prev = node.previousSibling
  while (prev) {
    if (isBullet(prev)) {
      prev = prev.previousSibling
      continue
    }
    if (prev.nodeName === 'BR') return true
    if (prev.nodeType === Node.TEXT_NODE && (prev.textContent ?? '').includes('\n')) {
      const tail = (prev.textContent ?? '').split('\n').pop() ?? ''
      return tail.replace(/\u00a0/g, '') === ''
    }
    if ((prev.textContent ?? '').replace(/\u00a0/g, '') !== '') return false
    prev = prev.previousSibling
  }
  return true
}

/** A newline inside one text node is still a new row. Split it so only that row is bulleted. */
function splitSoftBreak(node: Node, offset: number): void {
  if (node.nodeType !== Node.TEXT_NODE) return
  const value = node.textContent ?? ''
  const nl = value.slice(0, offset).lastIndexOf('\n')
  if (nl < 0) return
  const tail = value.slice(nl + 1)
  node.textContent = value.slice(0, nl)
  const next = document.createTextNode(tail)
  const br = document.createElement('br')
  node.parentNode?.insertBefore(br, node.nextSibling)
  br.parentNode?.insertBefore(next, br.nextSibling)
  placeCaret(next, Math.min(offset - nl - 1, tail.length))
}

function stripListMarker(text: Text): void {
  const value = text.textContent ?? ''
  const cut = /^[-*+](?:[ \u00a0]|$)/.exec(value)
  if (!cut) return
  text.textContent = value.slice(value.startsWith('- ') || value.startsWith('* ') || value.startsWith('+ ') || value[1] === '\u00a0' ? 2 : 1)
}

/** Turn the caret's row into a bullet. Rows above it stay plain text. */
function bulletCaretLine(editor: HTMLElement, stripMarker: boolean): void {
  const line = caretLine(editor)
  if (!line) return
  const { parent, nodes, after } = line
  let { prev } = line
  const text = nodes.map((node) => firstText(node)).find((node): node is Text => Boolean(node)) ?? null
  if (stripMarker) {
    if (!text || !/^[-*+](?:[ \u00a0]|$)/.test(text.textContent ?? '')) return
    stripListMarker(text)
  }

  const li = document.createElement('li')
  const wholeBlock =
    parent instanceof HTMLElement &&
    parent !== editor &&
    (parent.tagName === 'DIV' || parent.tagName === 'P') &&
    nodes.length === parent.childNodes.length
  if (wholeBlock && parent instanceof HTMLElement) {
    prev = parent.previousSibling as ChildNode | null
    while (parent.firstChild) li.append(parent.firstChild)
  } else if (nodes.length === 1 && nodes[0] instanceof HTMLElement && (nodes[0].tagName === 'DIV' || nodes[0].tagName === 'P')) {
    const block = nodes[0]
    while (block.firstChild) li.append(block.firstChild)
    block.remove()
  } else {
    for (const node of nodes) li.append(node)
  }
  while (li.lastChild?.nodeName === 'BR' && li.childNodes.length > 1) li.lastChild.remove()
  if (!li.childNodes.length || (li.childNodes.length === 1 && li.firstChild?.nodeName === 'BR' && (li.firstChild as HTMLBRElement))) {
    li.replaceChildren(document.createElement('br'))
  }
  ensureBullet(li)

  const prevList = prev instanceof HTMLElement && prev.tagName === 'UL' ? prev : null
  if (prevList) {
    prevList.append(li)
    if (wholeBlock && parent.parentNode) parent.remove()
  } else {
    const ul = document.createElement('ul')
    ul.append(li)
    if (wholeBlock && parent.parentNode) parent.replaceWith(ul)
    else parent.insertBefore(ul, after)
    if (prev?.nodeName === 'BR') prev.remove()
  }
  placeCaretAtStart(li)
}

function promoteDashBullet(editor: HTMLElement): void {
  const caret = caretInEditor(editor)
  if (!caret || listItem(caret.node) || !atVisualLineStart(caret.node, caret.offset)) return
  bulletCaretLine(editor, true)
}

function outdentItem(li: HTMLLIElement): void {
  const ul = li.parentElement
  if (!(ul instanceof HTMLUListElement) && !(ul instanceof HTMLOListElement)) return
  const grand = ul.parentElement
  if (grand instanceof HTMLLIElement) {
    const rest = siblingsAfter(li)
    if (rest.length) {
      const holder = document.createElement('ul')
      for (const node of rest) holder.append(node)
      li.append(holder)
    }
    grand.after(li)
    if (!ul.querySelector('li')) ul.remove()
    placeCaretAtStart(li)
    return
  }
  const block = document.createElement('div')
  const nested = [...li.children].filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
  while (li.firstChild && !nested.includes(li.firstChild as Element)) block.append(li.firstChild)
  for (const list of nested) block.append(list)
  if (!block.childNodes.length) block.append(document.createElement('br'))
  const rest = siblingsAfter(li)
  li.remove()
  const parent = ul.parentNode
  if (!parent) return
  const afterUl = ul.nextSibling
  if (rest.length) {
    const tail = document.createElement(ul.tagName.toLowerCase())
    for (const node of rest) tail.append(node)
    parent.insertBefore(tail, afterUl)
    parent.insertBefore(block, tail)
  } else parent.insertBefore(block, afterUl)
  if (!ul.querySelector('li')) ul.remove()
  placeCaretAtStart(block)
}

function indentItem(li: HTMLLIElement): void {
  const prev = li.previousElementSibling
  if (!(prev instanceof HTMLLIElement)) return
  let sub = prev.lastElementChild
  if (!(sub instanceof HTMLUListElement) && !(sub instanceof HTMLOListElement)) {
    sub = document.createElement('ul')
    prev.append(sub)
  }
  sub.append(li)
  placeCaretAtStart(li)
}

function enterInList(li: HTMLLIElement): void {
  if (!itemText(li) && !li.querySelector('ul, ol')) {
    outdentItem(li)
    return
  }
  const next = document.createElement('li')
  const sel = document.getSelection()
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
  if (range && li.contains(range.startContainer)) {
    const tail = document.createRange()
    tail.setStart(range.startContainer, range.startOffset)
    const nested = [...li.children].find((child) => child.tagName === 'UL' || child.tagName === 'OL')
    if (nested) tail.setEndBefore(nested)
    else tail.setEnd(li, li.childNodes.length)
    const frag = tail.extractContents()
    if ((frag.textContent ?? '').replace(/\u00a0/g, '').length) next.append(frag)
  }
  if (!itemText(li) && !li.querySelector('br')) li.append(document.createElement('br'))
  ensureBullet(li)
  if (!next.childNodes.length) next.append(document.createElement('br'))
  ensureBullet(next)
  li.after(next)
  placeCaretAtStart(next)
}

function toggleBullet(editor: HTMLElement): void {
  const caret = caretInEditor(editor)
  const li = caret ? listItem(caret.node) : null
  if (li) outdentItem(li)
  else bulletCaretLine(editor, false)
}

function renderTextMark(
  mark: TextMark,
  viewport: PageViewport,
  pageEl: HTMLElement,
  selectedId: string | null,
  onSelect: (id: string) => void,
  onTextChange: (id: string, content: string, html: string) => void,
  onTextMove: (id: string, x: number, y: number, began?: boolean) => void,
  onTextResize: (id: string, width: number, fontSize: number, began?: boolean) => void,
  onTextCommit: (id: string) => void,
  onTextDelete: (id: string) => void,
): HTMLElement {
  const pos = pdfPointToCss(mark.x, mark.y, viewport)
  const width = mark.width > 0 ? mark.width : DEFAULT_TEXT_WIDTH
  const el = document.createElement('div')
  el.className = `mark mark-text${selectedId === mark.id ? ' selected' : ''}`
  el.dataset.id = mark.id
  el.style.left = `${pos.left}px`
  el.style.top = `${pos.top}px`
  el.style.color = cssColor(mark.color)
  el.style.fontSize = `${mark.fontSize * viewport.scale}px`

  const tools = document.createElement('div')
  tools.className = 'text-tools'
  tools.contentEditable = 'false'
  tools.innerHTML = `
    <button type="button" data-cmd="bold" title="Bold">B</button>
    <button type="button" data-cmd="italic" title="Italic">I</button>
    <button type="button" data-cmd="underline" title="Underline"><span class="fmt-u">U</span></button>
    <button type="button" data-cmd="strikeThrough" title="Strikethrough"><span class="fmt-s">S</span></button>
    <button type="button" data-cmd="insertUnorderedList" title="Bullets">•</button>
    <span class="text-tools-sep"></span>
    <button type="button" data-swatch="ink" title="Text color"><span class="swatch-a">A<i style="background:${hexColor(mark.color)}"></i></span></button>
    <button type="button" data-swatch="bg" title="Highlight"><span class="swatch-bg none"></span></button>
    <div class="color-pop" hidden></div>
    <input type="color" class="color-custom" tabindex="-1" value="${hexColor(mark.color)}" />
  `

  const body = document.createElement('div')
  body.className = 'text-body'
  body.contentEditable = 'true'
  body.spellcheck = false
  body.style.width = `${width * viewport.scale}px`
  body.innerHTML = initialHtml(mark)
  for (const li of body.querySelectorAll('li')) ensureBullet(li)
  body.dataset.empty = mark.content.trim() ? '0' : '1'

  const publish = () => {
    promoteDashBullet(body)
    const html = sanitizeTextHtml(body.innerHTML)
    const plain = plainFromHtml(html)
    body.dataset.empty = plain.trim() ? '0' : '1'
    onTextChange(mark.id, plain, html)
  }

  body.addEventListener('beforeinput', (e) => {
    const pending = pendingTyping.get(body)
    if (!pending || !e.cancelable) return
    if (e.inputType === 'insertText' && e.data) {
      e.preventDefault()
      insertPendingText(body, e.data, pending)
      publish()
    }
  })
  body.addEventListener('input', () => {
    const pending = pendingTyping.get(body)
    if (!pending) return
    exitInlineStyles(body)
    unwrapMismatchedBreaks(body, pending)
  })
  body.addEventListener('input', publish)
  body.addEventListener('keydown', (e) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    const sel = document.getSelection()
    const node = sel?.anchorNode
    if (!node || !sel.isCollapsed || !body.contains(node)) return
    const li = listItem(node)
    const atStart = atVisualLineStart(node, sel.anchorOffset)

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
      pendingTyping.delete(body)
    }
    if (e.key === 'Enter') {
      if (e.shiftKey) return
      if (!li) return
      e.preventDefault()
      enterInList(li)
      publish()
      return
    }
    if (e.key === 'Backspace' && li && atStart) {
      e.preventDefault()
      outdentItem(li)
      publish()
      return
    }
    if (e.key === 'Tab' && li) {
      e.preventDefault()
      if (e.shiftKey) outdentItem(li)
      else indentItem(li)
      publish()
      return
    }
    if (e.key === '-' && !li && atStart) {
      e.preventDefault()
      bulletCaretLine(body, false)
      publish()
      return
    }
    if (e.key === ' ' && !li && node.nodeType === Node.TEXT_NODE) {
      const line = ((node.textContent ?? '').slice(0, sel.anchorOffset).split('\n').pop() ?? '').replace(/\u00a0/g, ' ')
      const markerOnly = line === '-' || line === '*' || line === '+'
      if (markerOnly && atVisualLineStart(node, sel.anchorOffset - line.length)) {
        e.preventDefault()
        bulletCaretLine(body, true)
        publish()
      }
    }
  })
  body.addEventListener('focusout', (e) => {
    const next = e.relatedTarget
    if (next instanceof Node && el.contains(next)) return
    queueMicrotask(() => {
      if (!el.isConnected) return
      if (el.contains(document.activeElement)) return
      onTextCommit(mark.id)
    })
  })

  const pop = tools.querySelector<HTMLElement>('.color-pop')!
  const custom = tools.querySelector<HTMLInputElement>('.color-custom')!
  const inkBtn = tools.querySelector<HTMLButtonElement>('[data-swatch="ink"]')!
  const bgBtn = tools.querySelector<HTMLButtonElement>('[data-swatch="bg"]')!
  const inkBar = inkBtn.querySelector<HTMLElement>('.swatch-a i')!
  const bgGlyph = bgBtn.querySelector<HTMLElement>('.swatch-bg')!
  let popKind: 'ink' | 'bg' | null = null

  const paintBgGlyph = (color: string | null) => {
    if (!color) {
      bgGlyph.className = 'swatch-bg none'
      bgGlyph.style.background = ''
      return
    }
    bgGlyph.className = 'swatch-bg'
    bgGlyph.style.background = color
  }

  const closePop = () => {
    popKind = null
    pop.hidden = true
    pop.innerHTML = ''
  }

  const applyColor = (kind: 'ink' | 'bg', color: string | null) => {
    body.focus()
    const sel = document.getSelection()
    const collapsed = !sel || sel.isCollapsed || !body.contains(sel.anchorNode)
    if (!collapsed && sel) {
      if (kind === 'bg' && !color) clearSelectionBackground(body)
      else if (kind === 'ink' && color) styleCommand(body, 'foreColor', color)
      else styleCommand(body, 'hiliteColor', color ?? 'transparent')
    } else {
      const node = sel?.anchorNode && body.contains(sel.anchorNode) ? sel.anchorNode : body
      const current = stylesAt(node, body)
      if (kind === 'ink' && color) current.color = resolvedCss('color', color)
      if (kind === 'bg') current.bg = color ? resolvedCss('backgroundColor', color) : 'transparent'
      setTypingStyle(body, current.color, current.bg)
    }
    if (kind === 'ink' && color) {
      inkBar.style.background = color
      custom.value = color
    } else if (kind === 'bg') paintBgGlyph(color)
    publish()
    closePop()
  }

  const openPop = (kind: 'ink' | 'bg', anchor: HTMLElement) => {
    if (popKind === kind) {
      closePop()
      return
    }
    popKind = kind
    const colors = kind === 'ink' ? INK_COLORS : BG_COLORS
    pop.innerHTML = ''
    for (const color of colors) {
      const sw = document.createElement('button')
      sw.type = 'button'
      sw.className = color ? 'pop-swatch' : 'pop-swatch none'
      sw.title = color ?? 'None'
      if (color) sw.style.background = color
      sw.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        applyColor(kind, color)
      })
      pop.append(sw)
    }
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'pop-swatch custom'
    more.title = 'Custom'
    more.textContent = '+'
    more.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      custom.dataset.kind = kind
      custom.click()
    })
    pop.append(more)
    pop.hidden = false
    const rect = anchor.getBoundingClientRect()
    const host = tools.getBoundingClientRect()
    const width = pop.offsetWidth
    let left = rect.left - host.left + rect.width / 2 - width / 2
    left = Math.max(0, Math.min(left, host.width - width))
    pop.style.left = `${left}px`
  }

  custom.addEventListener('input', () => {
    const kind = custom.dataset.kind === 'bg' ? 'bg' : 'ink'
    applyColor(kind, custom.value)
  })

  tools.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, .color-pop')) {
      e.stopPropagation()
      // Keep the editor focused so empty notes aren't committed/removed.
      if (!(target instanceof HTMLInputElement)) e.preventDefault()
      else body.focus()
      return
    }
    beginDrag(e)
  })
  tools.addEventListener('click', (e) => {
    const swatch = (e.target as HTMLElement).closest<HTMLElement>('[data-swatch]')
    if (swatch) {
      e.preventDefault()
      e.stopPropagation()
      const kind = swatch.dataset.swatch === 'bg' ? 'bg' : 'ink'
      openPop(kind, swatch)
      return
    }
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]')
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    closePop()
    const cmd = target.dataset.cmd
    if (!cmd) return
    if (cmd === 'insertUnorderedList') {
      body.focus()
      toggleBullet(body)
      publish()
      return
    }
    styleCommand(body, cmd)
    publish()
    syncTools()
  })

  let toolsLive = false
  const syncTools = () => {
    if (!body.isConnected) {
      if (toolsLive) document.removeEventListener('selectionchange', syncTools)
      return
    }
    toolsLive = true
    const sel = document.getSelection()
    const range = sel && sel.rangeCount && body.contains(sel.anchorNode) ? sel.getRangeAt(0) : null
    const node = range ? range.startContainer : null
    const pending = node && sel?.isCollapsed ? pendingTyping.get(body) : undefined
    const styles = node ? stylesAt(node, body) : null
    const color = pending?.color ?? styles?.color ?? getComputedStyle(body).color
    const bg = pending?.bg ?? styles?.bg ?? 'transparent'
    inkBar.style.background = color
    paintBgGlyph(isClearBg(bg) ? null : bg)
    tools.querySelector('[data-cmd="bold"]')?.classList.toggle('on', Boolean(node && hasInline(node, body, 'bold')))
    tools.querySelector('[data-cmd="italic"]')?.classList.toggle('on', Boolean(node && hasInline(node, body, 'italic')))
    tools.querySelector('[data-cmd="underline"]')?.classList.toggle('on', Boolean(node && hasInline(node, body, 'underline')))
    tools.querySelector('[data-cmd="strikeThrough"]')?.classList.toggle('on', Boolean(node && hasInline(node, body, 'strike')))
    tools.querySelector('[data-cmd="insertUnorderedList"]')?.classList.toggle('on', Boolean(node && listItem(node)))
  }
  document.addEventListener('selectionchange', syncTools)
  queueMicrotask(syncTools)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'image-delete'
  remove.title = 'Delete'
  remove.textContent = '×'
  remove.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  remove.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onTextDelete(mark.id)
  })

  const handle = document.createElement('div')
  handle.className = 'text-resize'
  handle.title = 'Resize'
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const originWidth = width
    const originSize = mark.fontSize
    const start = clientPointToPdf(pageEl, viewport, e.clientX, e.clientY)
    const pointerId = e.pointerId
    handle.setPointerCapture(pointerId)
    let started = false
    const move = (ev: PointerEvent) => {
      const now = clientPointToPdf(pageEl, viewport, ev.clientX, ev.clientY)
      const nextWidth = Math.max(48, originWidth + (now.x - start.x))
      const scale = nextWidth / originWidth
      const nextSize = Math.min(72, Math.max(8, originSize * scale))
      onTextResize(mark.id, nextWidth, nextSize, !started)
      started = true
      body.style.width = `${nextWidth * viewport.scale}px`
      el.style.fontSize = `${nextSize * viewport.scale}px`
    }
    const up = () => {
      try {
        handle.releasePointerCapture(pointerId)
      } catch {
        /* already released */
      }
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  })

  const beginDrag = (e: PointerEvent, fromBody = false) => {
    e.stopPropagation()
    const originX = mark.x
    const originY = mark.y
    const start = clientPointToPdf(pageEl, viewport, e.clientX, e.clientY)
    const pointerId = e.pointerId
    let dragging = false
    let started = false
    const selAtDown = document.getSelection()
    const textSelect =
      fromBody &&
      el.classList.contains('selected') &&
      (e.shiftKey || Boolean(selAtDown && !selAtDown.isCollapsed && body.contains(selAtDown.anchorNode)))
    const move = (ev: PointerEvent) => {
      if (textSelect) return
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      if (!dragging) {
        if (Math.hypot(dx, dy) < 4) return
      dragging = true
      el.classList.add('selected', 'dragging')
      body.contentEditable = 'false'
        document.getSelection()?.removeAllRanges()
        body.blur()
        try {
          el.setPointerCapture(pointerId)
        } catch {
          /* pointer is no longer active */
        }
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
      el.classList.remove('dragging')
      body.contentEditable = 'true'
      if (dragging) {
        try {
          el.releasePointerCapture(pointerId)
        } catch {
          /* already released */
        }
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!dragging && !textSelect) {
        onSelect(mark.id)
        body.focus()
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  body.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    closePop()
    // The text itself is for the caret and selecting. Drag the padding around it.
    e.stopPropagation()
    pendingTyping.delete(body)
    // Leaving a blank note (for this one, or a tool change) deletes it.
    if (!el.classList.contains('selected')) onSelect(mark.id)
    const bullet = (e.target as Element | null)?.closest?.('.li-bullet')
    if (!(bullet instanceof HTMLElement) || !body.contains(bullet)) return
    const startX = e.clientX
    const startY = e.clientY
    const selectBullet = (ev: PointerEvent) => {
      body.removeEventListener('pointerup', selectBullet)
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) return
      const range = document.createRange()
      range.selectNodeContents(bullet)
      const sel = document.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    body.addEventListener('pointerup', selectBullet)
  })
  el.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('.text-body, .text-tools, .text-resize, .image-delete')) return
    e.preventDefault()
    beginDrag(e)
  })

  el.append(tools, body, remove, handle)
  return el
}

export function toolKind(tool: Tool): Tool {
  return tool
}
