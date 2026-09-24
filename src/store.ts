import type { Color, Session, Tool } from './types'
import { DEFAULT_COLOR } from './types'

const LS_KEY = 'pdfhighlight:doc'
const DB_NAME = 'pdfhighlight'
const STORE_NAME = 'files'

export function newId(): string {
  return crypto.randomUUID()
}

function emptySession(): Session {
  return {
    fileName: '',
    tool: 'highlight',
    color: { ...DEFAULT_COLOR },
    marks: [],
    docId: '',
    zoom: 100,
  }
}

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return emptySession()
    const parsed = JSON.parse(raw) as Session
    if (!parsed || typeof parsed !== 'object') return emptySession()
    return {
      fileName: parsed.fileName ?? '',
      tool: (parsed.tool as Tool) || 'highlight',
      color: parsed.color ?? { ...DEFAULT_COLOR },
      marks: Array.isArray(parsed.marks) ? parsed.marks : [],
      docId: parsed.docId ?? '',
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 100,
    }
  } catch {
    return emptySession()
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(LS_KEY, JSON.stringify(session))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function savePdfBytes(docId: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(bytes, docId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('IndexedDB save failed', err)
  }
}

export async function loadPdfBytes(docId: string): Promise<ArrayBuffer | null> {
  if (!docId) return null
  try {
    const db = await openDb()
    const bytes = await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(docId)
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return bytes
  } catch (err) {
    console.warn('IndexedDB load failed', err)
    return null
  }
}

export function colorsEqual(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

