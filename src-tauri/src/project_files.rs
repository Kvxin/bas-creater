use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// Serialize compare-and-replace operations from this application instance.
static PROJECT_IO: Mutex<()> = Mutex::new(());
const PROJECT_FILE: &str = "project.basproj";

fn project_path(directory: &Path) -> Result<PathBuf, String> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("INVALID_PROJECT_DIRECTORY".into());
    }
    Ok(directory.join(PROJECT_FILE))
}

#[tauri::command]
pub fn create_disk_project(directory: PathBuf, contents: String) -> Result<(), String> {
    let _guard = PROJECT_IO.lock().map_err(|e| e.to_string())?;
    let path = project_path(&directory)?;
    if fs::read_dir(&directory).map_err(|e| e.to_string())?.next().is_some() {
        return Err("DIRECTORY_NOT_EMPTY".into());
    }
    // create_new makes the project filename exclusive even if the directory changes.
    let mut file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| e.to_string())?;
    if let Err(error) = file.write_all(contents.as_bytes()).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn read_disk_project(directory: PathBuf) -> Result<String, String> {
    let path = project_path(&directory)?;
    if fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type().is_symlink() {
        return Err("PROJECT_SYMLINK_NOT_ALLOWED".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_disk_project(directory: PathBuf, expected: String, contents: String) -> Result<(), String> {
    let _guard = PROJECT_IO.lock().map_err(|e| e.to_string())?;
    let path = project_path(&directory)?;
    if fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type().is_symlink() {
        return Err("PROJECT_SYMLINK_NOT_ALLOWED".into());
    }
    if fs::read_to_string(&path).map_err(|e| e.to_string())? != expected {
        return Err("PROJECT_MODIFIED_EXTERNALLY".into());
    }
    let temp = directory.join(format!(".project-{}-{}.tmp", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos()));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes()).and_then(|()| file.sync_all()).map_err(|e| e.to_string())?;
        drop(file);
        if fs::read_to_string(&path).map_err(|e| e.to_string())? != expected {
            return Err("PROJECT_MODIFIED_EXTERNALLY".into());
        }
        fs::rename(&temp, &path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

#[tauri::command]
pub fn read_audio_reference(path: PathBuf) -> Result<Vec<u8>, String> {
    if !path.is_absolute() || !path.is_file() {
        return Err("AUDIO_FILE_NOT_FOUND".into());
    }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].contains(&extension.as_str()) {
        return Err("UNSUPPORTED_AUDIO_FILE".into());
    }
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 512 * 1024 * 1024 { return Err("AUDIO_FILE_TOO_LARGE".into()); }
    fs::read(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_save_and_reject_external_change() {
        let directory = std::env::temp_dir().join(format!("danmakucut-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&directory).unwrap();
        create_disk_project(directory.clone(), "first".into()).unwrap();
        assert!(create_disk_project(directory.clone(), "other".into()).is_err());
        assert_eq!(read_disk_project(directory.clone()).unwrap(), "first");
        save_disk_project(directory.clone(), "first".into(), "second".into()).unwrap();
        assert!(save_disk_project(directory.clone(), "first".into(), "lost".into()).is_err());
        assert_eq!(read_disk_project(directory.clone()).unwrap(), "second");
        fs::remove_dir_all(directory).unwrap();
    }
}

#[tauri::command]
pub fn delete_disk_project_file(directory: PathBuf, project_id: String) -> Result<(), String> {
    let _guard = PROJECT_IO.lock().map_err(|e| e.to_string())?;
    let path = project_path(&directory)?;
    if fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type().is_symlink() {
        return Err("PROJECT_SYMLINK_NOT_ALLOWED".into());
    }
    let data: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if data.get("id").and_then(|value| value.as_str()) != Some(project_id.as_str()) {
        return Err("PROJECT_ID_MISMATCH".into());
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}
