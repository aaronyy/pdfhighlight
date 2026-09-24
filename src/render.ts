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

GlobalWorkerOptions.workerSrc = workerSrc

const PAGE_GAP = 20

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
  private observer: IntersectionObserver | null = null
  private host: HTMLElement
  private thumbs: HTMLElement
  private onPagesReady: (views: PageView[]) => void
  private onVisiblePage: (page: number) => void
  scale = 1.2

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

    const count = this.pdf.numPages
    const width = Math.max(320, this.host.clientWidth - 80)
    const first = await this.pdf.getPage(1)
    const base = first.getViewport({ scale: 1 })
    this.scale = width / base.width

    for (let n = 1; n <= count; n++) {
      const page = n === 1 ? first : await this.pdf.getPage(n)
      const viewport = page.getViewport({ scale: this.scale })
      const el = this.createPageShell(n, viewport)
      this.host.append(el)
      this.pages.set(n, { pageNumber: n, page, viewport, el })
      this.thumbs.append(this.createThumb(n, viewport.width / viewport.height))
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.page))
          .sort((a, b) => a - b)
        if (visible[0]) this.onVisiblePage(visible[0])
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page)
          if (entry.isIntersecting) void this.renderPage(n)
        }
      },
      { root: this.host, rootMargin: '400px 0px', threshold: 0.01 },
    )
    for (const view of this.pages.values()) this.observer.observe(view.el)

    this.onPagesReady([...this.pages.values()])
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

  private createPageShell(n: number, viewport: PageViewport): HTMLElement {
    const el = document.createElement('div')
    el.className = 'page'
    el.dataset.page = String(n)
    el.style.width = `${viewport.width}px`
    el.style.height = `${viewport.height}px`
    el.style.marginBottom = `${PAGE_GAP}px`

    const canvas = document.createElement('canvas')
    canvas.className = 'page-canvas'
    const annot = document.createElement('div')
    annot.className = 'annot-layer'
    const text = document.createElement('div')
    text.className = 'text-layer'
    el.append(canvas, annot, text)
    return el
  }

  private createThumb(n: number, ratio: number): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'thumb'
    btn.dataset.page = String(n)
    const frame = document.createElement('div')
    frame.className = 'thumb-frame'
    frame.style.aspectRatio = `${1} / ${ratio}`
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
    view.el.dataset.rendered = '1'

    const canvas = view.el.querySelector('canvas')
    const textLayerEl = view.el.querySelector<HTMLElement>('.text-layer')
    if (!canvas || !textLayerEl) return

    const outputScale = window.devicePixelRatio || 1
    canvas.width = Math.floor(view.viewport.width * outputScale)
    canvas.height = Math.floor(view.viewport.height * outputScale)
    canvas.style.width = `${view.viewport.width}px`
    canvas.style.height = `${view.viewport.height}px`

    const task = view.page.render({
      canvas,
      viewport: view.viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    })
    this.tasks.set(n, task)
    await task.promise
    this.tasks.delete(n)

    const content = await view.page.getTextContent()
    textLayerEl.replaceChildren()
    const layer = new TextLayer({
      textContentSource: content,
      container: textLayerEl,
      viewport: view.viewport,
    })
    await layer.render()

    const thumb = this.thumbs.querySelector<HTMLElement>(`.thumb[data-page="${n}"] .thumb-frame`)
    if (thumb) {
      const img = document.createElement('img')
      img.alt = `Page ${n}`
      img.src = canvas.toDataURL('image/jpeg', 0.6)
      thumb.replaceChildren(img)
    }
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
    for (const task of this.tasks.values()) task.cancel()
    this.tasks.clear()
    void this.pdf?.cleanup()
    this.pdf = null
    this.pages.clear()
  }
}
