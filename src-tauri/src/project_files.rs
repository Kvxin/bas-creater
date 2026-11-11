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
    if fs::read_dir(&directory)
        .map_err(|e| e.to_string())?
        .next()
        .is_some()
    {
        return Err("DIRECTORY_NOT_EMPTY".into());
    }
    // create_new makes the project filename exclusive even if the directory changes.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    if let Err(error) = file
        .write_all(contents.as_bytes())
        .and_then(|()| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn read_disk_project(directory: PathBuf) -> Result<String, String> {
    let path = project_path(&directory)?;
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("PROJECT_SYMLINK_NOT_ALLOWED".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn backup_project(directory: &Path, contents: &str) -> Result<(), String> {
    let backup_dir = directory.join(".danmakucut-backups");
    if backup_dir.exists() {
        if fs::symlink_metadata(&backup_dir)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("BACKUP_SYMLINK_NOT_ALLOWED".into());
        }
    } else {
        fs::create_dir(&backup_dir).map_err(|e| e.to_string())?;
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(&backup_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            if let Some(timestamp) = name
                .strip_prefix("backup-")
                .and_then(|s| s.strip_suffix(".basproj"))
                .and_then(|s| s.parse::<u128>().ok())
            {
                backups.push((timestamp, entry.path()));
            }
        }
    }
    backups.sort_by_key(|item| std::cmp::Reverse(item.0));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    if backups
        .first()
        .is_some_and(|(time, _)| now.saturating_sub(*time) < 300_000)
    {
        return Ok(());
    }
    let path = backup_dir.join(format!("backup-{now}.basproj"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    if let Err(error) = file
        .write_all(contents.as_bytes())
        .and_then(|()| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.to_string());
    }
    for (_, path) in backups.into_iter().skip(9) {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_disk_project(
    directory: PathBuf,
    expected: String,
    contents: String,
) -> Result<(), String> {
    let _guard = PROJECT_IO.lock().map_err(|e| e.to_string())?;
    let path = project_path(&directory)?;
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("PROJECT_SYMLINK_NOT_ALLOWED".into());
    }
    if fs::read_to_string(&path).map_err(|e| e.to_string())? != expected {
        return Err("PROJECT_MODIFIED_EXTERNALLY".into());
    }
    backup_project(&directory, &expected)?;
    let temp = directory.join(format!(
        ".project-{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        if fs::read_to_string(&path).map_err(|e| e.to_string())? != expected {
            return Err("PROJECT_MODIFIED_EXTERNALLY".into());
        }
        fs::rename(&temp, &path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[tauri::command]
pub fn read_audio_reference(path: PathBuf) -> Result<Vec<u8>, String> {
    if !path.is_absolute() || !path.is_file() {
        return Err("AUDIO_FILE_NOT_FOUND".into());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].contains(&extension.as_str()) {
        return Err("UNSUPPORTED_AUDIO_FILE".into());
    }
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 512 * 1024 * 1024 {
        return Err("AUDIO_FILE_TOO_LARGE".into());
    }
    fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_disk_project_file(directory: PathBuf, project_id: String) -> Result<(), String> {
    let _guard = PROJECT_IO.lock().map_err(|e| e.to_string())?;
    let path = project_path(&directory)?;
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("PROJECT_SYMLINK_NOT_ALLOWED".into());
    }
    let data: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if data.get("id").and_then(|value| value.as_str()) != Some(project_id.as_str()) {
        return Err("PROJECT_ID_MISMATCH".into());
    }
    if let Some(items) = data.get("audioMeta").and_then(|value| value.as_array()) {
        for item in items {
            if let Some(name) = item.get("relativePath").and_then(|value| value.as_str()) {
                let asset = match asset_path(&directory, name, false) {
                    Ok(asset) => asset,
                    Err(error) if error == "ASSET_NOT_FOUND" => continue,
                    Err(error) => return Err(error),
                };
                match fs::symlink_metadata(&asset) {
                    Ok(meta) if meta.file_type().is_symlink() => return Err("ASSET_SYMLINK_NOT_ALLOWED".into()),
                    Ok(_) => fs::remove_file(asset).map_err(|e| e.to_string())?,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                    Err(error) => return Err(error.to_string()),
                }
            }
        }
    }
    for name in list_disk_backups(directory.clone())? {
        fs::remove_file(directory.join(".danmakucut-backups").join(name)).map_err(|e| e.to_string())?;
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_disk_backups(directory: PathBuf) -> Result<Vec<String>, String> {
    let path = project_path(&directory)?
        .parent()
        .ok_or("INVALID_PROJECT_DIRECTORY")?
        .join(".danmakucut-backups");
    if !path.exists() {
        return Ok(Vec::new());
    }
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("BACKUP_SYMLINK_NOT_ALLOWED".into());
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            if valid_backup_name(name) {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    names.reverse();
    Ok(names)
}

fn valid_backup_name(name: &str) -> bool {
    name.strip_prefix("backup-")
        .and_then(|s| s.strip_suffix(".basproj"))
        .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
}

#[tauri::command]
pub fn read_disk_backup(directory: PathBuf, name: String) -> Result<String, String> {
    if !valid_backup_name(&name) {
        return Err("INVALID_BACKUP_NAME".into());
    }
    let backup_dir = project_path(&directory)?
        .parent()
        .ok_or("INVALID_PROJECT_DIRECTORY")?
        .join(".danmakucut-backups");
    if fs::symlink_metadata(&backup_dir)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("BACKUP_SYMLINK_NOT_ALLOWED".into());
    }
    let path = backup_dir.join(name);
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("BACKUP_SYMLINK_NOT_ALLOWED".into());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn asset_path(directory: &Path, name: &str, create: bool) -> Result<PathBuf, String> {
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        || name.starts_with('.')
        || name.contains("..")
    {
        return Err("INVALID_ASSET_NAME".into());
    }
    let _ = project_path(directory)?;
    let assets = directory.join("assets");
    let audio = assets.join("audio");
    for dir in [&assets, &audio] {
        if dir.exists() {
            let metadata = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("INVALID_ASSET_DIRECTORY".into());
            }
        } else if create {
            fs::create_dir(dir).map_err(|e| e.to_string())?;
        } else {
            return Err("ASSET_NOT_FOUND".into());
        }
    }
    Ok(audio.join(name))
}

#[tauri::command]
pub fn write_project_audio(directory: PathBuf, name: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("AUDIO_FILE_TOO_LARGE".into());
    }
    let path = asset_path(&directory, &name, true)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn read_project_audio(directory: PathBuf, name: String) -> Result<Vec<u8>, String> {
    let path = asset_path(&directory, &name, false)?;
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("ASSET_SYMLINK_NOT_ALLOWED".into());
    }
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > 512 * 1024 * 1024 {
        return Err("AUDIO_FILE_TOO_LARGE".into());
    }
    fs::read(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_save_and_reject_external_change() {
        let directory = std::env::temp_dir().join(format!(
            "danmakucut-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
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
