use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;

const FILE_NAME: &str = "recent-projects.json";
static RECENT_IO: Mutex<()> = Mutex::new(());
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|err| format!("获取应用配置目录失败: {err}"))
}

#[tauri::command]
pub fn read_recent_projects(app: tauri::AppHandle) -> Result<String, String> {
    let path = config_file(&app)?;
    let _guard = RECENT_IO
        .lock()
        .map_err(|err| format!("近期项目锁定失败: {err}"))?;
    read_file(&path).map_err(|err| format!("读取近期项目失败 ({}): {err}", path.display()))
}

fn read_file(path: &Path) -> io::Result<String> {
    match fs::read_to_string(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok("[]".to_owned()),
        result => result,
    }
}

#[tauri::command]
pub fn write_recent_projects(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = config_file(&app)?;
    let _guard = RECENT_IO
        .lock()
        .map_err(|err| format!("近期项目锁定失败: {err}"))?;
    write_file(&path, &contents)
}

fn write_file(path: &Path, contents: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(contents).map_err(|err| format!("近期项目 JSON 无效: {err}"))?;
    if !value.is_array() {
        return Err("近期项目 JSON 必须是数组".to_owned());
    }

    let dir = path
        .parent()
        .ok_or_else(|| "近期项目路径没有父目录".to_owned())?;
    fs::create_dir_all(dir)
        .map_err(|err| format!("创建配置目录失败 ({}): {err}", dir.display()))?;

    // create_new prevents clobbering a leftover file or another process's temporary file.
    let (temp, mut file) = loop {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp = dir.join(format!(
            ".{FILE_NAME}.{}.{}.tmp",
            std::process::id(),
            sequence
        ));
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => break (temp, file),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(format!(
                    "创建近期项目临时文件失败 ({}): {err}",
                    temp.display()
                ))
            }
        }
    };

    let result = file
        .write_all(contents.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|err| format!("写入近期项目临时文件失败 ({}): {err}", temp.display()));
    drop(file);
    let result = result.and_then(|()| {
        replace_file(&temp, path)
            .map_err(|err| format!("替换近期项目文件失败 ({}): {err}", path.display()))
    });
    if let Err(err) = result {
        return match fs::remove_file(&temp) {
            Ok(()) => Err(err),
            Err(cleanup) if cleanup.kind() == io::ErrorKind::NotFound => Err(err),
            Err(cleanup) => Err(format!(
                "{err}; 清理临时文件失败 ({}): {cleanup}",
                temp.display()
            )),
        };
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // Both paths are NUL-terminated and remain alive for the duration of the call.
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("bas-recent-test-{}-{sequence}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn file(&self) -> PathBuf {
            self.0.join("config").join(FILE_NAME)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_file_returns_empty_array() {
        let dir = TestDir::new();
        assert_eq!(read_file(&dir.file()).unwrap(), "[]");
    }

    #[test]
    fn writes_persist_and_replace_existing_contents() {
        let dir = TestDir::new();
        let path = dir.file();
        write_file(&path, "[\"first\",\"longer\"]").unwrap();
        assert_eq!(read_file(&path).unwrap(), "[\"first\",\"longer\"]");
        write_file(&path, "[]").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "[]");
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn invalid_json_does_not_modify_existing_file() {
        let dir = TestDir::new();
        let path = dir.file();
        write_file(&path, "[1]").unwrap();
        assert!(write_file(&path, "{").is_err());
        assert!(write_file(&path, "{}").is_err());
        assert_eq!(read_file(&path).unwrap(), "[1]");
    }

    #[test]
    fn replacement_failure_keeps_existing_target_and_cleans_temp() {
        let dir = TestDir::new();
        let path = dir.file();
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("keep"), "untouched").unwrap();
        assert!(write_file(&path, "[]").is_err());
        assert_eq!(fs::read_to_string(path.join("keep")).unwrap(), "untouched");
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
}
