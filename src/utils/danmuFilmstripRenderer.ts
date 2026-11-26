import type { AnyDanmu, ButtonDanmu, PathDanmu, TextDanmu } from "@/types/danmu";
import { BAS_DEFAULT_TEXT } from "@/core/danmuDefaults";
import type { FilmstripDanmuItem, FilmstripLayout } from "@/core/filmstrip";

const FILMSTRIP_FRAME_BG = "#0b0b0f";
const FILMSTRIP_FRAME_DIVIDER = "rgba(255, 255, 255, 0.14)";
const FILMSTRIP_TOP_SHADOW = "rgba(0, 0, 0, 0.35)";
const PATH_CACHE_LIMIT = 128;

const path2dCache = new Map<string, Path2D | null>();

const getCachedPath2D = (d: string): Path2D | null => {
  if (path2dCache.has(d)) return path2dCache.get(d) ?? null;
  let path: Path2D | null = null;
  try {
    path = new Path2D(d);
  } catch {
    path = null;
  }
  if (path2dCache.size >= PATH_CACHE_LIMIT) {
    const oldestKey = path2dCache.keys().next().value;
    if (oldestKey !== undefined) path2dCache.delete(oldestKey);
  }
  path2dCache.set(d, path);
  return path;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseColorInt = (value: number | string | undefined, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value & 0xffffff;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const hexMatch = trimmed.match(/^(?:#|0x)([\da-f]{3}|[\da-f]{6})$/i)?.[1];
    if (hexMatch) {
      const expanded =
        hexMatch.length === 3
          ? hexMatch
              .split("")
              .map(char => char + char)
              .join("")
          : hexMatch;
      return Number.parseInt(expanded, 16) & 0xffffff;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric & 0xffffff;
  }
  return fallback & 0xffffff;
};

const toRgba = (color: number | string | undefined, fallbackColor: number, alpha = 1): string => {
  const rgb = parseColorInt(color, fallbackColor);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const safeAlpha = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
};

const resolveLength = (value: number | string | undefined, referenceSize: number, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.endsWith("%")) {
      const percent = Number.parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(percent) ? (percent / 100) * referenceSize : fallback;
    }
    const parsed = Number.parseFloat(trimmed.replace(/px$/i, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const buildTextFont = (fontSize: number, bold: boolean, fontFamily: string): string => {
  const families = fontFamily
    .split(",")
    .map(part => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .map(part => `"${part.replace(/"/g, "")}"`)
    .join(", ");
  return `${bold ? "bold " : ""}${fontSize}px ${families ? `${families}, ` : ""}sans-serif`;
};

const measureMultilineText = (
  ctx: CanvasRenderingContext2D,
  lines: string[],
  fontSize: number
): { width: number; height: number } => {
  let maxWidth = 0;
  for (const line of lines) {
    const width = ctx.measureText(line).width;
    if (width > maxWidth) maxWidth = width;
  }
  return {
    width: maxWidth,
    height: Math.max(1, lines.length) * fontSize
  };
};

const applyRotation = (ctx: CanvasRenderingContext2D, danmu: AnyDanmu) => {
  const rotateZ = typeof danmu.rotateZ === "number" && Number.isFinite(danmu.rotateZ) ? danmu.rotateZ : 0;
  const rotateX = typeof danmu.rotateX === "number" && Number.isFinite(danmu.rotateX) ? danmu.rotateX : 0;
  const rotateY = typeof danmu.rotateY === "number" && Number.isFinite(danmu.rotateY) ? danmu.rotateY : 0;

  if (rotateZ !== 0) ctx.rotate((rotateZ * Math.PI) / 180);
  if (rotateX !== 0 || rotateY !== 0) {
    const scaleX = rotateY !== 0 ? Math.cos((rotateY * Math.PI) / 180) : 1;
    const scaleY = rotateX !== 0 ? Math.cos((rotateX * Math.PI) / 180) : 1;
    ctx.scale(scaleX, scaleY);
  }
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

const drawTextDanmu = (
  ctx: CanvasRenderingContext2D,
  danmu: TextDanmu,
  refW: number,
  refH: number,
  canvasWidth: number
) => {
  const xPx = resolveLength(danmu.x, refW, 0);
  const yPx = resolveLength(danmu.y, refH, 0);
  const scale = typeof danmu.scale === "number" && Number.isFinite(danmu.scale) ? danmu.scale : 1;
  const fontSize = Math.max(1, resolveLength(danmu.fontSize, canvasWidth, 25));
  const bold = danmu.bold === undefined ? true : Boolean(danmu.bold);
  const fontFamily = danmu.fontFamily || "SimHei";
  const content = danmu.content ?? BAS_DEFAULT_TEXT;
  const lines = content.split("\n");

  ctx.translate(xPx, yPx);
  applyRotation(ctx, danmu);
  ctx.scale(scale, scale);

  ctx.font = buildTextFont(fontSize, bold, fontFamily);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const { width, height } = measureMultilineText(ctx, lines, fontSize);
  const anchorX = typeof danmu.anchorX === "number" && Number.isFinite(danmu.anchorX) ? danmu.anchorX : 0;
  const anchorY = typeof danmu.anchorY === "number" && Number.isFinite(danmu.anchorY) ? danmu.anchorY : 0;
  if (anchorX !== 0 || anchorY !== 0) {
    ctx.translate(-anchorX * width, -anchorY * height);
  }

  const hasShadow = danmu.textShadow === undefined ? true : Boolean(danmu.textShadow);
  if (hasShadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = Math.max(1.5, fontSize * 0.08);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.fillStyle = toRgba(danmu.color, 0xffffff, 1);
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i]!, 0, i * fontSize);
  }

  const strokeWidth = typeof danmu.strokeWidth === "number" && Number.isFinite(danmu.strokeWidth) ? danmu.strokeWidth : 0;
  if (strokeWidth > 0) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.strokeStyle = toRgba(danmu.strokeColor, 0xffffff, 1);
    ctx.lineWidth = strokeWidth;
    for (let i = 0; i < lines.length; i += 1) {
      ctx.strokeText(lines[i]!, 0, i * fontSize);
    }
  }
};

const drawButtonDanmu = (
  ctx: CanvasRenderingContext2D,
  danmu: ButtonDanmu,
  refW: number,
  refH: number,
  canvasWidth: number
) => {
  const xPx = resolveLength(danmu.x, refW, 0);
  const yPx = resolveLength(danmu.y, refH, 0);
  const scale = typeof danmu.scale === "number" && Number.isFinite(danmu.scale) ? danmu.scale : 1;
  const fontSize = Math.max(1, resolveLength(danmu.fontSize, canvasWidth, 25));
  const text = danmu.text ?? BAS_DEFAULT_TEXT;
  const lines = text.split("\n");

  ctx.translate(xPx, yPx);
  ctx.scale(scale, scale);

  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const { width, height } = measureMultilineText(ctx, lines, fontSize);
  const padX = 20;
  const padY = 10;
  const boxW = width + padX * 2;
  const boxH = height + padY * 2;

  const fillAlpha = typeof danmu.fillAlpha === "number" && Number.isFinite(danmu.fillAlpha) ? danmu.fillAlpha : 1;
  if (fillAlpha > 0) {
    ctx.fillStyle = toRgba(danmu.fillColor, 0xffffff, fillAlpha);
    drawRoundedRect(ctx, 0, 0, boxW, boxH, 3);
    ctx.fill();
  }

  const textAlpha = typeof danmu.textAlpha === "number" && Number.isFinite(danmu.textAlpha) ? danmu.textAlpha : 1;
  if (textAlpha > 0) {
    ctx.fillStyle = toRgba(danmu.textColor, 0x000000, textAlpha);
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i]!, padX, padY + i * fontSize);
    }
  }
};

const parseViewBox = (viewBox: string | undefined): [number, number, number, number] | null => {
  if (!viewBox) return null;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null;
  const [minX, minY, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return [minX, minY, width, height];
};

const drawPathDanmu = (
  ctx: CanvasRenderingContext2D,
  danmu: PathDanmu,
  refW: number,
  refH: number,
  canvasWidth: number,
  canvasHeight: number
) => {
  if (!danmu.d) return;
  const path = getCachedPath2D(danmu.d);
  if (!path) return;

  const xPx = resolveLength(danmu.x, refW, 0);
  const yPx = resolveLength(danmu.y, refH, 0);
  const scale = typeof danmu.scale === "number" && Number.isFinite(danmu.scale) ? danmu.scale : 1;

  ctx.translate(xPx, yPx);

  const viewBox = parseViewBox(danmu.viewBox);
  if (viewBox) {
    const [minX, minY, vbW, vbH] = viewBox;
    const width = danmu.width !== undefined ? resolveLength(danmu.width, canvasWidth, 0) : 0;
    const height = danmu.height !== undefined ? resolveLength(danmu.height, canvasHeight, 0) : 0;
    let targetW = vbW * scale;
    let targetH = vbH * scale;
    if (width > 0 && height > 0) {
      targetW = width * scale;
      targetH = height * scale;
    } else if (width > 0) {
      targetW = width * scale;
      targetH = targetW * (vbH / vbW);
    } else if (height > 0) {
      targetH = height * scale;
      targetW = targetH * (vbW / vbH);
    }
    ctx.scale(targetW / vbW, targetH / vbH);
    ctx.translate(-minX, -minY);
  } else if (scale !== 1) {
    ctx.scale(scale, scale);
  }

  const fillAlpha = typeof danmu.fillAlpha === "number" && Number.isFinite(danmu.fillAlpha) ? danmu.fillAlpha : 1;
  if (fillAlpha > 0) {
    ctx.fillStyle = toRgba(danmu.fillColor, 0xffffff, fillAlpha);
    ctx.fill(path);
  }

  const borderWidth = typeof danmu.borderWidth === "number" && Number.isFinite(danmu.borderWidth) ? danmu.borderWidth : 0;
  const borderAlpha =
    typeof danmu.borderAlpha === "number" && Number.isFinite(danmu.borderAlpha) ? danmu.borderAlpha : 1;
  if (borderWidth > 0 && borderAlpha > 0) {
    ctx.strokeStyle = toRgba(danmu.borderColor, 0x000000, borderAlpha);
    ctx.lineWidth = borderWidth;
    ctx.stroke(path);
  }
};

const applyParentTransforms = (
  ctx: CanvasRenderingContext2D,
  parentChain: AnyDanmu[],
  canvasWidth: number,
  canvasHeight: number
): { refW: number; refH: number } => {
  let refW = canvasWidth;
  let refH = canvasHeight;

  for (const parent of parentChain) {
    const xPx = resolveLength(parent.x, refW, 0);
    const yPx = resolveLength(parent.y, refH, 0);
    const scale = typeof parent.scale === "number" && Number.isFinite(parent.scale) ? parent.scale : 1;
    const opacity = typeof parent.opacity === "number" && Number.isFinite(parent.opacity) ? clamp(parent.opacity, 0, 1) : 1;

    ctx.globalAlpha *= opacity;
    ctx.translate(xPx, yPx);
    applyRotation(ctx, parent);
    ctx.scale(scale, scale);

    if (parent.type === "text") {
      const fontSize = Math.max(1, resolveLength(parent.fontSize, canvasWidth, 25));
      const bold = parent.bold === undefined ? true : Boolean(parent.bold);
      ctx.font = buildTextFont(fontSize, bold, parent.fontFamily || "SimHei");
      const lines = (parent.content ?? BAS_DEFAULT_TEXT).split("\n");
      const measured = measureMultilineText(ctx, lines, fontSize);
      const anchorX = typeof parent.anchorX === "number" && Number.isFinite(parent.anchorX) ? parent.anchorX : 0;
      const anchorY = typeof parent.anchorY === "number" && Number.isFinite(parent.anchorY) ? parent.anchorY : 0;
      if (anchorX !== 0 || anchorY !== 0) {
        ctx.translate(-anchorX * measured.width, -anchorY * measured.height);
      }
      if (measured.width > 0 && measured.height > 0) {
        refW = measured.width;
        refH = measured.height;
      }
    }
  }

  return { refW, refH };
};

const drawDanmuItem = (
  ctx: CanvasRenderingContext2D,
  item: FilmstripDanmuItem,
  canvasWidth: number,
  canvasHeight: number
) => {
  ctx.save();
  try {
    const { refW, refH } = applyParentTransforms(ctx, item.parentChain, canvasWidth, canvasHeight);
    const danmu = item.danmu;
    const opacity =
      typeof danmu.opacity === "number" && Number.isFinite(danmu.opacity) ? clamp(danmu.opacity, 0, 1) : 1;
    ctx.globalAlpha *= opacity;
    if (ctx.globalAlpha <= 0.001) return;

    if (danmu.type === "text") {
      drawTextDanmu(ctx, danmu, refW, refH, canvasWidth);
    } else if (danmu.type === "button") {
      drawButtonDanmu(ctx, danmu, refW, refH, canvasWidth);
    } else {
      drawPathDanmu(ctx, danmu, refW, refH, canvasWidth, canvasHeight);
    }
  } finally {
    ctx.restore();
  }
};

/**
 * 将给定布局的可见胶片瓦片绘制到 Canvas 上（自动处理 HiDPI 缩放与瓦片边界裁剪）。
 */
export const renderFilmstripCanvas = (params: {
  canvas: HTMLCanvasElement;
  layout: FilmstripLayout;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  sampleFrame: (localTimeMs: number) => FilmstripDanmuItem[];
}) => {
  const { canvas, layout, canvasWidth, canvasHeight, dpr, sampleFrame } = params;
  const { visibleLeft, visibleWidth, frameWidth, frameHeight, tiles } = layout;

  if (visibleWidth <= 0 || frameWidth <= 0 || frameHeight <= 0 || !tiles.length) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    return;
  }

  const safeDpr = Math.max(1, Number.isFinite(dpr) ? dpr : 1);
  const backingWidth = Math.max(1, Math.ceil(visibleWidth * safeDpr));
  const backingHeight = Math.max(1, Math.round(frameHeight * safeDpr));

  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  canvas.style.width = `${visibleWidth}px`;
  canvas.style.height = `${frameHeight}px`;
  canvas.style.left = `${visibleLeft}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(safeDpr, 0, 0, safeDpr, 0, 0);
  ctx.fillStyle = FILMSTRIP_FRAME_BG;
  ctx.fillRect(0, 0, visibleWidth, frameHeight);

  const stageW = Math.max(1, canvasWidth);
  const stageH = Math.max(1, canvasHeight);
  const scaleX = frameWidth / stageW;
  const scaleY = frameHeight / stageH;

  for (const tile of tiles) {
    const drawX = tile.x - visibleLeft;
    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, frameWidth, frameHeight);
    ctx.clip();

    ctx.save();
    ctx.translate(drawX, 0);
    ctx.scale(scaleX, scaleY);
    const items = sampleFrame(tile.localTimeMs);
    for (const item of items) {
      drawDanmuItem(ctx, item, stageW, stageH);
    }
    ctx.restore();

    // 在相邻帧之间绘制 1px 胶片分隔线，避免末帧右侧与片段边框叠加。
    if (tile.x + frameWidth < layout.clipWidthPx) {
      const dividerX = drawX + frameWidth - 1;
      if (dividerX >= 0 && dividerX < visibleWidth) {
        ctx.fillStyle = FILMSTRIP_FRAME_DIVIDER;
        ctx.fillRect(dividerX, 0, 1, frameHeight);
      }
    }
    ctx.restore();
  }

  // 胶片条顶部微弱投影，增强标题栏与缩略图区域的层次感。
  ctx.fillStyle = FILMSTRIP_TOP_SHADOW;
  ctx.fillRect(0, 0, visibleWidth, 1);
};
