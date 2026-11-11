// 防止 Windows release 版本额外弹出控制台窗口，请勿删除
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 部分 Linux 环境（如 NVIDIA GPU）下 WebKitGTK 的 DMA-BUF 渲染器会导致白屏/黑屏
    // 参考: https://github.com/tauri-apps/tauri/issues/9394
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    bas_creater_lib::run();
}
