import './style.css'
import {
  clientPointToPdf,
  colorFromHex,
  hexColor,
  pageFromNode,
  renderMarks,
  selectionToQuads,
} from './annotate'
import { downloadAnnotatedPdf } from './export'
import { PdfViewer, type PageView } from './render'
import { colorsEqual, loadPdfBytes, loadSession, newId, savePdfBytes, saveSession } from './store'
import { DEFAULT_COLOR, PRESET_COLORS, type Color, type Mark, type Session, type Tool } from './types'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('missing #app')
const app = root

app.innerHTML = `
  <div class="app">
    <header class="toolbar">
      <h1>PDF Highlight</h1>
      <label class="btn">Open<input class="hidden-file" type="file" accept="application/pdf" /></label>
      <button type="button" data-action="download" disabled>Download</button>
      <div class="tool-group">
        <button type="button" data-tool="highlight" title="Highlight">Highlight</button>
        <button type="button" data-tool="underline" title="Underline">Underline</button>
        <button type="button" data-tool="strikethrough" title="Strikethrough">Strike</button>
        <button type="button" data-tool="text" title="Text">Text</button>
      </div>
      <div class="swatches"></div>
      <div class="rgb">
        <input type="color" data-rgb="picker" />
        <label>R <input type="number" min="0" max="255" data-rgb="r" /></label>
        <label>G <input type="number" min="0" max="255" data-rgb="g" /></label>
        <label>B <input type="number" min="0" max="255" data-rgb="b" /></label>
      </div>
      <span class="file-name" data-file></span>
    </header>
    <div class="workspace">
      <aside class="thumbs"></aside>
      <main class="viewer">
        <div class="empty">
          <div class="empty-card">
            <h2>Open a PDF</h2>
            <p>Highlight research papers with custom RGB colors. Marks save locally on every edit.</p>
            <label class="btn">Choose PDF<input class="hidden-file" type="file" accept="application/pdf" /></label>
          </div>
        </div>
        <div class="pages" hidden></div>
      </main>
    </div>
  </div>
`

const session: Session = loadSession()
let pdfBytes: ArrayBuffer | null = null
let selectedId: string | null = null

const thumbs = app.querySelector<HTMLElement>('.thumbs')!
const pagesHost = app.querySelector<HTMLElement>('.pages')!
const empty = app.querySelector<HTMLElement>('.empty')!
const downloadBtn = app.querySelector<HTMLButtonElement>('[data-action="download"]')!
const fileLabel = app.querySelector<HTMLElement>('[data-file]')!
const swatches = app.querySelector<HTMLElement>('.swatches')!
const picker = app.querySelector<HTMLInputElement>('[data-rgb="picker"]')!
const rgbInputs = {
  r: app.querySelector<HTMLInputElement>('[data-rgb="r"]')!,
  g: app.querySelector<HTMLInputElement>('[data-rgb="g"]')!,
  b: app.querySelector<HTMLInputElement>('[data-rgb="b"]')!,
}

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
  const on = session.tool === 'text'
  for (const view of viewer.views()) view.el.classList.toggle('text-tool', on)
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
  swatches.replaceChildren()
  for (const preset of PRESET_COLORS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `swatch${colorsEqual(preset.color, session.color) ? ' active' : ''}`
    btn.title = preset.name
    btn.style.setProperty('--c', `rgb(${preset.color.r} ${preset.color.g} ${preset.color.b})`)
    btn.addEventListener('click', () => setColor(preset.color))
    swatches.append(btn)
  }
  picker.value = hexColor(session.color)
  rgbInputs.r.value = String(session.color.r)
  rgbInputs.g.value = String(session.color.g)
  rgbInputs.b.value = String(session.color.b)
  fileLabel.textContent = session.fileName
  downloadBtn.disabled = !pdfBytes
}

function setColor(color: Color): void {
  session.color = { ...color }
  persist()
  renderChrome()
}

function setTool(tool: Tool): void {
  session.tool = tool
  persist()
  renderChrome()
  setTextToolClass()
}

async function openPdf(file: File): Promise<void> {
  const bytes = await file.arrayBuffer()
  session.fileName = file.name
  session.docId = newId()
  session.marks = []
  selectedId = null
  persist()
  await savePdfBytes(session.docId, bytes.slice(0))
  await showPdf(bytes)
}

async function showPdf(bytes: ArrayBuffer): Promise<void> {
  pdfBytes = bytes.slice(0)
  empty.hidden = true
  pagesHost.hidden = false
  await viewer.load(bytes)
  renderChrome()
}

function addSelectionMark(): void {
  if (session.tool === 'text') return
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return
  const pageEl = pageFromNode(selection.anchorNode)
  if (!pageEl) return
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return
  const mapped = selectionToQuads(pageEl, view.viewport)
  selection.removeAllRanges()
  if (!mapped) return
  const mark: Mark = {
    id: newId(),
    kind: session.tool,
    page,
    color: { ...session.color },
    quads: mapped.quads,
    text: mapped.text,
  }
  session.marks.push(mark)
  selectedId = mark.id
  persist()
  paintPage(view)
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

downloadBtn.addEventListener('click', () => {
  if (!pdfBytes) return
  void downloadAnnotatedPdf(pdfBytes, session.fileName || 'document.pdf', session.marks)
})

picker.addEventListener('input', () => setColor(colorFromHex(picker.value)))
for (const key of ['r', 'g', 'b'] as const) {
  rgbInputs[key].addEventListener('change', () => {
    const next = {
      r: clampByte(Number(rgbInputs.r.value)),
      g: clampByte(Number(rgbInputs.g.value)),
      b: clampByte(Number(rgbInputs.b.value)),
    }
    setColor(next)
  })
}

pagesHost.addEventListener('mouseup', () => {
  window.setTimeout(addSelectionMark, 0)
})
pagesHost.addEventListener('pointerdown', (e) => {
  if (session.tool === 'text') addTextMark(e)
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
})

const viewerEl = app.querySelector('.viewer')!
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

function clampByte(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(255, Math.round(n)))
}

if (!session.color) session.color = { ...DEFAULT_COLOR }
renderChrome()

if (session.docId) {
  void loadPdfBytes(session.docId).then((bytes) => {
    if (bytes) void showPdf(bytes)
  })
}
