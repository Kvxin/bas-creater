use std::path::PathBuf;

/// 将文本内容写入用户通过保存对话框选择的路径
#[tauri::command]
pub async fn write_text_file(path: PathBuf, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&path, contents))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("写入文件失败: {e}"))
}
