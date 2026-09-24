import { BlendMode, PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Color, Mark } from './types'

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

  for (const mark of marks) {
    const page = pages[mark.page - 1]
    if (!page) continue
    const color = toRgb(mark.color)

    if (mark.kind === 'text') {
      if (!mark.content.trim()) continue
      page.drawText(mark.content, {
        x: mark.x,
        y: mark.y,
        size: mark.fontSize,
        font,
        color,
      })
      continue
    }

    for (const q of mark.quads) {
      if (mark.kind === 'highlight') {
        page.drawRectangle({
          x: q.x,
          y: q.y,
          width: q.w,
          height: q.h,
          color,
          opacity: 0.38,
          borderWidth: 0,
          blendMode: BlendMode.Multiply,
        })
      } else if (mark.kind === 'underline') {
        page.drawLine({
          start: { x: q.x, y: q.y + 1 },
          end: { x: q.x + q.w, y: q.y + 1 },
          thickness: 1.25,
          color,
        })
      } else {
        page.drawLine({
          start: { x: q.x, y: q.y + q.h / 2 },
          end: { x: q.x + q.w, y: q.y + q.h / 2 },
          thickness: 1.25,
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
