import type {
  AnyDanmu,
  AudioDanmu,
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
  return {
    id: genId(10),
    type,
    name: ov.name, // 用户自定义名称，可选
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
  };
}

export function createTextDanmu(ov: Partial<TextDanmu> = {}): TextDanmu {
  const base = baseDefaults("text", ov);
  return {
    ...base,
    type: "text",
    content: ov.content ?? "",
    fontSize: (ov as any).fontSize ?? 5,
    fontFamily: ov.fontFamily ?? "黑体",
    bold: ov.bold ?? 0,
    textShadow: ov.textShadow ?? 0,
    color: ov.color ?? "0xffffff",
    strokeWidth: ov.strokeWidth ?? 1,
    strokeColor: ov.strokeColor ?? 0xffffff,
    textColor: ov.textColor,
  };
}

export function createButtonDanmu(ov: Partial<ButtonDanmu> = {}): ButtonDanmu {
  const base = baseDefaults("button", ov);
  return {
    ...base,
    type: "button",
    text: ov.text ?? "",
    fontSize: (ov as any).fontSize ?? 5,
    textColor: ov.textColor ?? 0xffffff,
    fillColor: ov.fillColor ?? 0xff9100,
    fillAlpha: ov.fillAlpha ?? 0.8,
    target: ov.target,
  };
}

export function createPathDanmu(ov: Partial<PathDanmu> = {}): PathDanmu {
  const base = baseDefaults("path", ov);
  return {
    ...base,
    type: "path",
    d: ov.d ?? "",
    viewBox: ov.viewBox ?? undefined,
    borderWidth: ov.borderWidth ?? 1,
    borderColor: ov.borderColor ?? 0xffffff,
    borderAlpha: ov.borderAlpha ?? 0.8,
    fillColor: ov.fillColor ?? 0x00a1d6,
    fillAlpha: ov.fillAlpha ?? 0.8,
    width: (ov as any).width ?? 20,
  };
}

export function createAudioDanmu(ov: Partial<AudioDanmu> = {}): AudioDanmu {
  const base = baseDefaults("audio", ov);
  return {
    ...base,
    type: "audio",
    src: ov.src ?? "",
    startTime: ov.startTime ?? 0,
    volume: ov.volume ?? 1,
  };
}

export function createDanmuByKey(key: string, payload: Partial<AnyDanmu> = {}): AnyDanmu {
  switch (key) {
    case "text":
      return createTextDanmu({
        content: "",
        zIndex: 3,
        durationMs: 5000,
        ...payload,
      });
    case "path":
      return createPathDanmu({
        zIndex: 1,
        durationMs: 2000,
        scale: 0.8,
        ...payload,
      });
    case "button":
      return createButtonDanmu({
        text: "按钮弹幕",
        zIndex: 1,
        durationMs: 2000,
        scale: 1,
        ...payload,
      });
    case "audio":
      return createAudioDanmu({
        durationMs: 5000, // 默认给一个时长，后续可能需要根据音频实际时长更新
        ...payload,
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
  } else if (danmu.type === "audio") {
    // BAS DSL 暂时不支持 audio，或者使用特殊注释标记
    return `// [Audio] ${danmu.name || 'Unknown Audio'} (duration: ${durationSec}s)`;
  }

  return `${defBlock}\n${setBlock}`;
}
