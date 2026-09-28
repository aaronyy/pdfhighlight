import './style.css'
import {
  clampTextOrigin,
  clientPointToPdf,
  collapseStackedMarks,
  colorFromHex,
  hexColor,
  pageFromNode,
  pointHitsMarker,
  pointInQuads,
  rangeToQuads,
  renderMarks,
  selectionToQuads,
  stabilizeHighlights,
  wordRangeAt,
} from './annotate'
import { downloadAnnotatedPdf } from './export'
import { insertBlankPage, insertPagesFromFile, isImageFile } from './insert'
import { PdfViewer, type OutlineEntry, type PageView } from './render'
import { Buddy } from './buddy'
import {
  deleteImageBlobs,
  loadImageBlob,
  loadPdfBytes,
  loadSession,
  newId,
  saveImageBlob,
  savePdfBytes,
  saveSession,
} from './store'
import {
  DEFAULT_COLOR,
  DEFAULT_MARKER_WIDTH,
  MARKER_WIDTHS,
  PRESET_COLORS,
  type Color,
  type ImageMark,
  type Mark,
  type MarkerMark,
  type Quad,
  type Session,
  type Tool,
} from './types'

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
      <div class="format-bar">
        <div class="tool-group" role="toolbar" aria-label="Marks">
          <button type="button" data-tool="highlight" data-hotkey="H" aria-keyshortcuts="H" title="Highlight">
            <svg class="fmt-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.7 3.2a1.6 1.6 0 0 1 2.3 0l3.8 3.8a1.6 1.6 0 0 1 0 2.3L9.4 20.7 3.2 22l1.3-6.2L14.7 3.2z"/></svg>
            <span class="fmt-bar"></span>
          </button>
          <button type="button" data-tool="marker" data-hotkey="M" aria-keyshortcuts="M" title="Marker">
            <svg class="fmt-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M5 16.5c2.2-4.2 5-6.2 7-6.2s4.8 2 7 6.2"/></svg>
            <span class="fmt-bar"></span>
          </button>
          <button type="button" data-tool="underline" data-hotkey="U" aria-keyshortcuts="U" title="Underline">
            <span class="fmt-u">U</span>
          </button>
          <button type="button" data-tool="strikethrough" data-hotkey="S" aria-keyshortcuts="S" title="Strikethrough">
            <span class="fmt-s">S</span>
          </button>
          <button type="button" data-tool="text" data-hotkey="T" aria-keyshortcuts="T" title="Text">
            <span class="fmt-t">T</span>
          </button>
          <div class="marker-size" data-marker-size hidden>
            <button type="button" data-marker-size="down" data-hotkey="[" aria-label="Thinner marker">−</button>
            <span class="marker-size-label" data-marker-size-label>24</span>
            <button type="button" data-marker-size="up" data-hotkey="]" aria-label="Thicker marker">+</button>
          </div>
        </div>
        <div class="ink-dots" data-ink-dots role="listbox" aria-label="Color"></div>
        <label class="ink-custom" data-ink-custom title="Custom color">
          <input type="color" data-rgb="picker" aria-label="Custom color" />
        </label>
      </div>
      <div class="zoom-group">
        <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" data-zoom="reset" data-zoom-label>100%</button>
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
      </div>
      <span class="save-status" data-saved aria-live="polite">Saved</span>
      <div class="actions">
        <button type="button" class="ghost" data-action="undo" disabled>Undo</button>
        <div class="insert-wrap">
          <button type="button" class="ghost" data-insert-toggle disabled>Insert</button>
          <div class="insert-pop" data-insert-pop hidden>
            <button type="button" data-insert="photo">Photo on this page</button>
            <button type="button" data-insert="page-file">Page from file</button>
            <button type="button" data-insert="blank">Blank page</button>
          </div>
        </div>
        <label class="btn">Open<input class="hidden-file" type="file" accept="application/pdf" data-open-pdf /></label>
        <button type="button" class="primary" data-action="download" disabled>Download</button>
        <input class="hidden-file" type="file" accept="image/*" data-photo-file />
        <input class="hidden-file" type="file" accept="application/pdf,image/*" data-page-file />
      </div>
    </header>
    <div class="workspace">
      <aside class="thumbs">
        <div class="thumbs-header">
          <button type="button" class="thumbs-menu-btn" data-thumbs-menu-toggle aria-label="Thumbnail options" aria-haspopup="menu" aria-expanded="false" title="Options">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
          </button>
        </div>
        <div class="thumbs-list" data-thumbs-list></div>
        <p class="thumbs-empty" hidden>Star pages to filter</p>
        <div class="outline-list" data-outline-list hidden></div>
        <p class="outline-empty" hidden>No table of contents</p>
      </aside>
      <main class="viewer">
        <div class="empty">
          <div class="empty-card">
            <h2>Drop a paper in</h2>
            <p>Select text, then pick a highlight color, underline, or strike. Click a word to mark it with the current tool.</p>
            <label class="btn primary">Choose PDF<input class="hidden-file" type="file" accept="application/pdf" data-open-pdf /></label>
          </div>
        </div>
        <div class="pages" hidden></div>
      </main>
    </div>
    <div class="thumbs-pop" data-thumbs-pop hidden role="menu">
      <button type="button" role="menuitemradio" data-sidebar-mode="thumbs" aria-checked="true">
        <span class="thumbs-check" aria-hidden="true"></span>
        Thumbnails
      </button>
      <button type="button" role="menuitemradio" data-sidebar-mode="outline" aria-checked="false">
        <span class="thumbs-check" aria-hidden="true"></span>
        Table of Contents
      </button>
      <div class="thumbs-pop-sep" role="separator"></div>
      <button type="button" role="menuitemcheckbox" data-single-page aria-checked="false">
        <span class="thumbs-check" aria-hidden="true"></span>
        Single page
      </button>
      <button type="button" role="menuitemcheckbox" data-thumbs-filter aria-checked="false">
        <span class="thumbs-check" aria-hidden="true"></span>
        Show bookmarked only
      </button>
      <div class="thumbs-pop-sep" role="separator"></div>
      <button type="button" role="menuitem" data-sidebar-visibility>Hide sidebar</button>
    </div>
    <div class="sel-menu" data-sel-menu hidden>
      <div class="ink-dots" data-sel-dots role="listbox" aria-label="Highlight"></div>
      <span class="sel-sep"></span>
      <button type="button" data-apply="underline" title="Underline"><span class="fmt-u">U</span></button>
      <button type="button" data-apply="strikethrough" title="Strikethrough"><span class="fmt-s">S</span></button>
      <span class="sel-sep" data-delete-sep hidden></span>
      <button type="button" data-delete-mark hidden title="Remove" aria-label="Remove">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm-1 11h12l1-12H5l1 12z"/></svg>
      </button>
    </div>
  </div>
`

const session: Session = loadSession()
const stacked = session.marks.length
session.marks = collapseStackedMarks(session.marks)
if (session.marks.length !== stacked) saveSession(session)
let pdfBytes: ArrayBuffer | null = null
let selectedId: string | null = null
const undoStack: Mark[][] = []
const imageUrls = new Map<string, string>()
let draftMarker: MarkerMark | null = null
let markerPointer: number | null = null
let markerMoved = false
let markerStart = { x: 0, y: 0 }

const workspace = app.querySelector<HTMLElement>('.workspace')!
const thumbs = app.querySelector<HTMLElement>('[data-thumbs-list]')!
const outlineList = app.querySelector<HTMLElement>('[data-outline-list]')!
const outlineEmpty = app.querySelector<HTMLElement>('.outline-empty')!
const thumbsEmpty = app.querySelector<HTMLElement>('.thumbs-empty')!
const thumbsMenuToggle = app.querySelector<HTMLButtonElement>('[data-thumbs-menu-toggle]')!
const thumbsPop = app.querySelector<HTMLElement>('[data-thumbs-pop]')!
const thumbsFilterBtn = app.querySelector<HTMLButtonElement>('[data-thumbs-filter]')!
const sidebarVisibilityBtn = app.querySelector<HTMLButtonElement>('[data-sidebar-visibility]')!
const singlePageBtn = app.querySelector<HTMLButtonElement>('[data-single-page]')!
const pagesHost = app.querySelector<HTMLElement>('.pages')!
const empty = app.querySelector<HTMLElement>('.empty')!
const downloadBtn = app.querySelector<HTMLButtonElement>('[data-action="download"]')!
const insertToggle = app.querySelector<HTMLButtonElement>('[data-insert-toggle]')!
const insertPop = app.querySelector<HTMLElement>('[data-insert-pop]')!
const photoFileInput = app.querySelector<HTMLInputElement>('[data-photo-file]')!
const pageFileInput = app.querySelector<HTMLInputElement>('[data-page-file]')!
const undoBtn = app.querySelector<HTMLButtonElement>('[data-action="undo"]')!
const zoomLabel = app.querySelector<HTMLButtonElement>('[data-zoom-label]')!
const fileLabel = app.querySelector<HTMLElement>('[data-file]')!
const picker = app.querySelector<HTMLInputElement>('[data-rgb="picker"]')!
const formatBar = app.querySelector<HTMLElement>('.format-bar')!
const markerSizeEl = app.querySelector<HTMLElement>('[data-marker-size]')!
const markerSizeLabel = app.querySelector<HTMLElement>('[data-marker-size-label]')!
const inkCustom = app.querySelector<HTMLElement>('[data-ink-custom]')!
const selMenu = app.querySelector<HTMLElement>('[data-sel-menu]')!
const savedEl = app.querySelector<HTMLElement>('[data-saved]')!
let savedTimer = 0
const buddy = new Buddy(app)

pagesHost.addEventListener('page-painted', (event) => {
  const pageEl = event.target
  if (!(pageEl instanceof HTMLElement) || !pageEl.classList.contains('page')) return
  const view = viewer.getView(Number(pageEl.dataset.page))
  if (view) paintPage(view)
})

const viewer = new PdfViewer(
  pagesHost,
  thumbs,
  (views) => {
    paintAll(views)
    setPageToolClass()
    syncThumbBookmarks()
  },
  (page) => {
    viewer.setActiveThumb(page)
    syncOutlineActive(page)
  },
  (page) => toggleBookmark(page),
)

function bookmarkedSet(): Set<number> {
  return new Set(session.bookmarkedPages ?? [])
}

function syncThumbBookmarks(): void {
  const showOnly = session.showBookmarkedOnly === true
  viewer.syncThumbBookmarks(bookmarkedSet(), showOnly)
  thumbsFilterBtn.setAttribute('aria-checked', showOnly ? 'true' : 'false')
  thumbsFilterBtn.classList.toggle('on', showOnly)
}

function syncSinglePage(): void {
  const on = session.singlePage === true
  singlePageBtn.setAttribute('aria-checked', on ? 'true' : 'false')
  singlePageBtn.classList.toggle('on', on)
  viewer.setSinglePage(on)
}

let outlineEntries: OutlineEntry[] = []

function sidebarMode(): 'thumbs' | 'outline' {
  return session.sidebar === 'outline' ? 'outline' : 'thumbs'
}

function applySidebar(): void {
  const hidden = session.sidebarHidden === true
  const mode = sidebarMode()
  const wasOutline = workspace.classList.contains('sidebar-outline')
  const wasHidden = workspace.classList.contains('sidebar-hidden')
  workspace.classList.toggle('sidebar-hidden', hidden)
  workspace.classList.toggle('sidebar-outline', !hidden && mode === 'outline')
  thumbs.hidden = hidden || mode !== 'thumbs'
  const hasOutline = outlineEntries.length > 0
  outlineList.hidden = hidden || mode !== 'outline' || !hasOutline
  outlineEmpty.hidden = hidden || mode !== 'outline' || hasOutline
  thumbsFilterBtn.hidden = mode !== 'thumbs'
  syncThumbBookmarks()
  if (hidden || mode !== 'thumbs') thumbsEmpty.hidden = true
  sidebarVisibilityBtn.textContent = hidden ? 'Show sidebar' : 'Hide sidebar'
  for (const btn of thumbsPop.querySelectorAll<HTMLButtonElement>('[data-sidebar-mode]')) {
    const on = btn.dataset.sidebarMode === mode
    btn.setAttribute('aria-checked', on ? 'true' : 'false')
    btn.classList.toggle('on', on)
  }
  const widthChanged =
    wasOutline !== workspace.classList.contains('sidebar-outline') ||
    wasHidden !== workspace.classList.contains('sidebar-hidden')
  if (widthChanged && pdfBytes) viewer.applyZoom(session.zoom / 100)
}

function appendOutlineNodes(nodes: OutlineEntry[], host: HTMLElement): void {
  for (const node of nodes) {
    const group = document.createElement('div')
    group.className = 'outline-group'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'outline-item'
    btn.textContent = node.title
    if (node.page != null) {
      btn.dataset.page = String(node.page)
      btn.addEventListener('click', () => viewer.scrollToPage(node.page!))
    } else {
      btn.disabled = true
    }
    group.append(btn)
    if (node.children.length) {
      const nested = document.createElement('div')
      nested.className = 'outline-children'
      appendOutlineNodes(node.children, nested)
      group.append(nested)
    }
    host.append(group)
  }
}

async function renderOutline(): Promise<void> {
  outlineEntries = await viewer.getOutline()
  outlineList.replaceChildren()
  appendOutlineNodes(outlineEntries, outlineList)
  syncOutlineActive(viewer.visiblePage)
  applySidebar()
}

function syncOutlineActive(page: number): void {
  for (const el of outlineList.querySelectorAll<HTMLButtonElement>('.outline-item')) {
    el.classList.toggle('active', Number(el.dataset.page) === page)
  }
}

function toggleBookmark(page: number): void {
  const pages = bookmarkedSet()
  if (pages.has(page)) pages.delete(page)
  else pages.add(page)
  session.bookmarkedPages = [...pages].sort((a, b) => a - b)
  persist()
  syncThumbBookmarks()
}

function closeThumbsMenu(): void {
  thumbsPop.hidden = true
  thumbsMenuToggle.setAttribute('aria-expanded', 'false')
}

function openThumbsMenu(): void {
  const box = thumbsMenuToggle.getBoundingClientRect()
  thumbsPop.style.top = `${Math.round(box.bottom + 2)}px`
  thumbsPop.style.left = `${Math.round(box.left)}px`
  thumbsPop.hidden = false
  thumbsMenuToggle.setAttribute('aria-expanded', 'true')
}

function persist(): void {
  saveSession(session)
  savedEl.classList.add('on')
  window.clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => savedEl.classList.remove('on'), 1400)
}

function setPageToolClass(): void {
  const text = session.tool === 'text'
  const marker = session.tool === 'marker'
  for (const view of viewer.views()) {
    view.el.classList.toggle('text-tool', text)
    view.el.classList.toggle('marker-tool', marker)
    view.el.classList.toggle('selecting', !text && !marker)
  }
}

function visibleMarks(): Mark[] {
  return draftMarker ? [...session.marks, draftMarker] : session.marks
}

function currentMarkerWidth(): number {
  const selected = selectedId ? session.marks.find((m) => m.id === selectedId) : undefined
  if (selected?.kind === 'marker' && selected.width > 0) return selected.width
  return session.markerWidth && session.markerWidth > 0 ? session.markerWidth : DEFAULT_MARKER_WIDTH
}

function nearestMarkerStep(width: number): number {
  let best = 0
  for (let i = 1; i < MARKER_WIDTHS.length; i++) {
    if (Math.abs(MARKER_WIDTHS[i] - width) < Math.abs(MARKER_WIDTHS[best] - width)) best = i
  }
  return best
}

function stepMarkerWidth(dir: -1 | 1): void {
  const idx = Math.min(MARKER_WIDTHS.length - 1, Math.max(0, nearestMarkerStep(currentMarkerWidth()) + dir))
  const next = MARKER_WIDTHS[idx]
  session.markerWidth = next
  const selected = selectedId ? session.marks.find((m) => m.id === selectedId) : undefined
  if (selected?.kind === 'marker') selected.width = next
  persist()
  renderChrome()
  if (selected?.kind === 'marker') paintAll()
}

function paintAll(views = viewer.views()): void {
  for (const view of views) paintPage(view)
}

function textIsBlank(content: string): boolean {
  return !content.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim()
}

function dropEmptyText(exceptId?: string): boolean {
  const next = session.marks.filter(
    (m) => m.kind !== 'text' || !textIsBlank(m.content) || m.id === exceptId,
  )
  if (next.length === session.marks.length) return false
  session.marks = next
  if (selectedId && !next.some((m) => m.id === selectedId)) selectedId = null
  return true
}

function paintPage(view: PageView): void {
  if (stabilizeHighlights(view.el, view.viewport, visibleMarks())) persist()
  renderMarks(
    view.el,
    view.viewport,
    visibleMarks(),
    selectedId,
    (id) => {
      const mark = session.marks.find((m) => m.id === id)
      const quad = Boolean(mark && 'quads' in mark)
      if (selectedId !== id) {
        dropEmptyText(id)
        selectedId = id
        paintAll()
        buddy.selected()
      }
      if (quad) {
        clearPending()
        placeSelMenuForMark(id)
        return
      }
      hideSelMenu()
      pagesHost
        .querySelector<HTMLElement>(`.mark-text[data-id="${CSS.escape(id)}"] .text-body`)
        ?.focus()
    },
    (id, content, html) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind === 'text') {
        mark.content = content
        mark.html = html
        persist()
      }
    },
    (id, x, y, began) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind !== 'text') return
      if (began) {
        snapshotMarks()
        selectedId = id
      }
      mark.x = x
      mark.y = y
      persist()
    },
    (id, width, fontSize, began) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind !== 'text') return
      if (began) {
        snapshotMarks()
        selectedId = id
      }
      mark.width = width
      mark.fontSize = fontSize
      session.textWidth = width
      session.textFontSize = fontSize
      persist()
    },
    (id) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind !== 'text') return
      mark.content = mark.content.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim()
      if (mark.html) mark.html = mark.html.trim()
      if (mark.content) {
        persist()
        return
      }
      // Keep the empty box while it's selected (toolbar / color clicks blur the editor).
      if (selectedId === id) {
        persist()
        return
      }
      session.marks = session.marks.filter((m) => m.id !== id)
      if (selectedId === id) selectedId = null
      persist()
      paintAll()
      renderChrome()
    },
    (id) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind !== 'text') return
      snapshotMarks()
      session.marks = session.marks.filter((m) => m.id !== id)
      if (selectedId === id) selectedId = null
      persist()
      paintAll()
      renderChrome()
      buddy.deleted()
    },
    imageUrls,
    (id, next, began) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind !== 'image') return
      if (began) {
        snapshotMarks()
        selectedId = id
      }
      mark.x = next.x
      mark.y = next.y
      mark.w = next.w
      mark.h = next.h
      mark.rotation = next.rotation
      persist()
    },
    (id) => {
      const mark = session.marks.find((m) => m.id === id)
      if (mark?.kind !== 'image') return
      snapshotMarks()
      session.marks = session.marks.filter((m) => m.id !== id)
      if (selectedId === id) selectedId = null
      persist()
      paintAll()
      renderChrome()
      buddy.deleted()
    },
  )
}

function renderChrome(): void {
  for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    const on = btn.dataset.tool === session.tool
    btn.classList.toggle('active', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
  const hex = hexColor(session.color)
  formatBar.style.setProperty('--mark', hex)
  formatBar.style.setProperty('--tool-color', hex)
  selMenu.style.setProperty('--mark', hex)
  picker.value = hex
  let matched = false
  for (const dot of app.querySelectorAll<HTMLButtonElement>('.ink-dot[data-hex]')) {
    const on = dot.dataset.hex === hex.toLowerCase()
    dot.classList.toggle('on', on)
    dot.setAttribute('aria-selected', on ? 'true' : 'false')
    if (on) matched = true
  }
  inkCustom.classList.toggle('on', !matched)
  inkCustom.style.background = matched ? '' : hex
  fileLabel.textContent = session.fileName || 'No file'
  downloadBtn.disabled = !pdfBytes
  insertToggle.disabled = !pdfBytes
  undoBtn.disabled = undoStack.length === 0
  zoomLabel.textContent = `${Math.round(session.zoom)}%`
  markerSizeEl.hidden = session.tool !== 'marker'
  markerSizeLabel.textContent = String(currentMarkerWidth())
  syncSinglePage()
  applySidebar()
}

type PendingInk = { pageEl: HTMLElement; quads: Quad[]; text: string }

let pendingInk: PendingInk | null = null
let pointerSelecting = false

function hideSelMenu(): void {
  selMenu.hidden = true
}

function clearPending(): void {
  pendingInk = null
  hideSelMenu()
}

function showSelMenu(rect: DOMRect, canDelete = false): void {
  const deleteBtn = selMenu.querySelector<HTMLElement>('[data-delete-mark]')
  const deleteSep = selMenu.querySelector<HTMLElement>('[data-delete-sep]')
  if (deleteBtn) deleteBtn.hidden = !canDelete
  if (deleteSep) deleteSep.hidden = !canDelete
  selMenu.hidden = false
  const width = selMenu.offsetWidth
  const height = selMenu.offsetHeight
  let left = rect.left + rect.width / 2 - width / 2
  let top = rect.top - height - 10
  if (top < 8) top = rect.bottom + 8
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  selMenu.style.left = `${left}px`
  selMenu.style.top = `${top}px`
}

function placeSelMenuForMark(id: string): void {
  const el = pagesHost.querySelector<HTMLElement>(`.mark[data-id="${CSS.escape(id)}"]`)
  if (!el) {
    hideSelMenu()
    return
  }
  showSelMenu(el.getBoundingClientRect(), true)
}

function rememberSelection(): void {
  if (session.tool === 'text' || session.tool === 'marker' || pointerSelecting) return
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
  const node = selection.anchorNode
  const host = node instanceof Element ? node : node?.parentElement
  if (!host || host.closest('.text-body, .mark-text, .sel-menu, .format-bar')) return
  const pageEl = pageFromNode(node)
  if (!pageEl) return
  const view = viewer.getView(Number(pageEl.dataset.page))
  if (!view) return
  const mapped = selectionToQuads(pageEl, view.viewport)
  if (!mapped?.text.trim()) return
  pendingInk = { pageEl, quads: mapped.quads, text: mapped.text }
  showSelMenu(selection.getRangeAt(0).getBoundingClientRect(), false)
}

function takePending(): PendingInk | null {
  if (!pendingInk) return null
  const ink = pendingInk
  pendingInk = null
  hideSelMenu()
  document.getSelection()?.removeAllRanges()
  return ink
}

function setColor(color: Color): void {
  session.color = { ...color }
  const ink = takePending()
  if (ink) {
    session.tool = 'highlight'
    applyInk(ink.pageEl, ink)
    return
  }
  const selected = selectedId ? session.marks.find((m) => m.id === selectedId) : undefined
  if (selected && selected.kind !== 'image') selected.color = { ...color }
  persist()
  renderChrome()
  if (selected && selected.kind !== 'image') paintAll()
}

function setTool(tool: Tool): void {
  if (tool !== 'text' && tool !== 'marker') {
    const ink = takePending()
    if (ink) {
      session.tool = tool
      applyInk(ink.pageEl, ink)
      return
    }
  } else {
    clearPending()
  }
  const pruned = dropEmptyText()
  session.tool = tool
  persist()
  renderChrome()
  setPageToolClass()
  if (pruned) paintAll()
  buddy.tool(tool)
}

function revokeImageUrls(): void {
  for (const url of imageUrls.values()) URL.revokeObjectURL(url)
  imageUrls.clear()
}

function imageIdsOf(marks: Mark[]): string[] {
  return marks.filter((m): m is ImageMark => m.kind === 'image').map((m) => m.imageId)
}

async function rememberImage(imageId: string, blob: Blob): Promise<void> {
  const prev = imageUrls.get(imageId)
  if (prev) URL.revokeObjectURL(prev)
  imageUrls.set(imageId, URL.createObjectURL(blob))
  await saveImageBlob(imageId, blob)
}

async function hydrateImages(marks: Mark[]): Promise<void> {
  for (const mark of marks) {
    if (mark.kind !== 'image' || imageUrls.has(mark.imageId)) continue
    const blob = await loadImageBlob(mark.imageId)
    if (blob) imageUrls.set(mark.imageId, URL.createObjectURL(blob))
  }
}

function shiftMarksAfter(afterPage: number, added: number): void {
  if (added <= 0) return
  for (const mark of session.marks) {
    if (mark.page > afterPage) mark.page += added
  }
  if (session.bookmarkedPages?.length) {
    session.bookmarkedPages = session.bookmarkedPages
      .map((page) => (page > afterPage ? page + added : page))
      .sort((a, b) => a - b)
  }
}

function closeInsertMenu(): void {
  insertPop.hidden = true
  insertToggle.setAttribute('aria-expanded', 'false')
}

async function addImageAt(file: File, pageEl: HTMLElement, clientX: number, clientY: number): Promise<void> {
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    buddy.set('grumpy', 'that photo wouldn’t open')
    return
  }
  const naturalW = bitmap.width
  const naturalH = bitmap.height
  bitmap.close()
  if (naturalW < 1 || naturalH < 1) return
  const [xMin, yMin, xMax, yMax] = view.viewport.viewBox
  const maxW = Math.max(48, (xMax - xMin) * 0.42)
  const maxH = Math.max(48, (yMax - yMin) * 0.42)
  const scale = Math.min(maxW / naturalW, maxH / naturalH)
  const w = Math.max(16, naturalW * scale)
  const h = Math.max(16, naturalH * scale)
  const pt = clientPointToPdf(pageEl, view.viewport, clientX, clientY)
  const imageId = newId()
  await rememberImage(imageId, file)
  snapshotMarks()
  session.marks.push({
    id: newId(),
    kind: 'image',
    page,
    x: pt.x - w / 2,
    y: pt.y - h / 2,
    w,
    h,
    rotation: 0,
    imageId,
  })
  selectedId = session.marks.at(-1)?.id ?? null
  persist()
  paintAll()
  renderChrome()
  buddy.marked('image', session.marks.length)
}

async function replacePdfBytes(next: Uint8Array, scrollTo?: number): Promise<void> {
  const bytes = new ArrayBuffer(next.byteLength)
  new Uint8Array(bytes).set(next)
  pdfBytes = bytes
  await savePdfBytes(session.docId, bytes)
  persist()
  await showPdf(bytes, true)
  if (scrollTo) viewer.scrollToPage(scrollTo)
}

async function insertBlank(): Promise<void> {
  if (!pdfBytes) return
  const after = viewer.visiblePage
  try {
    const next = await insertBlankPage(pdfBytes, after)
    shiftMarksAfter(after, 1)
    await replacePdfBytes(next, after + 1)
    buddy.marked('page', session.marks.length)
  } catch {
    buddy.set('grumpy', 'couldn’t add that page')
  }
}

async function insertFromFile(file: File): Promise<void> {
  if (!pdfBytes) return
  const after = viewer.visiblePage
  try {
    const { bytes, added } = await insertPagesFromFile(pdfBytes, after, file)
    if (added <= 0) return
    shiftMarksAfter(after, added)
    await replacePdfBytes(bytes, after + 1)
    buddy.marked('page', session.marks.length)
  } catch {
    buddy.set('grumpy', 'couldn’t add that page')
  }
}

async function openPdf(file: File): Promise<void> {
  buddy.opening()
  const bytes = await file.arrayBuffer()
  const leftover = imageIdsOf(session.marks)
  revokeImageUrls()
  void deleteImageBlobs(leftover)
  session.fileName = file.name
  session.docId = newId()
  session.marks = []
  session.bookmarkedPages = []
  session.showBookmarkedOnly = false
  selectedId = null
  undoStack.length = 0
  persist()
  closeThumbsMenu()
  await savePdfBytes(session.docId, bytes.slice(0))
  await showPdf(bytes)
}

async function showPdf(bytes: ArrayBuffer, restored = false): Promise<void> {
  pdfBytes = bytes.slice(0)
  empty.hidden = true
  pagesHost.hidden = false
  viewer.zoom = session.zoom / 100
  viewer.singlePage = session.singlePage === true
  outlineEntries = []
  outlineList.replaceChildren()
  applySidebar()
  await viewer.load(bytes)
  await renderOutline()
  renderChrome()
  if (restored) buddy.greet(true)
  else buddy.opened()
}

function snapshotMarks(): void {
  undoStack.push(session.marks.map((m) => structuredClone(m)))
  if (undoStack.length > 80) undoStack.shift()
}

function applyInk(pageEl: HTMLElement, mapped: { quads: Quad[]; text: string }): void {
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return

  if (session.tool === 'text' || session.tool === 'marker') return
  snapshotMarks()
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
  if (selectedId) placeSelMenuForMark(selectedId)
  buddy.marked(session.tool, session.marks.length)
}

function inkAtPoint(pageEl: HTMLElement, clientX: number, clientY: number): string | null {
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return null
  const pt = clientPointToPdf(pageEl, view.viewport, clientX, clientY)
  const hit = [...session.marks].reverse().find(
    (m) => m.page === page && 'quads' in m && pointInQuads(pt.x, pt.y, m.quads),
  )
  return hit?.id ?? null
}

function addTextMark(event: PointerEvent): void {
  if (session.tool !== 'text') return
  const target = event.target as HTMLElement
  if (target.closest('.mark')) return
  const pageEl = target.closest<HTMLElement>('.page')
  if (!pageEl) return
  dropEmptyText()
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return
  const pt = clientPointToPdf(pageEl, view.viewport, event.clientX, event.clientY)
  const width = session.textWidth && session.textWidth > 0 ? session.textWidth : 180
  const fontSize = session.textFontSize && session.textFontSize > 0 ? session.textFontSize : 14
  const placed = clampTextOrigin(view.viewport, pt.x, pt.y, width, fontSize)
  snapshotMarks()
  const mark: Mark = {
    id: newId(),
    kind: 'text',
    page,
    color: { ...session.color },
    x: placed.x,
    y: placed.y,
    width: placed.width,
    fontSize,
    content: '',
    html: '',
  }
  session.marks.push(mark)
  selectedId = mark.id
  paintPage(view)
  window.setTimeout(() => {
    pageEl.querySelector<HTMLElement>(`.mark-text[data-id="${mark.id}"] .text-body`)?.focus()
  }, 0)
  buddy.marked('text', session.marks.length)
  renderChrome()
}

function clearSelection(): void {
  const pruned = dropEmptyText()
  hideSelMenu()
  if (!selectedId && !pruned) return
  selectedId = null
  if (pruned) persist()
  paintAll()
  renderChrome()
}

function deleteSelected(): void {
  if (!selectedId) return
  const active = document.activeElement
  if (
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLInputElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  ) {
    return
  }
  snapshotMarks()
  session.marks = session.marks.filter((m) => m.id !== selectedId)
  selectedId = null
  persist()
  paintAll()
  renderChrome()
  buddy.deleted()
}

function undoMarks(): void {
  const prev = undoStack.pop()
  if (!prev) return
  session.marks = prev
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

for (const input of app.querySelectorAll<HTMLInputElement>('[data-open-pdf]')) {
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) void openPdf(file)
    input.value = ''
  })
}

photoFileInput.addEventListener('change', () => {
  const file = photoFileInput.files?.[0]
  photoFileInput.value = ''
  const view = viewer.getView(viewer.visiblePage)
  if (!file || !view) return
  const box = view.el.getBoundingClientRect()
  void addImageAt(file, view.el, box.left + box.width / 2, box.top + box.height / 2)
})

pageFileInput.addEventListener('change', () => {
  const file = pageFileInput.files?.[0]
  pageFileInput.value = ''
  if (file) void insertFromFile(file)
})

insertToggle.addEventListener('click', (e) => {
  e.stopPropagation()
  if (!pdfBytes) return
  closeThumbsMenu()
  insertPop.hidden = !insertPop.hidden
  insertToggle.setAttribute('aria-expanded', insertPop.hidden ? 'false' : 'true')
})

insertPop.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-insert]')
  if (!btn) return
  closeInsertMenu()
  const action = btn.dataset.insert
  if (action === 'photo') photoFileInput.click()
  else if (action === 'page-file') pageFileInput.click()
  else if (action === 'blank') void insertBlank()
})

thumbsMenuToggle.addEventListener('click', (e) => {
  e.stopPropagation()
  closeInsertMenu()
  if (thumbsPop.hidden) openThumbsMenu()
  else closeThumbsMenu()
})

thumbsFilterBtn.addEventListener('click', () => {
  session.showBookmarkedOnly = !session.showBookmarkedOnly
  persist()
  applySidebar()
  closeThumbsMenu()
})

singlePageBtn.addEventListener('click', () => {
  session.singlePage = !session.singlePage
  persist()
  syncSinglePage()
  closeThumbsMenu()
})

thumbsPop.addEventListener('click', (e) => {
  const modeBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sidebar-mode]')
  if (modeBtn?.dataset.sidebarMode === 'thumbs' || modeBtn?.dataset.sidebarMode === 'outline') {
    session.sidebar = modeBtn.dataset.sidebarMode
    session.sidebarHidden = false
    persist()
    applySidebar()
    closeThumbsMenu()
    return
  }
  if ((e.target as HTMLElement).closest('[data-sidebar-visibility]')) {
    session.sidebarHidden = !session.sidebarHidden
    persist()
    applySidebar()
    closeThumbsMenu()
  }
})

document.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('.insert-wrap')) return
  closeInsertMenu()
  if (t.closest('.thumbs-header, .thumbs-pop')) return
  closeThumbsMenu()
})

function addInkDot(host: HTMLElement, preset: (typeof PRESET_COLORS)[number]): void {
  const dot = document.createElement('button')
  dot.type = 'button'
  dot.className = 'ink-dot'
  dot.title = preset.name
  dot.setAttribute('role', 'option')
  dot.dataset.hex = hexColor(preset.color)
  dot.style.background = hexColor(preset.color)
  dot.addEventListener('click', () => setColor(preset.color))
  host.append(dot)
}

const inkDots = app.querySelector<HTMLElement>('[data-ink-dots]')!
const selDots = app.querySelector<HTMLElement>('[data-sel-dots]')!
for (const preset of PRESET_COLORS) {
  addInkDot(inkDots, preset)
  addInkDot(selDots, preset)
}

for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  btn.addEventListener('click', () => setTool(btn.dataset.tool as Tool))
}

app.querySelector('[data-marker-size="down"]')?.addEventListener('click', () => stepMarkerWidth(-1))
app.querySelector('[data-marker-size="up"]')?.addEventListener('click', () => stepMarkerWidth(1))

for (const btn of selMenu.querySelectorAll<HTMLButtonElement>('[data-apply]')) {
  btn.addEventListener('click', () => setTool(btn.dataset.apply as Tool))
}
selMenu.querySelector('[data-delete-mark]')?.addEventListener('click', () => {
  deleteSelected()
  hideSelMenu()
})

formatBar.addEventListener('mousedown', (e) => {
  const target = e.target as HTMLElement
  if (target.closest('input')) return
  if (target.closest('button, .ink-dot, .ink-custom')) e.preventDefault()
})
selMenu.addEventListener('mousedown', (e) => e.preventDefault())

window.addEventListener('pointerdown', () => {
  pointerSelecting = true
}, true)
window.addEventListener('pointerup', () => {
  pointerSelecting = false
}, true)
document.addEventListener('selectionchange', () => rememberSelection())

undoBtn.addEventListener('click', () => undoMarks())

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
  if ((e.target as HTMLElement).closest('textarea, button, input, .buddy, .mark, .sel-menu')) return
  const { clientX, clientY } = e
  window.setTimeout(() => {
    if (session.tool === 'text' || session.tool === 'marker') return
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed) {
      rememberSelection()
      return
    }
    clearPending()
    const word = wordRangeAt(clientX, clientY)
    const pageEl =
      (word ? pageFromNode(word.startContainer) : null) ??
      (e.target as HTMLElement).closest<HTMLElement>('.page')
    if (pageEl) {
      const existing = inkAtPoint(pageEl, clientX, clientY)
      if (existing) {
        const mark = session.marks.find((m) => m.id === existing)
        if (mark && 'quads' in mark) {
          if (selectedId !== existing) {
            dropEmptyText(existing)
            selectedId = existing
            paintAll()
            buddy.selected()
          }
          placeSelMenuForMark(existing)
          renderChrome()
          return
        }
      }
    }
    if (word && pageEl) {
      const view = viewer.getView(Number(pageEl.dataset.page))
      const mapped = view ? rangeToQuads(word, pageEl, view.viewport) : null
      if (mapped?.text.trim()) {
        applyInk(pageEl, mapped)
        return
      }
    }
    clearSelection()
  }, 0)
})
function beginMarker(e: PointerEvent): void {
  if (session.tool !== 'marker' || e.button !== 0) return
  const target = e.target as HTMLElement
  if (target.closest('.buddy, .toolbar, .mark-text, .mark-image, .sel-menu')) return
  const pageEl = target.closest<HTMLElement>('.page')
  if (!pageEl) return
  e.preventDefault()
  const page = Number(pageEl.dataset.page)
  const view = viewer.getView(page)
  if (!view) return
  const pt = clientPointToPdf(pageEl, view.viewport, e.clientX, e.clientY)
  markerPointer = e.pointerId
  markerMoved = false
  markerStart = { x: e.clientX, y: e.clientY }
  draftMarker = {
    id: newId(),
    kind: 'marker',
    page,
    color: { ...session.color },
    width: currentMarkerWidth(),
    points: [pt],
  }
  pageEl.setPointerCapture(e.pointerId)
  paintPage(view)
}

function moveMarker(e: PointerEvent): void {
  if (!draftMarker || e.pointerId !== markerPointer) return
  const view = viewer.getView(draftMarker.page)
  if (!view) return
  if (Math.hypot(e.clientX - markerStart.x, e.clientY - markerStart.y) >= 4) markerMoved = true
  const pt = clientPointToPdf(view.el, view.viewport, e.clientX, e.clientY)
  const last = draftMarker.points.at(-1)
  if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 1.5) return
  draftMarker.points.push(pt)
  paintPage(view)
}

function endMarker(e: PointerEvent): void {
  if (!draftMarker || markerPointer === null || e.pointerId !== markerPointer) return
  const draft = draftMarker
  const view = viewer.getView(draft.page)
  draftMarker = null
  markerPointer = null
  if (!markerMoved || draft.points.length < 2) {
    if (view) {
      const pt = clientPointToPdf(view.el, view.viewport, e.clientX, e.clientY)
      const hit = [...session.marks].reverse().find(
        (m) => m.kind === 'marker' && m.page === draft.page && pointHitsMarker(pt.x, pt.y, m.points, m.width),
      )
      selectedId = hit?.id ?? null
      paintPage(view)
    }
    renderChrome()
    return
  }
  snapshotMarks()
  session.marks.push(draft)
  selectedId = draft.id
  persist()
  if (view) paintPage(view)
  renderChrome()
  buddy.marked('marker', session.marks.length)
}

pagesHost.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement
  if (!target.closest('.mark-text, .mark-image, .sel-menu') && session.tool !== 'text') clearPending()
  if (session.tool === 'text') addTextMark(e)
  else if (session.tool === 'marker') beginMarker(e)
})
pagesHost.addEventListener('pointermove', moveMarker)
pagesHost.addEventListener('pointerup', endMarker)
pagesHost.addEventListener('pointercancel', endMarker)

const TOOL_KEYS: Record<string, Tool> = {
  h: 'highlight',
  u: 'underline',
  s: 'strikethrough',
  t: 'text',
  m: 'marker',
}

function isTyping(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!pendingInk && !selectedId) return
    clearPending()
    document.getSelection()?.removeAllRanges()
    clearSelection()
    return
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
    if (
      session.singlePage &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'PageUp' || e.key === 'PageDown')
    ) {
      e.preventDefault()
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') viewer.prevPage()
      else viewer.nextPage()
      return
    }
    if (
      (e.key === '[' || e.key === ']') &&
      (session.tool === 'marker' || session.marks.some((m) => m.id === selectedId && m.kind === 'marker'))
    ) {
      e.preventDefault()
      stepMarkerWidth(e.key === ']' ? 1 : -1)
      return
    }
    if (!e.shiftKey) {
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) {
        e.preventDefault()
        setTool(tool)
        return
      }
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    const typing = document.activeElement
    if (
      typing instanceof HTMLTextAreaElement ||
      typing instanceof HTMLInputElement ||
      (typing instanceof HTMLElement && typing.isContentEditable)
    )
      return
    e.preventDefault()
    undoMarks()
    return
  }
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
viewerEl.addEventListener('scroll', () => {
  if (pendingInk) {
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      showSelMenu(selection.getRangeAt(0).getBoundingClientRect(), false)
      return
    }
    clearPending()
  }
  const selected = selectedId ? session.marks.find((m) => m.id === selectedId) : undefined
  if (selected && 'quads' in selected) placeSelMenuForMark(selected.id)
}, { passive: true })
viewerEl.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('.page, textarea, button, input, .buddy, .mark-text, .mark-image')) return
  clearSelection()
})
viewerEl.addEventListener(
  'wheel',
  (event) => {
    const e = event as WheelEvent
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      const step = e.deltaY > 0 ? -10 : 10
      setZoom(session.zoom + step)
      return
    }
    if (!session.singlePage || e.deltaY === 0) return
    const atTop = viewerEl.scrollTop <= 0
    const atBottom = viewerEl.scrollTop + viewerEl.clientHeight >= viewerEl.scrollHeight - 1
    if (e.deltaY > 0 && atBottom && viewer.nextPage()) e.preventDefault()
    else if (e.deltaY < 0 && atTop && viewer.prevPage()) e.preventDefault()
  },
  { passive: false },
)
;['dragenter', 'dragover'].forEach((type) => {
  viewerEl.addEventListener(type, (e) => {
    e.preventDefault()
  })
})
pagesHost.addEventListener('drop', (e) => {
  const dt = (e as DragEvent).dataTransfer
  const image = [...(dt?.files ?? [])].find(isImageFile)
  const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.page')
  if (image && pageEl && pdfBytes) {
    e.preventDefault()
    e.stopPropagation()
    void addImageAt(image, pageEl, (e as DragEvent).clientX, (e as DragEvent).clientY)
  }
})
viewerEl.addEventListener('drop', (e) => {
  e.preventDefault()
  const files = [...((e as DragEvent).dataTransfer?.files ?? [])]
  const image = files.find(isImageFile)
  const pageEl = viewer.getView(viewer.visiblePage)?.el
  if (image && pdfBytes && pageEl) {
    const box = pageEl.getBoundingClientRect()
    void addImageAt(image, pageEl, (e as DragEvent).clientX || box.left + box.width / 2, (e as DragEvent).clientY || box.top + box.height / 2)
    return
  }
  const file = files.find((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
  if (file) void openPdf(file)
})

if (!session.color) session.color = { ...DEFAULT_COLOR }
renderChrome()
buddy.greet(Boolean(session.docId))

if (session.docId) {
  void loadPdfBytes(session.docId).then(async (bytes) => {
    if (!bytes) return
    await hydrateImages(session.marks)
    await showPdf(bytes, true)
  })
}
