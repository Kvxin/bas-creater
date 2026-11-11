import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

/** 当前是否运行在 Tauri 桌面客户端中 */
export const isDesktopApp = (): boolean => isTauri();

/** macOS 使用系统红绿灯按钮，其余平台由前端绘制窗口按钮 */
export const isMacOS = (): boolean => /Mac/i.test(navigator.userAgent);

export type SaveTextFileOptions = {
  fileName: string;
  content: string;
  mimeType?: string;
  filters?: { name: string; extensions: string[] }[];
};

const downloadInBrowser = ({ fileName, content, mimeType = "text/plain;charset=utf-8" }: SaveTextFileOptions) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * 保存文本文件：桌面端弹出系统保存对话框并由 Rust 写入磁盘；
 * WebView（尤其是 WKWebView / WebKitGTK）不支持 `<a download>`，因此不能复用浏览器下载逻辑。
 * @returns 用户取消保存时返回 false
 */
export const saveTextFile = async (options: SaveTextFileOptions): Promise<boolean> => {
  if (!isDesktopApp()) {
    downloadInBrowser(options);
    return true;
  }

  const path = await save({ defaultPath: options.fileName, filters: options.filters });
  if (!path) return false;

  await invoke("write_text_file", { path, contents: options.content });
  return true;
};

/** 使用系统默认浏览器打开外部链接 */
export const openExternalUrl = async (url: string): Promise<void> => {
  if (isDesktopApp()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};
