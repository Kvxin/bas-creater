export type DanmuType = 'text' | 'button' | 'path'

// durationMs: 毫秒；颜色使用 0x 开头的十六进制数值；alpha/opacity 0~1
export interface DanmuBase {
  id: string
  type: DanmuType
  x: number | string
  y: number | string
  zIndex?: number
  durationMs?: number
  scale?: number
  rotateX?: number
  rotateY?: number
  rotateZ?: number
  opacity?: number
  anchorX?: number // 0~1
  anchorY?: number // 0~1
  parentId?: string | null
}

export interface TextDanmu extends DanmuBase {
  type: 'text'
  content: string
  fontSize?: number | string // 支持 5 或 '5%'
  fontFamily?: string
  bold?: number | boolean
  textShadow?: number
  color?: string // 0xRRGGBB
  strokeWidth?: number
  strokeColor?: number // 0xRRGGBB
  textColor?: number // 0xRRGGBB（可选，备用）
}

export interface ButtonDanmu extends DanmuBase {
  type: 'button'
  text: string
  fontSize?: number
  textColor?: number
  fillColor?: number
  fillAlpha?: number // 0~1
  target?:
  | { av: { av: number; page?: number; timeMs?: number } }
  | { bangumi: { seasonId: number; episodeId?: number; timeMs?: number } }
}

export interface PathDanmu extends DanmuBase {
  type: 'path'
  d: string
  viewBox?: string
  borderWidth?: number
  borderColor?: number
  borderAlpha?: number
  fillColor?: number
  fillAlpha?: number
  width?: number | string // 支持 20 或 '20%'
}

export type AnyDanmu = TextDanmu | ButtonDanmu | PathDanmu

