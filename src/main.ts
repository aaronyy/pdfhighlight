import './style.css'
import {
  clientPointToPdf,
  collapseStackedMarks,
  colorFromHex,
  hexColor,
  markOverlapsQuads,
  pageFromNode,
  pointInQuads,
  rangeToQuads,
  renderMarks,
  roughlySameRegion,
  selectionToQuads,
  wordRangeAt,
} from './annotate'
import { downloadAnnotatedPdf } from './export'
import { PdfViewer, type PageView } from './render'
import { Buddy } from './buddy'
import { colorsEqual, loadPdfBytes, loadSession, newId, savePdfBytes, saveSession } from './store'
import { DEFAULT_COLOR, PRESET_COLORS, type Color, type Mark, type Quad, type Session, type Tool } from './types'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('missing #app')
const app = root

app.innerHTML = `
  <div class="app">
    <header class="toolbar">
      <div class="brand">
        <img class="brand-mark" src="${import.meta.env.BASE_URL}favicon-180.png" alt="" />
        <div>
          <h1>Supervillian Highlighter</h1>
          <p class="file-name" data-file>No file</p>
        </div>
      </div>
      <div class="tool-group" role="tablist">
        <button type="button" data-tool="highlight">Highlight</button>
        <button type="button" data-tool="underline">Underline</button>
        <button type="button" data-tool="strikethrough">Strike</button>
        <button type="button" data-tool="text">Text</button>
      </div>
      <div class="swatches">
        <label class="swatch swatch-custom" title="Custom color">
          <input type="color" data-rgb="picker" />
        </label>
      </div>
      <div class="zoom-group">
        <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" data-zoom="reset" data-zoom-label>100%</button>
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
      </div>
      <div class="actions">
        <button type="button" class="ghost" data-action="clear" disabled>Clear</button>
        <label class="btn">Open<input class="hidden-file" type="file" accept="application/pdf" /></label>
        <button type="button" class="primary" data-action="download" disabled>Download</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="thumbs"></aside>
      <main class="viewer">
        <div class="empty">
          <div class="empty-card">
            <h2>Drop a paper in</h2>
            <p>Highlight, underline, and scribble in the margin. Everything saves on this device.</p>
            <label class="btn primary">Choose PDF<input class="hidden-file" type="file" accept="application/pdf" /></label>
          </div>
        </div>
        <div class="pages" hidden></div>
      </main>
    </div>
  </div>
`

const session: Session = loadSession()
const stacked = session.marks.length
session.marks = collapseStackedMarks(session.marks)
if (session.marks.length !== stacked) saveSession(session)
let pdfBytes: ArrayBuffer | null = null
let selectedId: string | null = null

const thumbs = app.querySelector<HTMLElement>('.thumbs')!
const pagesHost = app.querySelector<HTMLElement>('.pages')!
const empty = app.querySelector<HTMLElement>('.empty')!
const downloadBtn = app.querySelector<HTMLButtonElement>('[data-action="download"]')!
const clearBtn = app.querySelector<HTMLButtonElement>('[data-action="clear"]')!
const zoomLabel = app.querySelector<HTMLButtonElement>('[data-zoom-label]')!
const fileLabel = app.querySelector<HTMLElement>('[data-file]')!
const swatches = app.querySelector<HTMLElement>('.swatches')!
const picker = app.querySelector<HTMLInputElement>('[data-rgb="picker"]')!
const customSwatch = app.querySelector<HTMLElement>('.swatch-custom')!
const buddy = new Buddy(app)

const viewer = new PdfViewer(
  pagesHost,
  thumbs,
  (views) => {
    paintAll(views)
    setTextToolClass()
  },
  (page) => viewer.setActiveThumb(page),
)

function persist(): void {
  saveSession(session)
}

function setTextToolClass(): void {
  const text = session.tool === 'text'
  for (const view of viewer.views()) {
    view.el.classList.toggle('text-tool', text)
    view.el.classList.toggle('selecting', !text)
  }
}

function paintAll(views = viewer.views()): void {
  for (const view of views) paintPage(view)
}

function paintPage(view: PageView): void {
  renderMarks(
    view.el,
    view.viewport,
    session.marks,
    selectedId,
    (id) => {
      selectedId = id
      paintAll()
      buddy.selected()
    },
    (id, content) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind === 'text') {
        mark.content = content
        persist()
      }
    },
    (id, x, y) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind === 'text') {
        mark.x = x
        mark.y = y
        persist()
        paintPage(view)
      }
    },
  )
}

function renderChrome(): void {
  for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    btn.classList.toggle('active', btn.dataset.tool === session.tool)
  }
  swatches.querySelectorAll('button.swatch').forEach((el) => el.remove())
  for (const preset of PRESET_COLORS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `swatch${colorsEqual(preset.color, session.color) ? ' active' : ''}`
    btn.title = preset.name
    btn.style.setProperty('--c', `rgb(${preset.color.r} ${preset.color.g} ${preset.color.b})`)
    btn.addEventListener('click', () => setColor(preset.color, preset.name))
    swatches.insertBefore(btn, customSwatch)
  }
  picker.value = hexColor(session.color)
  customSwatch.style.setProperty('--c', `rgb(${session.color.r} ${session.color.g} ${session.color.b})`)
  const custom = !PRESET_COLORS.some((p) => colorsEqual(p.color, session.color))
  customSwatch.classList.toggle('active', custom)
  fileLabel.textContent = session.fileName || 'No file'
  downloadBtn.disabled = !pdfBytes
  clearBtn.disabled = session.marks.length === 0
  zoomLabel.textContent = `${Math.round(session.zoom)}%`
}

function setColor(color: Color, presetName?: string): void {
  session.color = { ...color }
  const selected = selectedId ? session.marks.find((m) => m.id === selectedId) : undefined
  if (selected) selected.color = { ...color }
  persist()
  renderChrome()
  if (selected) paintAll()
  buddy.color(presetName)
}

function setTool(tool: Tool): void {
  session.tool = tool
  persist()
  renderChrome()
  setTextToolClass()
  buddy.tool(tool)
}

async function openPdf(file: File): Promise<void> {
  buddy.opening()
  const bytes = await file.arrayBuffer()
  session.fileName = file.name
  session.docId = newId()
  session.marks = []
  selectedId = null
  persist()
  await savePdfBytes(session.docId, bytes.slice(0))
  await showPdf(bytes)
}

async function showPdf(bytes: ArrayBuffer, restored = false): Promise<void> {
  pdfBytes = bytes.slice(0)
  empty.hidden = true
  pagesHost.hidden = false
  viewer.zoom = session.zoom / 100
  await viewer.load(bytes)
  renderChrome()
  if (restored) buddy.greet(true)
  else buddy.opened()
}

function sameInk(mark: Mark): boolean {
  return mark.kind !== 'text' && mark.kind === session.tool
}

function applyInk(pageEl: HTMLElement, mapped: { quads: Quad[]; text: string }): void {
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return

  const overlapping = session.marks.filter(
    (m) => sameInk(m) && m.page === page && markOverlapsQuads(m, mapped.quads),
  )
  if (overlapping.length > 0) {
    session.marks = session.marks.filter((m) => !overlapping.some((hit) => hit.id === m.id))
    const toggling = overlapping.some((m) => m.kind !== 'text' && roughlySameRegion(m.quads, mapped.quads))
    if (toggling) {
      selectedId = null
      persist()
      paintPage(view)
      renderChrome()
      buddy.deleted()
      return
    }
  }

  if (session.tool === 'text') return
  session.marks.push({
    id: newId(),
    kind: session.tool,
    page,
    color: { ...session.color },
    quads: mapped.quads,
    text: mapped.text,
  })
  selectedId = session.marks.at(-1)?.id ?? null
  persist()
  paintPage(view)
  renderChrome()
  buddy.marked(session.tool, session.marks.length)
}

function addSelectionMark(): void {
  if (session.tool === 'text') return
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return
  const pageEl = pageFromNode(selection.anchorNode)
  if (!pageEl) return
  const view = viewer.getView(Number(pageEl.dataset.page))
  if (!view) return
  const mapped = selectionToQuads(pageEl, view.viewport)
  selection.removeAllRanges()
  if (!mapped || !mapped.text.trim()) return
  applyInk(pageEl, mapped)
}

function removeMarkAt(clientX: number, clientY: number): void {
  if (session.tool === 'text') return
  const el = document.elementFromPoint(clientX, clientY)
  const pageEl = el?.closest<HTMLElement>('.page')
  if (!pageEl) return
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return
  const pt = clientPointToPdf(pageEl, view.viewport, clientX, clientY)
  const hit = session.marks.find(
    (m) => sameInk(m) && m.page === page && m.kind !== 'text' && pointInQuads(pt.x, pt.y, m.quads),
  )
  if (!hit) return
  session.marks = session.marks.filter((m) => m.id !== hit.id)
  selectedId = null
  persist()
  paintPage(view)
  renderChrome()
  buddy.deleted()
}

function addTextMark(event: PointerEvent): void {
  if (session.tool !== 'text') return
  const target = event.target as HTMLElement
  if (target.closest('.mark')) return
  const pageEl = target.closest<HTMLElement>('.page')
  if (!pageEl) return
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return
  const pt = clientPointToPdf(pageEl, view.viewport, event.clientX, event.clientY)
  const mark: Mark = {
    id: newId(),
    kind: 'text',
    page,
    color: { ...session.color },
    x: pt.x,
    y: pt.y,
    fontSize: 12,
    content: '',
  }
  session.marks.push(mark)
  selectedId = mark.id
  persist()
  paintPage(view)
  queueMicrotask(() => {
    pageEl.querySelector<HTMLTextAreaElement>(`.mark-text[data-id="${mark.id}"] textarea`)?.focus()
  })
  buddy.marked('text', session.marks.length)
  renderChrome()
}

function deleteSelected(): void {
  if (!selectedId) return
  const active = document.activeElement
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    return
  }
  session.marks = session.marks.filter((m) => m.id !== selectedId)
  selectedId = null
  persist()
  paintAll()
  renderChrome()
  buddy.deleted()
}

function clearMarks(): void {
  if (session.marks.length === 0) return
  session.marks = []
  selectedId = null
  persist()
  paintAll()
  renderChrome()
  buddy.cleared()
}

function setZoom(next: number): void {
  session.zoom = Math.round(Math.min(300, Math.max(40, next)))
  persist()
  viewer.applyZoom(session.zoom / 100)
  renderChrome()
  buddy.zoomed(session.zoom)
}

for (const input of app.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) void openPdf(file)
    input.value = ''
  })
}

for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  btn.addEventListener('click', () => setTool(btn.dataset.tool as Tool))
}

clearBtn.addEventListener('click', () => clearMarks())

app.querySelector('[data-zoom="out"]')?.addEventListener('click', () => setZoom(session.zoom - 20))
app.querySelector('[data-zoom="in"]')?.addEventListener('click', () => setZoom(session.zoom + 20))
app.querySelector('[data-zoom="reset"]')?.addEventListener('click', () => setZoom(100))

downloadBtn.addEventListener('click', () => {
  if (!pdfBytes) {
    buddy.nothingToDownload()
    return
  }
  buddy.downloading()
  void downloadAnnotatedPdf(pdfBytes, session.fileName || 'document.pdf', session.marks).catch(() => {
    buddy.nothingToDownload()
  })
})

picker.addEventListener('input', () => setColor(colorFromHex(picker.value)))

pagesHost.addEventListener('mouseup', (e) => {
  if ((e.target as HTMLElement).closest('textarea, button, input, .buddy')) return
  const { clientX, clientY } = e
  window.setTimeout(() => {
    if (session.tool === 'text') return
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed) {
      addSelectionMark()
      return
    }
    const word = wordRangeAt(clientX, clientY)
    const pageEl =
      (word ? pageFromNode(word.startContainer) : null) ??
      (e.target as HTMLElement).closest<HTMLElement>('.page')
    if (word && pageEl) {
      const view = viewer.getView(Number(pageEl.dataset.page))
      const mapped = view ? rangeToQuads(word, pageEl, view.viewport) : null
      if (mapped?.text.trim()) {
        applyInk(pageEl, mapped)
        return
      }
    }
    removeMarkAt(clientX, clientY)
  }, 0)
})
pagesHost.addEventListener('pointerdown', (e) => {
  if (session.tool === 'text') addTextMark(e)
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
  if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    setZoom(session.zoom + 20)
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '-') {
    e.preventDefault()
    setZoom(session.zoom - 20)
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '0') {
    e.preventDefault()
    setZoom(100)
  }
})

const viewerEl = app.querySelector<HTMLElement>('.viewer')!
viewerEl.addEventListener(
  'wheel',
  (event) => {
    const e = event as WheelEvent
    if (!(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    const step = e.deltaY > 0 ? -10 : 10
    setZoom(session.zoom + step)
  },
  { passive: false },
)
;['dragenter', 'dragover'].forEach((type) => {
  viewerEl.addEventListener(type, (e) => {
    e.preventDefault()
  })
})
viewerEl.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = [...(e as DragEvent).dataTransfer?.files ?? []].find((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
  if (file) void openPdf(file)
})

if (!session.color) session.color = { ...DEFAULT_COLOR }
renderChrome()
buddy.greet(Boolean(session.docId))

if (session.docId) {
  void loadPdfBytes(session.docId).then((bytes) => {
    if (bytes) void showPdf(bytes, true)
  })
}
