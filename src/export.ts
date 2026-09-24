import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import type { Color, Mark, Quad } from './types'

function rgb01(color: Color): [number, number, number] {
  return [color.r / 255, color.g / 255, color.b / 255]
}

function quadPoints(quads: Quad[]): number[] {
  const pts: number[] = []
  for (const q of quads) {
    pts.push(q.x, q.y, q.x + q.w, q.y, q.x + q.w, q.y + q.h, q.x, q.y + q.h)
  }
  return pts
}

function bounds(quads: Quad[]): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const q of quads) {
    minX = Math.min(minX, q.x)
    minY = Math.min(minY, q.y)
    maxX = Math.max(maxX, q.x + q.w)
    maxY = Math.max(maxY, q.y + q.h)
  }
  return [minX, minY, maxX, maxY]
}

function subtype(kind: Mark['kind']): string {
  if (kind === 'highlight') return 'Highlight'
  if (kind === 'underline') return 'Underline'
  if (kind === 'strikethrough') return 'StrikeOut'
  return 'FreeText'
}

export async function downloadAnnotatedPdf(
  bytes: ArrayBuffer,
  fileName: string,
  marks: Mark[],
): Promise<void> {
  const pdf = await PDFDocument.load(bytes.slice(0))
  const pages = pdf.getPages()
  const context = pdf.context

  for (const mark of marks) {
    const page = pages[mark.page - 1]
    if (!page) continue

    if (mark.kind === 'text') {
      const width = Math.max(48, mark.content.length * mark.fontSize * 0.52)
      const height = mark.fontSize * 1.4
      const [r, g, b] = rgb01(mark.color)
      const dict = context.obj({
        Type: 'Annot',
        Subtype: 'FreeText',
        Rect: [mark.x, mark.y, mark.x + width, mark.y + height],
        Contents: PDFString.of(mark.content),
        DA: PDFString.of(`${r} ${g} ${b} rg /Helv ${mark.fontSize} Tf`),
        C: [1, 1, 1],
        Border: [0, 0, 0],
        F: 4,
      })
      page.node.addAnnot(context.register(dict))
      continue
    }

    const rect = bounds(mark.quads)
    const dict = context.obj({
      Type: 'Annot',
      Subtype: PDFName.of(subtype(mark.kind)),
      Rect: rect,
      QuadPoints: quadPoints(mark.quads),
      C: rgb01(mark.color),
      CA: mark.kind === 'highlight' ? 0.45 : 1,
      Contents: PDFString.of(mark.text),
      F: 4,
    })
    page.node.addAnnot(context.register(dict))
  }

  const out = await pdf.save()
  const blob = new Blob([Uint8Array.from(out)], { type: 'application/pdf' })
  const a = document.createElement('a')
  const base = fileName.replace(/\.pdf$/i, '')
  a.href = URL.createObjectURL(blob)
  a.download = `${base}-highlighted.pdf`
  a.click()
  URL.revokeObjectURL(a.href)
}
