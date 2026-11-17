use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedPreferences {
    #[serde(default)]
    use_app_window_controls: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferences {
    platform: String,
    use_app_window_controls: bool,
}

pub struct WindowPreferencesState {
    preferences: Mutex<WindowPreferences>,
    path: PathBuf,
}

fn preferences_for(platform: &str, saved: SavedPreferences) -> WindowPreferences {
    WindowPreferences {
        platform: platform.to_owned(),
        use_app_window_controls: platform == "windows"
            || (platform == "linux" && saved.use_app_window_controls),
    }
}

fn read_preferences(path: &Path) -> Result<SavedPreferences, String> {
    match fs::read(path) {
        Ok(contents) => serde_json::from_slice(&contents).map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(SavedPreferences::default())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_preferences(path: &Path, enabled: bool) -> Result<(), String> {
    let directory = path.parent().ok_or("配置路径无效")?;
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    // 仅 Linux 设置会调用此函数；同一进程由设置锁串行化，rename 原子替换配置。
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = directory.join(format!(
        ".window-preferences.{}.{nonce}.tmp",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let contents = serde_json::to_vec_pretty(&SavedPreferences {
            use_app_window_controls: enabled,
        })
        .map_err(|e| e.to_string())?;
        file.write_all(&contents).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn initialize(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let path = app.path().app_config_dir()?.join("window-preferences.json");
    let saved = if cfg!(target_os = "linux") {
        read_preferences(&path).unwrap_or_else(|error| {
            eprintln!("读取窗口设置失败，使用系统窗口装饰: {error}");
            SavedPreferences::default()
        })
    } else {
        SavedPreferences::default()
    };
    let preferences = preferences_for(std::env::consts::OS, saved);
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("main") {
        window.set_decorations(!preferences.use_app_window_controls)?;
        #[cfg(target_os = "windows")]
        window.set_shadow(true)?;
    }
    app.manage(WindowPreferencesState {
        preferences: Mutex::new(preferences),
        path,
    });
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_window_preferences(
    state: tauri::State<'_, WindowPreferencesState>,
) -> Result<WindowPreferences, String> {
    state
        .preferences
        .lock()
        .map(|preferences| preferences.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_app_window_controls(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WindowPreferencesState>,
    enabled: bool,
) -> Result<WindowPreferences, String> {
    if !cfg!(target_os = "linux") {
        return Err("只有 Linux 支持切换窗口按钮模式".to_owned());
    }
    let mut preferences = state.preferences.lock().map_err(|e| e.to_string())?;
    let previous = preferences.use_app_window_controls;
    window
        .set_decorations(!enabled)
        .map_err(|e| e.to_string())?;
    if let Err(error) = write_preferences(&state.path, enabled) {
        // 持久化失败时恢复原有窗口模式，前端仍显示原设置。
        window.set_decorations(!previous).map_err(|rollback| {
            format!("保存窗口设置失败: {error}；恢复窗口装饰失败: {rollback}")
        })?;
        return Err(error);
    }
    preferences.use_app_window_controls = enabled;
    Ok(preferences.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_defaults_and_linux_override() {
        for (platform, expected) in [("windows", true), ("linux", false), ("macos", false)] {
            assert_eq!(
                preferences_for(platform, SavedPreferences::default()).use_app_window_controls,
                expected
            );
        }
        assert!(
            preferences_for(
                "linux",
                SavedPreferences {
                    use_app_window_controls: true
                }
            )
            .use_app_window_controls
        );
        assert!(
            !preferences_for(
                "macos",
                SavedPreferences {
                    use_app_window_controls: true
                }
            )
            .use_app_window_controls
        );
    }

    #[test]
    fn preferences_survive_reload_and_invalid_json_is_not_overwritten() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("bas-window-prefs-{}-{nonce}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("window-preferences.json");
        assert!(!read_preferences(&path).unwrap().use_app_window_controls);
        write_preferences(&path, true).unwrap();
        assert!(read_preferences(&path).unwrap().use_app_window_controls);
        #[cfg(target_os = "linux")]
        {
            write_preferences(&path, false).unwrap();
            assert!(!read_preferences(&path).unwrap().use_app_window_controls);
        }
        fs::write(&path, "invalid").unwrap();
        assert!(read_preferences(&path).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "invalid");
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
