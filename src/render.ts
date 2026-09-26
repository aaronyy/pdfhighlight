import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
  type RenderTask,
} from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { bindTextGeometry } from './annotate'

GlobalWorkerOptions.workerSrc = workerSrc

const PAGE_GAP = 20

function applyPageMetrics(el: HTMLElement, viewport: PageViewport): void {
  el.style.width = `${viewport.width}px`
  el.style.height = `${viewport.height}px`
  el.style.setProperty('--scale-factor', String(viewport.scale))
}

export type PageView = {
  pageNumber: number
  page: PDFPageProxy
  viewport: PageViewport
  el: HTMLElement
}

export class PdfViewer {
  private pdf: PDFDocumentProxy | null = null
  private pages = new Map<number, PageView>()
  private tasks = new Map<number, RenderTask>()
  private textLayers = new Map<number, TextLayer>()
  private observer: IntersectionObserver | null = null
  private host: HTMLElement
  private thumbs: HTMLElement
  private onPagesReady: (views: PageView[]) => void
  private onVisiblePage: (page: number) => void
  private fitScale = 1
  private paintGeneration = 0
  zoom = 1
  scale = 1.2
  visiblePage = 1

  constructor(
    host: HTMLElement,
    thumbs: HTMLElement,
    onPagesReady: (views: PageView[]) => void,
    onVisiblePage: (page: number) => void,
  ) {
    this.host = host
    this.thumbs = thumbs
    this.onPagesReady = onPagesReady
    this.onVisiblePage = onVisiblePage
  }

  async load(data: ArrayBuffer): Promise<number> {
    this.paintGeneration++
    this.destroy()
    const assetBase = import.meta.env.BASE_URL
    this.pdf = await getDocument({
      data: new Uint8Array(data.slice(0)),
      cMapUrl: `${assetBase}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`,
      iccUrl: `${assetBase}iccs/`,
      useSystemFonts: true,
    }).promise
    this.host.replaceChildren()
    this.thumbs.replaceChildren()
    this.pages.clear()
    this.visiblePage = 1

    const count = this.pdf.numPages
    const first = await this.pdf.getPage(1)
    const base = first.getViewport({ scale: 1 })
    this.fitScale = this.computeFitScale(base.width, base.height)
    this.scale = this.fitScale * this.zoom

    for (let n = 1; n <= count; n++) {
      const page = n === 1 ? first : await this.pdf.getPage(n)
      const viewport = page.getViewport({ scale: this.scale })
      const el = this.createPageShell(n, viewport)
      this.host.append(el)
      this.pages.set(n, { pageNumber: n, page, viewport, el })
      this.thumbs.append(this.createThumb(n, viewport.width, viewport.height))
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.page))
          .sort((a, b) => a - b)
        if (visible[0]) {
          this.visiblePage = visible[0]
          this.onVisiblePage(visible[0])
        }
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page)
          if (entry.isIntersecting) void this.renderPage(n)
        }
      },
      { root: this.host.closest('.viewer') ?? undefined, rootMargin: '400px 0px', threshold: 0.01 },
    )
    for (const view of this.pages.values()) this.observer.observe(view.el)

    this.onPagesReady([...this.pages.values()])
    // Paint the first screen immediately — IO can miss the initial layout frame.
    void this.renderPage(1)
    if (count > 1) void this.renderPage(2)
    return count
  }

  getView(page: number): PageView | undefined {
    return this.pages.get(page)
  }

  views(): PageView[] {
    return [...this.pages.values()]
  }

  scrollToPage(page: number): void {
    this.pages.get(page)?.el.scrollIntoView({ block: 'start' })
  }

  private computeFitScale(pageWidth: number, pageHeight: number): number {
    const scroller = this.host.closest('.viewer') as HTMLElement | null
    const availW = Math.max(320, (scroller?.clientWidth ?? this.host.clientWidth) - 96)
    const availH = Math.max(240, (scroller?.clientHeight ?? window.innerHeight) - 48)
    const fitWidth = availW / pageWidth
    // Fit width for paper-like pages; contain when fit-width would clip the page.
    if (fitWidth * pageHeight <= availH * 1.02) return fitWidth
    return Math.min(fitWidth, availH / pageHeight)
  }

  applyZoom(zoom: number): void {
    if (!this.pdf) return
    this.paintGeneration++
    this.zoom = Math.min(3, Math.max(0.4, zoom))
    const first = this.pages.get(1)
    if (first) {
      const base = first.page.getViewport({ scale: 1 })
      this.fitScale = this.computeFitScale(base.width, base.height)
    }
    this.scale = this.fitScale * this.zoom
    const scroller = this.host.closest('.viewer')
    const keep = scroller ? scroller.scrollTop / Math.max(1, scroller.scrollHeight) : 0
    for (const task of this.tasks.values()) task.cancel()
    this.tasks.clear()
    this.cancelTextLayers()
    for (const view of this.pages.values()) {
      view.viewport = view.page.getViewport({ scale: this.scale })
      applyPageMetrics(view.el, view.viewport)
      delete view.el.dataset.rendered
      view.el.querySelector('.textLayer')?.replaceChildren()
    }
    this.onPagesReady([...this.pages.values()])
    for (const view of this.pages.values()) {
      const box = view.el.getBoundingClientRect()
      const hostBox = this.host.getBoundingClientRect()
      if (box.bottom > hostBox.top - 400 && box.top < hostBox.bottom + 400) {
        void this.renderPage(view.pageNumber)
      }
    }
    if (scroller) scroller.scrollTop = keep * scroller.scrollHeight
  }

  private createPageShell(n: number, viewport: PageViewport): HTMLElement {
    const el = document.createElement('div')
    el.className = 'page selecting'
    el.dataset.page = String(n)
    applyPageMetrics(el, viewport)
    el.style.marginBottom = `${PAGE_GAP}px`

    const canvas = document.createElement('canvas')
    canvas.className = 'page-canvas'
    const annot = document.createElement('div')
    annot.className = 'annot-layer'
    const text = document.createElement('div')
    text.className = 'textLayer'
    el.append(canvas, annot, text)
    return el
  }

  private createThumb(n: number, width: number, height: number): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'thumb'
    btn.dataset.page = String(n)
    const frame = document.createElement('div')
    frame.className = 'thumb-frame'
    frame.style.aspectRatio = `${width} / ${height}`
    const label = document.createElement('span')
    label.textContent = String(n)
    btn.append(frame, label)
    btn.addEventListener('click', () => this.scrollToPage(n))
    return btn
  }

  setActiveThumb(page: number): void {
    for (const el of this.thumbs.querySelectorAll('.thumb')) {
      el.classList.toggle('active', Number((el as HTMLElement).dataset.page) === page)
    }
  }

  private async renderPage(n: number): Promise<void> {
    const view = this.pages.get(n)
    if (!view || view.el.dataset.rendered === '1') return
    const generation = this.paintGeneration
    view.el.dataset.rendered = '1'

    const canvas = view.el.querySelector('canvas')
    const textLayerEl = view.el.querySelector<HTMLElement>('.textLayer')
    if (!canvas || !textLayerEl) {
      delete view.el.dataset.rendered
      return
    }

    try {
      const outputScale = window.devicePixelRatio || 1
      const maxDim = 8192
      const pixelW = view.viewport.width * outputScale
      const pixelH = view.viewport.height * outputScale
      const clamp = Math.min(1, maxDim / pixelW, maxDim / pixelH)
      const drawScale = outputScale * clamp
      canvas.width = Math.max(1, Math.floor(view.viewport.width * drawScale))
      canvas.height = Math.max(1, Math.floor(view.viewport.height * drawScale))
      canvas.style.width = `${view.viewport.width}px`
      canvas.style.height = `${view.viewport.height}px`

      const task = view.page.render({
        canvas,
        viewport: view.viewport,
        transform: drawScale !== 1 ? [drawScale, 0, 0, drawScale, 0, 0] : undefined,
      })
      this.tasks.set(n, task)
      await task.promise
      this.tasks.delete(n)
      if (generation !== this.paintGeneration) return

      const content = await view.page.getTextContent()
      if (generation !== this.paintGeneration) return
      // Draw into a detached node. A cancelled paint can still append after
      // zoom has cleared the live layer; swapping only on success keeps the
      // page on one text layer.
      const holder = document.createElement('div')
      const layer = new TextLayer({
        textContentSource: content,
        container: holder,
        viewport: view.viewport,
      })
      this.textLayers.get(n)?.cancel()
      this.textLayers.set(n, layer)
      await layer.render()
      if (this.textLayers.get(n) !== layer || generation !== this.paintGeneration) return
      textLayerEl.replaceChildren(...holder.childNodes)
      bindTextGeometry(view.el, content)
      view.el.dispatchEvent(new CustomEvent('page-painted', { bubbles: true }))

      const thumb = this.thumbs.querySelector<HTMLElement>(`.thumb[data-page="${n}"] .thumb-frame`)
      if (thumb) {
        const img = document.createElement('img')
        img.alt = `Page ${n}`
        img.src = canvas.toDataURL('image/jpeg', 0.6)
        thumb.replaceChildren(img)
      }
    } catch (err) {
      this.tasks.delete(n)
      if (generation === this.paintGeneration) delete view.el.dataset.rendered
      if (generation === this.paintGeneration) console.warn(`pdf page ${n} render failed`, err)
    }
  }

  private cancelTextLayers(): void {
    for (const layer of this.textLayers.values()) layer.cancel()
    this.textLayers.clear()
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
    for (const task of this.tasks.values()) task.cancel()
    this.tasks.clear()
    this.cancelTextLayers()
    void this.pdf?.cleanup()
    this.pdf = null
    this.pages.clear()
  }
}
