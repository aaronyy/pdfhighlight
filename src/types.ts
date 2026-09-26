export type Tool = 'highlight' | 'underline' | 'strikethrough' | 'text' | 'marker'

export type Color = { r: number; g: number; b: number }

export type Quad = { x: number; y: number; w: number; h: number }

export type Point = { x: number; y: number }

export type QuadMark = {
  id: string
  kind: 'highlight' | 'underline' | 'strikethrough'
  page: number
  color: Color
  quads: Quad[]
  text: string
}

export type MarkerMark = {
  id: string
  kind: 'marker'
  page: number
  color: Color
  width: number
  points: Point[]
}

export type TextMark = {
  id: string
  kind: 'text'
  page: number
  color: Color
  x: number
  y: number
  /** Box width in PDF points. Font size scales with this when the corner is dragged. */
  width: number
  fontSize: number
  content: string
  /** Sanitized rich text. Missing on older notes; plain `content` is used instead. */
  html?: string
}

export type ImageMark = {
  id: string
  kind: 'image'
  page: number
  /** Bottom-left of the unrotated box, PDF points. */
  x: number
  y: number
  w: number
  h: number
  /** Clockwise degrees around the box center (CSS rotate). */
  rotation: number
  imageId: string
}

export type Mark = QuadMark | TextMark | MarkerMark | ImageMark

export type Session = {
  fileName: string
  tool: Tool
  color: Color
  marks: Mark[]
  docId: string
  zoom: number
  /** Last text-box width in PDF points. The next note starts at this size. */
  textWidth?: number
  /** Last text-box font size in PDF points. Scales with `textWidth`. */
  textFontSize?: number
  /** Last marker nib size in PDF points. */
  markerWidth?: number
}

export const MARKER_WIDTHS = [4, 8, 14, 24, 36, 52] as const
export const DEFAULT_MARKER_WIDTH = 24

/** Highlighter colors, in the same order as Google Docs’ highlight menu. */
export const PRESET_COLORS: { name: string; color: Color }[] = [
  { name: 'Yellow', color: { r: 255, g: 244, b: 117 } },
  { name: 'Green', color: { r: 204, g: 255, b: 144 } },
  { name: 'Blue', color: { r: 174, g: 203, b: 250 } },
  { name: 'Pink', color: { r: 253, g: 207, b: 232 } },
  { name: 'Purple', color: { r: 215, g: 174, b: 251 } },
]

export const DEFAULT_COLOR = PRESET_COLORS[0].color
