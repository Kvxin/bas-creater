import type { AnyDanmu, ButtonDanmu, DanmuBase, DanmuType, PathDanmu, TextDanmu } from '@/types/danmu'

function genId(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}


function ms(v: number | string | undefined, fallback: number): number {
  if (v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function baseDefaults(type: DanmuType, ov: Partial<DanmuBase> = {}): DanmuBase {
  return {
    id: genId(10),
    type,
    x: (ov as any).x ?? 50,
    y: (ov as any).y ?? 50,
    zIndex: ov.zIndex ?? 1,
    durationMs: ms((ov as any).durationMs, 2000),
    scale: ov.scale ?? 1,
    rotateX: ov.rotateX ?? 0,
    rotateY: ov.rotateY ?? 0,
    rotateZ: ov.rotateZ ?? 0,
    opacity: ov.opacity ?? 1,
    anchorX: ov.anchorX ?? 0.5,
    anchorY: ov.anchorY ?? 0.5,
    parentId: ov.parentId,
  }
}

export function createTextDanmu(ov: Partial<TextDanmu> = {}): TextDanmu {
  const base = baseDefaults('text', ov)
  return {
    ...base,
    type: 'text',
    content: ov.content ?? '',
    fontSize: (ov as any).fontSize ?? 5,
    fontFamily: ov.fontFamily ?? '黑体',
    bold: ov.bold ?? 0,
    textShadow: ov.textShadow ?? 0,
    color: ov.color ?? 0x00a1d6,
    strokeWidth: ov.strokeWidth ?? 1,
    strokeColor: ov.strokeColor ?? 0xffffff,
    textColor: ov.textColor,
  }
}

export function createButtonDanmu(ov: Partial<ButtonDanmu> = {}): ButtonDanmu {
  const base = baseDefaults('button', ov)
  return {
    ...base,
    type: 'button',
    text: ov.text ?? '',
    fontSize: (ov as any).fontSize ?? 5,
    textColor: ov.textColor ?? 0xffffff,
    fillColor: ov.fillColor ?? 0xFF9100,
    fillAlpha: ov.fillAlpha ?? 0.8,
    target: ov.target,
  }
}

export function createPathDanmu(ov: Partial<PathDanmu> = {}): PathDanmu {
  const base = baseDefaults('path', ov)
  return {
    ...base,
    type: 'path',
    d: ov.d ?? '',
    viewBox: ov.viewBox ?? undefined,
    borderWidth: ov.borderWidth ?? 1,
    borderColor: ov.borderColor ?? 0xffffff,
    borderAlpha: ov.borderAlpha ?? 0.8,
    fillColor: ov.fillColor ?? 0x00a1d6,
    fillAlpha: ov.fillAlpha ?? 0.8,
    width: (ov as any).width ?? 20,
  }
}

export function createDanmuByKey(key: string): AnyDanmu {
  switch (key) {
    case 'text':
      return createTextDanmu({ content: 'bilibili', zIndex: 3, durationMs: 5000 })
    case 'path':
      return createPathDanmu({ zIndex: 1, durationMs: 2000, scale: 0.8 })
    case 'button':
      return createButtonDanmu({ text: '按钮弹幕', zIndex: 1, durationMs: 2000, scale: 1 })
    default:
      return createTextDanmu({})
  }
}

