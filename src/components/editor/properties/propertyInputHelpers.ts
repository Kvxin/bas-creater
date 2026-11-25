import type { CoordinateReferenceSize } from "@/core/coordinates";

/** 从输入框失去焦点或回车时提交有效数值；按 Escape 还原焦点前的值。 */
export const handleNumericInputFocus = (event: FocusEvent) => {
  const input = event.target as HTMLInputElement;
  input.dataset.originalValue = input.value;
};

export const handleNumericInputKeydown = (event: KeyboardEvent) => {
  if (event.isComposing) return;
  const input = event.target as HTMLInputElement;
  if (event.key === "Escape") {
    input.dataset.cancelled = "true";
    input.value = input.dataset.originalValue ?? "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    event.preventDefault();
    input.blur();
  } else if (event.key === "Enter") {
    event.preventDefault();
    input.blur();
  }
};

export const handleNumericInputChange = (event: Event, commit: (value: string) => void) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.cancelled) {
    delete input.dataset.cancelled;
    return;
  }
  if (input.value.trim() && Number.isFinite(Number(input.value.replace(/%$/, "")))) commit(input.value);
};

export type PercentageField = "x" | "y" | "fontSize" | "width" | "height";
export type KeyframePercentageField = Extract<PercentageField, "x" | "y" | "fontSize">;
export type AnchorAxis = "x" | "y";

export const isUnsetPropertyValue = (value: unknown) => value === undefined || value === null || value === "";

/**
 * 在像素与百分比之间换算属性值。
 *
 * BAS 将子坐标数值也按根画布尺寸归一化，父尺寸只在渲染时相乘。
 */
export const convertPercentagePropertyValue = (
  field: PercentageField,
  value: unknown,
  enabled: boolean,
  reference: CoordinateReferenceSize | null | undefined
) => {
  const size = field === "y" || field === "height" ? reference?.height : reference?.width;
  const numeric = Number.parseFloat(String(value));
  if (!size || !Number.isFinite(size) || size <= 0 || !Number.isFinite(numeric)) return null;
  const wasPercent = typeof value === "string" && value.trim().endsWith("%");
  if (wasPercent === enabled) return value;
  return enabled ? `${(numeric / size) * 100}%` : (numeric * size) / 100;
};

/** 将 `0xRRGGBB`、`#RRGGBB` 或数值转换为 `<input type="color">` 需要的 `#rrggbb`。 */
export const toHtmlColor = (val: string | number | undefined): string => {
  if (val === undefined) return "#000000";
  let hexStr = "";
  if (typeof val === "number") {
    hexStr = val.toString(16).padStart(6, "0");
  } else if (typeof val === "string") {
    if (val.startsWith("0x") || val.startsWith("0X")) {
      hexStr = val.slice(2);
    } else if (val.startsWith("#")) {
      return val;
    } else {
      return "#000000";
    }
  }
  return "#" + hexStr;
};

export const formatAnimationSeconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
