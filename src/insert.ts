import { PDFDocument, type PDFImage } from 'pdf-lib'

const MAX_RASTER = 4096

export async function rasterPngBytes(blob: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, MAX_RASTER / bitmap.width, MAX_RASTER / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('no canvas')
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error('encode failed'))), 'image/png')
  })
  return new Uint8Array(await png.arrayBuffer())
}

export async function embedRaster(pdf: PDFDocument, blob: Blob): Promise<PDFImage> {
  const type = blob.type.toLowerCase()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (type === 'image/jpeg' || type === 'image/jpg') {
    try {
      return await pdf.embedJpg(bytes)
    } catch {
      /* EXIF or progressive JPEG — flatten */
    }
  }
  if (type === 'image/png') {
    try {
      return await pdf.embedPng(bytes)
    } catch {
      /* flatten */
    }
  }
  return pdf.embedPng(await rasterPngBytes(blob))
}

export async function insertBlankPage(bytes: ArrayBuffer, afterPage: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true })
  const pages = pdf.getPages()
  const ref = pages[Math.max(0, Math.min(afterPage, pages.length) - 1)] ?? pages[0]
  const { width, height } = ref.getSize()
  const index = Math.max(0, Math.min(afterPage, pages.length))
  pdf.insertPage(index, [width, height])
  return pdf.save()
}

export async function insertPagesFromFile(
  bytes: ArrayBuffer,
  afterPage: number,
  file: File,
): Promise<{ bytes: Uint8Array; added: number }> {
  const pdf = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true })
  const pageCount = pdf.getPageCount()
  const index = Math.max(0, Math.min(afterPage, pageCount))
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  if (isPdf) {
    const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
    const copied = await pdf.copyPages(src, src.getPageIndices())
    copied.forEach((page, i) => pdf.insertPage(index + i, page))
    return { bytes: await pdf.save(), added: copied.length }
  }

  const image = await embedRaster(pdf, file)
  const ref = pdf.getPage(Math.max(0, index - 1))
  const { width, height } = ref.getSize()
  const page = pdf.insertPage(index, [width, height])
  const scale = Math.min(width / image.width, height / image.height)
  const w = image.width * scale
  const h = image.height * scale
  page.drawImage(image, {
    x: (width - w) / 2,
    y: (height - h) / 2,
    width: w,
    height: h,
  })
  return { bytes: await pdf.save(), added: 1 }
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name)
}
