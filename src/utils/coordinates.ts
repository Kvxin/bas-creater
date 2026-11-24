/** 位置坐标统一只用百分比保存，避免同一属性混用像素和百分比时插值出错。 */
export const COORDINATE_FIELDS = ["x", "y"] as const;

export type CoordinateField = (typeof COORDINATE_FIELDS)[number];

export interface CoordinateReferenceSize {
  width: number;
  height: number;
}

export const DEFAULT_COORDINATE_REFERENCE: CoordinateReferenceSize = { width: 800, height: 450 };

export const isCoordinateField = (key: string): key is CoordinateField => key === "x" || key === "y";

const roundPercent = (value: number) => Number(value.toFixed(4));

/**
 * 把坐标值转换成百分比字符串。
 *
 * 数值（或带 px 后缀的字符串）视为相对根画布的像素，按参照尺寸换算；BAS 中子对象的数值坐标
 * 同样按根画布归一化，因此换算结果也就是相对父对象的百分比。
 *
 * @returns 百分比字符串；空值返回 undefined
 * @throws 当值无法解析为坐标时抛出错误
 */
export const toPercentCoordinate = (
  value: unknown,
  field: CoordinateField,
  reference: CoordinateReferenceSize
): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value.trim() : value;
  if (typeof text === "string" && text.endsWith("%")) {
    const percent = Number(text.slice(0, -1));
    if (!text.slice(0, -1).trim() || !Number.isFinite(percent)) throw new Error(`Invalid ${field} coordinate`);
    return `${roundPercent(percent)}%`;
  }
  const pixels = typeof text === "number" ? text : Number(String(text).replace(/px$/i, ""));
  if (typeof text === "string" && !text) throw new Error(`Invalid ${field} coordinate`);
  if (!Number.isFinite(pixels)) throw new Error(`Invalid ${field} coordinate`);
  const size = field === "x" ? reference.width : reference.height;
  return `${roundPercent((pixels / size) * 100)}%`;
};

/** 就地把对象里的 x/y 转成百分比；对象为空时忽略。 */
export const normalizeCoordinates = (target: object | undefined, reference: CoordinateReferenceSize) => {
  if (!target) return;
  const record = target as Record<string, unknown>;
  for (const field of COORDINATE_FIELDS) {
    if (!(field in record)) continue;
    const value = toPercentCoordinate(record[field], field, reference);
    if (value === undefined) delete record[field];
    else record[field] = value;
  }
};
