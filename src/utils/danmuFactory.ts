import type {
  AnyDanmu,
  ButtonDanmu,
  DanmuBase,
  DanmuType,
  PathDanmu,
  TextDanmu,
} from "@/types/danmu";

function genId(len = 10) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function ms(v: number | string | undefined, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function baseDefaults(type: DanmuType, ov: Partial<DanmuBase> = {}): DanmuBase {
  // 仅保留 id 和 type，其他属性如果 ov 中有则保留，没有则 undefined
  return {
    id: genId(10),
    type,
    name: ov.name,
    x: (ov as any).x,
    y: (ov as any).y,
    zIndex: ov.zIndex,
    durationMs: ms((ov as any).durationMs, 2000), // duration 还是给一个默认值比较好，或者也留空？BAS需要duration。保留默认值吧。
    scale: ov.scale,
    rotateX: ov.rotateX,
    rotateY: ov.rotateY,
    rotateZ: ov.rotateZ,
    opacity: ov.opacity,
    anchorX: ov.anchorX,
    anchorY: ov.anchorY,
    parentId: ov.parentId,
  };
}

export function createTextDanmu(ov: Partial<TextDanmu> = {}): TextDanmu {
  const base = baseDefaults("text", ov);
  return {
    ...base,
    type: "text",
    content: ov.content, // 不再默认为 ""
    fontSize: (ov as any).fontSize,
    fontFamily: ov.fontFamily,
    bold: ov.bold,
    textShadow: ov.textShadow,
    color: ov.color,
    strokeWidth: ov.strokeWidth,
    strokeColor: ov.strokeColor,
    textColor: ov.textColor,
  };
}

export function createButtonDanmu(ov: Partial<ButtonDanmu> = {}): ButtonDanmu {
  const base = baseDefaults("button", ov);
  return {
    ...base,
    type: "button",
    text: ov.text,
    fontSize: (ov as any).fontSize,
    textColor: ov.textColor,
    fillColor: ov.fillColor,
    fillAlpha: ov.fillAlpha,
    target: ov.target,
  };
}

export function createPathDanmu(ov: Partial<PathDanmu> = {}): PathDanmu {
  const base = baseDefaults("path", ov);
  return {
    ...base,
    type: "path",
    d: ov.d,
    viewBox: ov.viewBox,
    borderWidth: ov.borderWidth,
    borderColor: ov.borderColor,
    borderAlpha: ov.borderAlpha,
    fillColor: ov.fillColor,
    fillAlpha: ov.fillAlpha,
    width: (ov as any).width,
  };
}

export function createDanmuByKey(key: string, payload: Partial<AnyDanmu> = {}): AnyDanmu {
  switch (key) {
    case "text":
      return createTextDanmu({
        durationMs: 5000,
        ...(payload as Partial<TextDanmu>),
      });
    case "path":
      return createPathDanmu({
        durationMs: 2000,
        ...(payload as Partial<PathDanmu>),
      });
    case "button":
      return createButtonDanmu({
        durationMs: 2000,
        ...(payload as Partial<ButtonDanmu>),
      });
    default:
      return createTextDanmu({});
  }
}

/**
 * 将 AnyDanmu 对象转换为 BAS DSL 文本
 */
export function danmuToDSL(danmu: AnyDanmu): string {
  const name = danmu.id.replace(/[^a-zA-Z0-9_]/g, "_");
  const durationSec = (danmu.durationMs ?? 2000) / 1000;

  // 格式化百分比或数值
  const fmt = (v: number | string | undefined, suffix = "%"): string => {
    if (v === undefined) return "0";
    if (typeof v === "string") return v;
    return `${v}${suffix}`;
  };

  // 格式化颜色 (0xRRGGBB -> 0xRRGGBB)
  const fmtColor = (c: number | string | undefined): string => {
    if (c === undefined) return "0xffffff";
    if (typeof c === "string") return c;
    return `0x${c.toString(16).padStart(6, "0")}`;
  };

  let defBlock = "";
  let setBlock = "";

  if (danmu.type === "text") {
    const d = danmu as TextDanmu;
    defBlock = `def text ${name} {
    content = "${(d.content ?? "").replace(/"/g, '\\"')}"
    fontSize = ${fmt(d.fontSize)}
    x = ${fmt(d.x)}
    y = ${fmt(d.y)}
    anchorX = ${d.anchorX ?? 0.5}
    anchorY = ${d.anchorY ?? 0.5}
    color = ${fmtColor(d.color as any)}
    alpha = ${d.opacity ?? 1}
    zIndex = ${d.zIndex ?? 1}
    scale = ${d.scale ?? 1}
    rotateX = ${d.rotateX ?? 0}
    rotateY = ${d.rotateY ?? 0}
    rotateZ = ${d.rotateZ ?? 0}
    bold = ${d.bold ? 1 : 0}
    textShadow = ${d.textShadow ?? 0}
    fontFamily = "${d.fontFamily ?? "黑体"}"
}`;
    setBlock = `set ${name} {} ${durationSec}s`;
  } else if (danmu.type === "button") {
    const d = danmu as ButtonDanmu;
    defBlock = `def button ${name} {
    text = "${(d.text ?? "").replace(/"/g, '\\"')}"
    fontSize = ${fmt(d.fontSize)}
    x = ${fmt(d.x)}
    y = ${fmt(d.y)}
    scale = ${d.scale ?? 1}
    textColor = ${fmtColor(d.textColor)}
    fillColor = ${fmtColor(d.fillColor)}
    fillAlpha = ${d.fillAlpha ?? 0.8}
    zIndex = ${d.zIndex ?? 1}
}`;
    setBlock = `set ${name} {} ${durationSec}s`;
  } else if (danmu.type === "path") {
    const d = danmu as PathDanmu;
    defBlock = `def path ${name} {
    d = "${(d.d ?? "").replace(/"/g, '\\"')}"
    ${d.viewBox ? `viewBox = "${d.viewBox}"` : ""}
    x = ${fmt(d.x)}
    y = ${fmt(d.y)}
    scale = ${d.scale ?? 1}
    fillColor = ${fmtColor(d.fillColor)}
    fillAlpha = ${d.fillAlpha ?? 0.8}
    borderColor = ${fmtColor(d.borderColor)}
    borderAlpha = ${d.borderAlpha ?? 0.8}
    borderWidth = ${d.borderWidth ?? 1}
    zIndex = ${d.zIndex ?? 1}
}`;
    setBlock = `set ${name} {} ${durationSec}s`;
  }

  return `${defBlock}\n${setBlock}`;
}
