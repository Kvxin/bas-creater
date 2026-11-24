import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { BasParseResult } from "../../src/utils/bas";

type BasDanmakuInstance = {
  workerDisabled: boolean;
  parse(options: {
    danmaku: { text: string };
    success: (result: BasParseResult) => void;
    error: (message?: string) => void;
  }): void;
};

/** 递归空对象：满足 bas.js 构造与样式注入阶段的 DOM 访问，解析本身不依赖 DOM。 */
const createDomStub = (): unknown =>
  new Proxy(function () {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => "" : key === "length" ? 0 : createDomStub()),
    apply: () => createDomStub(),
    construct: () => createDomStub() as object,
    set: () => true
  });

let parserInstance: BasDanmakuInstance | null = null;

/** 在 Node 中加载 public/bas.js，用真实 BAS 解析器校验编译输出。 */
const getParser = (): BasDanmakuInstance => {
  if (parserInstance) return parserInstance;
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "../../public/bas.js"), "utf8");
  const document = createDomStub();
  const navigator = { userAgent: "node" };
  const window: Record<string, unknown> = { document, navigator, Worker: undefined, addEventListener() {} };
  window.window = window;
  window.self = window;
  const context = vm.createContext({ window, document, navigator, self: window, Worker: undefined, console });
  vm.runInContext(source, context);
  const BasDanmaku = window.BasDanmaku as new (options: Record<string, unknown>) => BasDanmakuInstance;
  parserInstance = new BasDanmaku({
    container: createDomStub(),
    easing: "linear",
    visible: false,
    fontFamily: "",
    timeSyncFunc: () => 0
  });
  parserInstance.workerDisabled = true;
  return parserInstance;
};

/** 同步解析 BAS DSL；bas.js 在 workerDisabled 时同步回调。 */
export const parseBas = (text: string): BasParseResult => {
  let result: BasParseResult | null = null;
  let failure: string | null = null;
  const originalWarn = console.warn;
  // bas.js 解析失败时会先 console.warn 再回调 error，测试里只保留断言信息。
  console.warn = () => {};
  try {
    getParser().parse({
      danmaku: { text },
      success: (parsed) => {
        result = { defs: parsed.defs, sets: parsed.sets };
      },
      error: (message) => {
        failure = message || "BAS parse error";
      }
    });
  } finally {
    console.warn = originalWarn;
  }
  if (failure !== null) throw new Error(failure);
  if (result === null) throw new Error("BAS parser did not return synchronously");
  return result;
};
