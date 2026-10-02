import type { Color, DocTab, Session, Tool } from './types'
import { DEFAULT_COLOR } from './types'

const LS_KEY = 'pdfhighlight:doc'
const DB_NAME = 'pdfhighlight'
const STORE_NAME = 'files'
const IMAGE_STORE = 'images'

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
    tabs: [],
    activeTabId: '',
    zoom: 100,
    bookmarkedPages: [],
    showBookmarkedOnly: false,
    singlePage: false,
    sidebar: 'thumbs',
    sidebarHidden: false,
  }
}

function normalizeBookmarks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const pages = new Set<number>()
  for (const value of raw) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) pages.add(value)
  }
  return [...pages].sort((a, b) => a - b)
}

function tabTitle(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim()
  return base || 'Document'
}

function normalizeTab(raw: unknown): DocTab | null {
  if (!raw || typeof raw !== 'object') return null
  const tab = raw as Partial<DocTab>
  if (typeof tab.id !== 'string' || !tab.id) return null
  if (typeof tab.docId !== 'string' || !tab.docId) return null
  const fileName = typeof tab.fileName === 'string' ? tab.fileName : ''
  const name = typeof tab.name === 'string' && tab.name.trim() ? tab.name.trim() : tabTitle(fileName)
  return {
    id: tab.id,
    name,
    docId: tab.docId,
    fileName,
    marks: Array.isArray(tab.marks) ? tab.marks : [],
    bookmarkedPages: normalizeBookmarks(tab.bookmarkedPages),
    showBookmarkedOnly: tab.showBookmarkedOnly === true,
  }
}

function withActiveTab(session: Session): Session {
  const active = session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0]
  if (!active) {
    session.activeTabId = ''
    return session
  }
  session.activeTabId = active.id
  session.docId = active.docId
  session.fileName = active.fileName
  session.marks = active.marks
  session.bookmarkedPages = active.bookmarkedPages
  session.showBookmarkedOnly = active.showBookmarkedOnly
  return session
}

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return emptySession()
    const parsed = JSON.parse(raw) as Session
    if (!parsed || typeof parsed !== 'object') return emptySession()
    const session: Session = {
      fileName: parsed.fileName ?? '',
      tool: (parsed.tool as Tool) || 'highlight',
      color: parsed.color ?? { ...DEFAULT_COLOR },
      marks: Array.isArray(parsed.marks) ? parsed.marks : [],
      docId: parsed.docId ?? '',
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs.map(normalizeTab).filter((tab): tab is DocTab => Boolean(tab)) : [],
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : '',
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 100,
      textWidth: typeof parsed.textWidth === 'number' && parsed.textWidth > 0 ? parsed.textWidth : undefined,
      textFontSize: typeof parsed.textFontSize === 'number' && parsed.textFontSize > 0 ? parsed.textFontSize : undefined,
      markerWidth: typeof parsed.markerWidth === 'number' && parsed.markerWidth > 0 ? parsed.markerWidth : undefined,
      bookmarkedPages: normalizeBookmarks(parsed.bookmarkedPages),
      showBookmarkedOnly: parsed.showBookmarkedOnly === true,
      singlePage: parsed.singlePage === true,
      sidebar: parsed.sidebar === 'outline' ? 'outline' : 'thumbs',
      sidebarHidden: parsed.sidebarHidden === true,
    }
    if (!session.tabs.length && session.docId) {
      const id = newId()
      session.tabs = [
        {
          id,
          name: tabTitle(session.fileName),
          docId: session.docId,
          fileName: session.fileName,
          marks: session.marks,
          bookmarkedPages: session.bookmarkedPages,
          showBookmarkedOnly: session.showBookmarkedOnly,
        },
      ]
      session.activeTabId = id
    }
    return withActiveTab(session)
  } catch {
    return emptySession()
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(LS_KEY, JSON.stringify(session))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE)
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

export async function saveImageBlob(imageId: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, 'readwrite')
      tx.objectStore(IMAGE_STORE).put(blob, imageId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('IndexedDB image save failed', err)
  }
}

export async function loadImageBlob(imageId: string): Promise<Blob | null> {
  if (!imageId) return null
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, 'readonly')
      const req = tx.objectStore(IMAGE_STORE).get(imageId)
      req.onsuccess = () => resolve((req.result as Blob) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return blob
  } catch (err) {
    console.warn('IndexedDB image load failed', err)
    return null
  }
}

export async function deletePdfBytes(docId: string): Promise<void> {
  if (!docId) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(docId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('IndexedDB pdf delete failed', err)
  }
}

export async function deleteImageBlobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, 'readwrite')
      const store = tx.objectStore(IMAGE_STORE)
      for (const id of ids) store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.warn('IndexedDB image delete failed', err)
  }
}

export function colorsEqual(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

