import { BlendMode, LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { embedRaster } from './insert'
import { loadImageBlob } from './store'
import type { Color, ImageMark, Mark, MarkerMark, Point, TextMark } from './types'

function toRgb(color: Color) {
  return rgb(color.r / 255, color.g / 255, color.b / 255)
}

export async function downloadAnnotatedPdf(
  bytes: ArrayBuffer,
  fileName: string,
  marks: Mark[],
): Promise<void> {
  const pdf = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true })
  const pages = pdf.getPages()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fonts: Record<Face, PDFFont> = {
    regular: font,
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    bolditalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  }

  for (const mark of marks) {
    const page = pages[mark.page - 1]
    if (!page) continue

    if (mark.kind === 'image') {
      await drawImageMark(pdf, page, mark)
      continue
    }

    const color = toRgb(mark.color)

    if (mark.kind === 'text') {
      if (!mark.content.trim()) continue
      drawTextBox(page, mark, font, fonts)
      continue
    }

    if (mark.kind === 'marker') {
      drawMarker(page, mark, color)
      continue
    }

    for (const q of mark.quads) {
      if (mark.kind === 'highlight') {
        const inset = Math.min(1.5, q.h * 0.1)
        page.drawRectangle({
          x: q.x,
          y: q.y + inset,
          width: q.w,
          height: Math.max(1, q.h - inset * 2),
          color,
          opacity: 0.5,
          borderWidth: 0,
          blendMode: BlendMode.Multiply,
        })
      } else if (mark.kind === 'underline') {
        const y = q.y + q.h * 0.16
        page.drawLine({
          start: { x: q.x, y },
          end: { x: q.x + q.w, y },
          thickness: 1.15,
          color,
        })
      } else {
        const y = q.y + q.h * 0.56
        page.drawLine({
          start: { x: q.x, y },
          end: { x: q.x + q.w, y },
          thickness: 1.15,
          color,
        })
      }
    }
  }

  const out = await pdf.save()
  const copy = new Uint8Array(out.byteLength)
  copy.set(out)
  const blob = new Blob([copy], { type: 'application/pdf' })
  const a = document.createElement('a')
  const base = fileName.replace(/\.pdf$/i, '')
  a.href = URL.createObjectURL(blob)
  a.download = `${base}-highlighted.pdf`
  a.click()
  URL.revokeObjectURL(a.href)
}

function markerPdfPath(points: Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`)
    .join(' ')
}

function imageDrawOrigin(mark: ImageMark): { x: number; y: number } {
  const phi = (-mark.rotation * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const cx = mark.x + mark.w / 2
  const cy = mark.y + mark.h / 2
  return {
    x: cx - (mark.w / 2) * cos + (mark.h / 2) * sin,
    y: cy - (mark.w / 2) * sin - (mark.h / 2) * cos,
  }
}

async function drawImageMark(pdf: PDFDocument, page: PDFPage, mark: ImageMark): Promise<void> {
  const blob = await loadImageBlob(mark.imageId)
  if (!blob) return
  try {
    const image = await embedRaster(pdf, blob)
    const origin = imageDrawOrigin(mark)
    page.drawImage(image, {
      x: origin.x,
      y: origin.y,
      width: mark.w,
      height: mark.h,
      rotate: degrees(-mark.rotation),
    })
  } catch (err) {
    console.warn('image export skipped', err)
  }
}

function drawMarker(page: PDFPage, mark: MarkerMark, color: ReturnType<typeof toRgb>): void {
  if (mark.points.length === 0) return
  const points =
    mark.points.length === 1
      ? [mark.points[0], { x: mark.points[0].x + 0.01, y: mark.points[0].y }]
      : mark.points
  page.drawSvgPath(markerPdfPath(points), {
    x: 0,
    y: 0,
    borderColor: color,
    borderWidth: Math.max(1, mark.width),
    borderOpacity: 0.45,
    borderLineCap: LineCapStyle.Round,
    blendMode: BlendMode.Multiply,
  })
}

type Face = 'regular' | 'bold' | 'italic' | 'bolditalic'

type Run = { text: string; color: Color; bg?: Color; face: Face; underline?: boolean; strike?: boolean }

function isClearBg(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return true
  return /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(v)
}

function cssToColor(value: string, fallback: Color): Color {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const rgbMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgbMatch) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) }
  }
  return fallback
}

function faceOf(bold: boolean, italic: boolean): Face {
  if (bold && italic) return 'bolditalic'
  if (bold) return 'bold'
  if (italic) return 'italic'
  return 'regular'
}

function runsIn(
  node: Node,
  color: Color,
  bg: Color | undefined,
  bold: boolean,
  italic: boolean,
  underline: boolean,
  strike: boolean,
  into: Run[],
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\u00a0/g, ' ')
    if (text) into.push({ text, color, bg, face: faceOf(bold, italic), underline, strike })
    return
  }
  if (!(node instanceof HTMLElement)) return
  if (node.tagName === 'BR') {
    into.push({ text: '\n', color, bg, face: faceOf(bold, italic), underline, strike })
    return
  }
  const deco = `${node.style.textDecoration} ${node.style.textDecorationLine}`
  const nextBold = bold || node.tagName === 'B' || node.tagName === 'STRONG'
  const nextItalic = italic || node.tagName === 'I' || node.tagName === 'EM'
  const nextUnderline = underline || node.tagName === 'U' || deco.includes('underline')
  const nextStrike =
    strike || node.tagName === 'S' || node.tagName === 'STRIKE' || node.tagName === 'DEL' || deco.includes('line-through')
  const nextColor = node.style.color ? cssToColor(node.style.color, color) : color
  const nextBg = node.style.backgroundColor
    ? isClearBg(node.style.backgroundColor)
      ? undefined
      : cssToColor(node.style.backgroundColor, color)
    : bg
  for (const child of node.childNodes)
    runsIn(child, nextColor, nextBg, nextBold, nextItalic, nextUnderline, nextStrike, into)
}

function bulletOf(el: HTMLElement, fallback: Color): { node: HTMLElement; color: Color } | null {
  const node = [...el.childNodes].find((child) => child instanceof HTMLElement && child.dataset.bullet === '1')
  if (!(node instanceof HTMLElement)) return null
  let color = fallback
  const painted = node.style.color ? node : node.querySelector<HTMLElement>('[style*="color"]')
  if (painted?.style.color) color = cssToColor(painted.style.color, fallback)
  return { node, color }
}

function linesOf(mark: TextMark): { bullet: boolean; bulletColor: Color; runs: Run[] }[] {
  const html = mark.html || mark.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
  const root = document.createElement('div')
  root.innerHTML = html
  const lines: { bullet: boolean; bulletColor: Color; runs: Run[] }[] = []
  const pushBlock = (el: HTMLElement, bullet: boolean) => {
    const lead = bullet ? bulletOf(el, mark.color) : null
    const runs: Run[] = []
    if (lead) {
      for (const child of el.childNodes) {
        if (child === lead.node) continue
        runsIn(child, mark.color, undefined, false, false, false, false, runs)
      }
    } else runsIn(el, mark.color, undefined, false, false, false, false, runs)
    const chunks: Run[][] = [[]]
    for (const run of runs) {
      const parts = run.text.split('\n')
      parts.forEach((part, i) => {
        if (i > 0) chunks.push([])
        if (part) chunks.at(-1)?.push({ ...run, text: part })
      })
    }
    for (const chunk of chunks) lines.push({ bullet, bulletColor: lead?.color ?? mark.color, runs: chunk })
  }
  const visit = (node: Node, bullet: boolean) => {
    if (!(node instanceof HTMLElement)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        lines.push({
          bullet,
          bulletColor: mark.color,
          runs: [{ text: node.textContent.replace(/\u00a0/g, ' '), color: mark.color, face: 'regular' }],
        })
      }
      return
    }
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      for (const child of node.children) visit(child, true)
      return
    }
    if (node.tagName === 'LI' || node.tagName === 'P' || node.tagName === 'DIV') {
      pushBlock(node, bullet || node.tagName === 'LI')
      return
    }
    pushBlock(node, bullet)
  }
  if (root.childNodes.length === 0) return []
  for (const child of root.childNodes) visit(child, false)
  return lines
}

function wrapLine(runs: Run[], fonts: Record<Face, PDFFont>, size: number, maxWidth: number): Run[][] {
  const rows: Run[][] = [[]]
  let used = 0
  const push = (run: Run) => {
    rows.at(-1)?.push(run)
    used += fonts[run.face].widthOfTextAtSize(run.text, size)
  }
  for (const run of runs) {
    const words = run.text.split(/(\s+)/)
    for (const word of words) {
      if (!word) continue
      const w = fonts[run.face].widthOfTextAtSize(word, size)
      if (used > 0 && used + w > maxWidth && word.trim()) {
        rows.push([])
        used = 0
      }
      push({ ...run, text: word })
    }
  }
  return rows
}

function drawTextBox(page: PDFPage, mark: TextMark, _font: PDFFont, fonts: Record<Face, PDFFont>): void {
  const size = mark.fontSize || 14
  const width = mark.width > 0 ? mark.width : 180
  const leading = size * 1.35
  const blocks = linesOf(mark)
  const rows: { bullet: boolean; bulletColor: Color; runs: Run[] }[] = []
  for (const block of blocks) {
    const indent = block.bullet ? 14 : 0
    const wrapped = wrapLine(block.runs, fonts, size, Math.max(24, width - indent))
    if (wrapped.length === 0) rows.push({ bullet: block.bullet, bulletColor: block.bulletColor, runs: [] })
    wrapped.forEach((runs, i) => rows.push({ bullet: block.bullet && i === 0, bulletColor: block.bulletColor, runs }))
  }
  if (rows.length === 0) return
  const height = rows.length * leading + 4
  page.drawRectangle({
    x: mark.x,
    y: mark.y - height,
    width,
    height,
    color: rgb(1, 1, 1),
    opacity: 0.88,
    borderWidth: 0,
  })
  rows.forEach((row, i) => {
    let x = mark.x + 3
    const baseline = mark.y - size - i * leading
    if (row.bullet) {
      page.drawText('•', { x, y: baseline, size, font: fonts.regular, color: toRgb(row.bulletColor) })
      x += 12
    }
    for (const run of row.runs) {
      const font = fonts[run.face]
      const w = font.widthOfTextAtSize(run.text, size)
      if (run.bg) {
        page.drawRectangle({
          x,
          y: baseline - size * 0.2,
          width: w,
          height: size * 1.15,
          color: toRgb(run.bg),
          opacity: 0.85,
          borderWidth: 0,
        })
      }
      page.drawText(run.text, { x, y: baseline, size, font, color: toRgb(run.color) })
      const line = toRgb(run.color)
      if (run.underline) {
        page.drawLine({
          start: { x, y: baseline - size * 0.12 },
          end: { x: x + w, y: baseline - size * 0.12 },
          thickness: Math.max(0.6, size * 0.06),
          color: line,
        })
      }
      if (run.strike) {
        const y = baseline + size * 0.32
        page.drawLine({
          start: { x, y },
          end: { x: x + w, y },
          thickness: Math.max(0.6, size * 0.06),
          color: line,
        })
      }
      x += w
    }
  })
}
