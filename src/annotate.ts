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

function pageScale(pageEl: HTMLElement, viewport: PageViewport): number {
  const box = pageEl.getBoundingClientRect()
  return box.width / viewport.width
}

export function clientPointToPdf(
  pageEl: HTMLElement,
  viewport: PageViewport,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const box = pageEl.getBoundingClientRect()
  const scale = pageScale(pageEl, viewport)
  const vx = (clientX - box.left) / scale
  const vy = (clientY - box.top) / scale
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
  const items = [...rects]
    .filter((r) => r.width > 1 && r.height > 1)
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
    if (sameLine && gap < Math.max(8, last.height)) {
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

  const pageBox = pageEl.getBoundingClientRect()
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
    if (w > 0.5 && h > 0.5) quads.push({ x, y, w, h })
  }
  if (quads.length === 0) return null
  return { quads, text: selection.toString() }
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
  onTextMove: (id: string, x: number, y: number) => void,
): void {
  const layer = pageEl.querySelector<HTMLElement>('.annot-layer')
  if (!layer) return
  layer.replaceChildren()

  const page = Number(pageEl.dataset.page)
  for (const mark of marks) {
    if (mark.page !== page) continue
    if (mark.kind === 'text') {
      layer.append(renderTextMark(mark, viewport, pageEl, selectedId, onSelect, onTextChange, onTextMove))
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
  onTextMove: (id: string, x: number, y: number) => void,
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
  input.addEventListener('pointerdown', (e) => e.stopPropagation())
  input.addEventListener('focus', () => onSelect(mark.id))

  el.append(input)
  queueMicrotask(() => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  })

  el.addEventListener('pointerdown', (e) => {
    if (e.target === input) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(mark.id)
    const start = clientPointToPdf(pageEl, viewport, e.clientX, e.clientY)
    const originX = mark.x
    const originY = mark.y
    const pointerId = e.pointerId
    el.setPointerCapture(pointerId)
    const move = (ev: PointerEvent) => {
      const now = clientPointToPdf(pageEl, viewport, ev.clientX, ev.clientY)
      onTextMove(mark.id, originX + (now.x - start.x), originY + (now.y - start.y))
    }
    const up = () => {
      el.releasePointerCapture(pointerId)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  })
  return el
}

export function toolKind(tool: Tool): QuadMark['kind'] | 'text' {
  return tool
}
