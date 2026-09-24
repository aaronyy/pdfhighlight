export type Tool = 'highlight' | 'underline' | 'strikethrough' | 'text'

export type Color = { r: number; g: number; b: number }

export type Quad = { x: number; y: number; w: number; h: number }

export type QuadMark = {
  id: string
  kind: 'highlight' | 'underline' | 'strikethrough'
  page: number
  color: Color
  quads: Quad[]
  text: string
}

export type TextMark = {
  id: string
  kind: 'text'
  page: number
  color: Color
  x: number
  y: number
  fontSize: number
  content: string
}

export type Mark = QuadMark | TextMark

export type Session = {
  fileName: string
  tool: Tool
  color: Color
  marks: Mark[]
  docId: string
}

export const PRESET_COLORS: { name: string; color: Color }[] = [
  { name: 'Yellow', color: { r: 255, g: 214, b: 10 } },
  { name: 'Green', color: { r: 52, g: 199, b: 89 } },
  { name: 'Blue', color: { r: 50, g: 173, b: 230 } },
  { name: 'Pink', color: { r: 255, g: 55, b: 95 } },
  { name: 'Purple', color: { r: 175, g: 82, b: 222 } },
]

export const DEFAULT_COLOR = PRESET_COLORS[0].color
