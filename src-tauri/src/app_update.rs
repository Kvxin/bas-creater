use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState {
    busy: AtomicBool,
    pending: Mutex<Option<PendingUpdate>>,
}

struct PendingUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}

struct OperationGuard<'a>(&'a AtomicBool);

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl UpdateState {
    fn begin(&self) -> Result<OperationGuard<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "UPDATE_BUSY".to_string())?;
        Ok(OperationGuard(&self.busy))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    supported: bool,
    available_version: Option<String>,
    notes: Option<String>,
    ready: bool,
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn auto_install_supported() -> bool {
    if cfg!(debug_assertions) || cfg!(feature = "portable") {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        // Tauri 打包器写入的安装形式标识不依赖 EXE 文件名，便携版没有此标识。
        use tauri::utils::{config::BundleType, platform::bundle_type};
        matches!(bundle_type(), Some(BundleType::Msi | BundleType::Nsis))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        true
    }
}

#[tauri::command]
pub fn app_update_status(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<UpdateStatus, String> {
    let pending = state.pending.lock().map_err(|e| e.to_string())?;
    Ok(UpdateStatus {
        current_version: app.package_info().version.to_string(),
        supported: auto_install_supported(),
        available_version: pending.as_ref().map(|p| p.update.version.clone()),
        notes: pending.as_ref().and_then(|p| p.update.body.clone()),
        ready: pending.as_ref().is_some_and(|p| p.bytes.is_some()),
    })
}

#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<UpdateStatus, String> {
    let _operation = state.begin()?;
    let builder = app.updater_builder().timeout(Duration::from_secs(30));
    // MSI 的默认重启提示参数不足以阻止系统重启，显式禁止安装器重启 Windows。
    #[cfg(target_os = "windows")]
    let builder = if matches!(
        tauri::utils::platform::bundle_type(),
        Some(tauri::utils::config::BundleType::Msi)
    ) {
        builder.installer_args(["REBOOT=ReallySuppress"])
    } else {
        builder
    };
    let update = builder
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    {
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        match update {
            Some(mut update) => {
                // 检查请求应尽快失败，安装包下载则给慢速网络留出足够时间。
                update.timeout = Some(Duration::from_secs(30 * 60));
                if !pending.as_ref().is_some_and(|p| {
                    p.update.version == update.version && p.update.signature == update.signature
                }) {
                    *pending = Some(PendingUpdate {
                        update,
                        bytes: None,
                    });
                }
            }
            None => *pending = None,
        }
    }
    app_update_status(app, state.clone())
}

#[tauri::command]
pub async fn download_app_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<UpdateStatus, String> {
    let _operation = state.begin()?;
    if !auto_install_supported() {
        return Err("UPDATE_MANUAL_ONLY".to_string());
    }
    let (update, ready) = {
        let pending = state.pending.lock().map_err(|e| e.to_string())?;
        let pending = pending.as_ref().ok_or("UPDATE_NOT_FOUND")?;
        (pending.update.clone(), pending.bytes.is_some())
    };
    if ready {
        return app_update_status(app, state.clone());
    }
    let mut downloaded = 0;
    // download 完成前插件会验证签名，失败的内容不会进入缓存。
    let bytes = update
        .download(
            |length, total| {
                downloaded += length as u64;
                let _ = app.emit(
                    "app-update-progress",
                    DownloadProgress { downloaded, total },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    if let Some(pending) = state.pending.lock().map_err(|e| e.to_string())?.as_mut() {
        pending.bytes = Some(bytes);
    }
    app_update_status(app, state.clone())
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    let _operation = state.begin()?;
    if !auto_install_supported() {
        return Err("UPDATE_MANUAL_ONLY".to_string());
    }
    let (update, bytes) = {
        let pending = state.pending.lock().map_err(|e| e.to_string())?;
        let pending = pending.as_ref().ok_or("UPDATE_NOT_FOUND")?;
        (
            pending.update.clone(),
            pending.bytes.clone().ok_or("UPDATE_NOT_DOWNLOADED")?,
        )
    };
    // Windows 插件启动安装器后直接退出；macOS / AppImage 安装返回后由后端重启。
    update.install(bytes).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    app.restart();
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_operations_are_rejected_and_failure_allows_retry() {
        let state = UpdateState::default();
        let guard = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(guard);
        assert!(state.begin().is_ok());
    }
}
