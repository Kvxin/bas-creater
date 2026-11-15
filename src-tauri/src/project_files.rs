use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// Serialize compare-and-replace operations from this application instance.
static PROJECT_IO: Mutex<()> = Mutex::new(());
const PROJECT_FILE: &str = "project.basproj";

fn project_path(location: &Path) -> Result<PathBuf, String> {
    if !location.is_absolute() {
        return Err("INVALID_PROJECT_DIRECTORY".into());
    }
    if location.is_dir() {
        return Ok(location.join(PROJECT_FILE));
    }
    if location
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("basproj"))
        != Some(true)
        || !location.parent().is_some_and(|p| p.is_dir())
    {
        return Err("INVALID_PROJECT_DIRECTORY".into());
    }
    Ok(location.to_path_buf())
}

fn project_support_directory(location: &Path) -> Result<PathBuf, String> {
    if location.is_dir() {
        return Ok(location.to_path_buf());
    }
    let path = project_path(location)?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("INVALID_PROJECT_DIRECTORY")?;
    let support = path.with_file_name(format!(".{name}.danmakucut"));
    match fs::symlink_metadata(&support) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            return Err("INVALID_PROJECT_DIRECTORY".into())
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.to_string()),
        _ => {}
    }
    Ok(support)
}

fn ensure_support_directory(location: &Path) -> Result<PathBuf, String> {
    let support = project_support_directory(location)?;
    if !support.exists() {
        fs::create_dir(&support).map_err(|e| e.to_string())?;
    }
    let meta = fs::symlink_metadata(&support).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("INVALID_PROJECT_DIRECTORY".into());
    }
    Ok(support)
}

fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let mut left = fs::File::open(left).map_err(|e| e.to_string())?;
    let mut right = fs::File::open(right).map_err(|e| e.to_string())?;
    let size = left.metadata().map_err(|e| e.to_string())?.len();
    if size != right.metadata().map_err(|e| e.to_string())?.len() {
        return Ok(false);
    }
    let mut left_buf = [0; 16 * 1024];
    let mut right_buf = [0; 16 * 1024];
    let mut remaining = size;
    while remaining > 0 {
        let count = remaining.min(left_buf.len() as u64) as usize;
        left.read_exact(&mut left_buf[..count])
            .map_err(|e| e.to_string())?;
        right
            .read_exact(&mut right_buf[..count])
            .map_err(|e| e.to_string())?;
        if left_buf[..count] != right_buf[..count] {
            return Ok(false);
        }
        remaining -= count as u64;
    }
    Ok(true)
}

fn copy_legacy_support(source: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) {
            return Err("SUPPORT_DIRECTORY_CONFLICT".into());
        }
        let destination = target.join(entry.file_name());
        match fs::symlink_metadata(&destination) {
            Ok(meta) => {
                if meta.file_type().is_symlink()
                    || meta.is_dir() != kind.is_dir()
                    || (!meta.is_dir() && !meta.is_file())
                {
                    return Err("SUPPORT_DIRECTORY_CONFLICT".into());
                }
                if kind.is_dir() {
                    copy_legacy_support(&entry.path(), &destination)?;
                } else if !files_equal(&entry.path(), &destination)? {
                    return Err("SUPPORT_DIRECTORY_CONFLICT".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if kind.is_dir() {
                    fs::create_dir(&destination).map_err(|e| e.to_string())?;
                    copy_legacy_support(&entry.path(), &destination)?;
                } else {
                    let mut input = fs::File::open(entry.path()).map_err(|e| e.to_string())?;
                    let mut output = OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&destination)
                        .map_err(|e| e.to_string())?;
                    if let Err(error) =
                        std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all())
                    {
                        drop(output);
                        let _ = fs::remove_file(&destination);
                        return Err(error.to_string());
                    }
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn migrate_legacy_support(location: &Path, contents: &str) -> Result<(), String> {
    if location.is_dir() {
        return Ok(());
    }
    let json: serde_json::Value = match serde_json::from_str(contents) {
        Ok(json) => json,
        Err(_) => return Ok(()),
    };
    let Some(id) = json.get("id").and_then(|id| id.as_str()) else {
        return Ok(());
    };
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("INVALID_PROJECT_ID".into());
    }
    let legacy = location
        .parent()
        .ok_or("INVALID_PROJECT_DIRECTORY")?
        .join(format!(".danmakucut-{id}"));
    match fs::symlink_metadata(&legacy) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            return Err("SUPPORT_DIRECTORY_CONFLICT".into());
        }
        Ok(_) => {}
    }
    let target = ensure_support_directory(location)?;
    let marker = target.join(format!(".legacy-{id}.migrated"));
    match fs::symlink_metadata(&marker) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => return Ok(()),
        Ok(_) => return Err("SUPPORT_DIRECTORY_CONFLICT".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    copy_legacy_support(&legacy, &target)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reserve_project_support(directory: PathBuf) -> Result<(), String> {
    let path = project_path(&directory)?;
    if path.exists() {
        return Err("PROJECT_ALREADY_EXISTS".into());
    }
    let support = project_support_directory(&directory)?;
    fs::create_dir(support).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            "PROJECT_ALREADY_EXISTS".to_string()
        } else {
            e.to_string()
        }
    })
}

#[tauri::command]
pub fn create_disk_project(directory: PathBuf, contents: String) -> Result<(), String> {
    let _guard = PROJECT_IO.lock().map_err(|e| e.to_string())?;
    let path = project_path(&directory)?;
    // Only the selected filename is reserved; siblings belong to the user.
    // create_new makes the project filename exclusive even if the directory changes.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                "PROJECT_ALREADY_EXISTS".to_string()
            } else {
                e.to_string()
            }
        })?;
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
    let metadata = fs::symlink_metadata(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "PROJECT_FILE_NOT_FOUND".to_string()
        } else {
            e.to_string()
        }
    })?;
    if metadata.file_type().is_symlink() {
        return Err("PROJECT_SYMLINK_NOT_ALLOWED".into());
    }
    let contents = fs::read_to_string(path).map_err(|e| e.to_string())?;
    migrate_legacy_support(&directory, &contents)?;
    Ok(contents)
}

#[tauri::command]
pub fn restore_missing_disk_project(directory: PathBuf, contents: String) -> Result<(), String> {
    let _guard = PROJECT_IO.lock().map_err(|e| e.to_string())?;
    let path = project_path(&directory)?;
    migrate_legacy_support(&directory, &contents)?;
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

fn backup_project(directory: &Path, contents: &str, force: bool) -> Result<(), String> {
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
            if let Some(timestamp) = backup_timestamp(name).and_then(|s| s.parse::<u128>().ok()) {
                backups.push((timestamp, entry.path()));
            }
        }
    }
    backups.sort_by_key(|item| std::cmp::Reverse(item.0));
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    if !force
        && backups
            .first()
            .is_some_and(|(time, _)| now.saturating_sub(*time) < 300_000)
    {
        return Ok(());
    }
    let mut timestamp = now;
    let (path, mut file) = loop {
        let path = backup_dir.join(format!("backup-{timestamp}.basproj"));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => break (path, file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                timestamp = timestamp
                    .checked_add(1)
                    .ok_or("BACKUP_TIMESTAMP_OVERFLOW")?;
            }
            Err(error) => return Err(error.to_string()),
        }
    };
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
    force_backup: Option<bool>,
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
    backup_project(
        &ensure_support_directory(&directory)?,
        &expected,
        force_backup.unwrap_or(false),
    )?;
    let temp = path
        .parent()
        .ok_or("INVALID_PROJECT_DIRECTORY")?
        .join(format!(
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
    // Never delete legacy shared assets or backup folders: ownership cannot be proven.
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_disk_backups(
    directory: PathBuf,
    project_id: Option<String>,
) -> Result<Vec<String>, String> {
    if let Some(id) = project_id {
        let contents = match fs::read_to_string(project_path(&directory)?) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.to_string()),
        };
        if let Ok(project) = serde_json::from_str::<serde_json::Value>(&contents) {
            if project
                .get("id")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value != id)
            {
                return Err("PROJECT_ID_MISMATCH".into());
            }
        }
        migrate_legacy_support(&directory, &serde_json::json!({ "id": id }).to_string())?;
    }
    let path = project_support_directory(&directory)?.join(".danmakucut-backups");
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
    names.sort_by(|a, b| {
        let a_time = backup_timestamp(a).unwrap().trim_start_matches('0');
        let b_time = backup_timestamp(b).unwrap().trim_start_matches('0');
        b_time
            .len()
            .cmp(&a_time.len())
            .then_with(|| b_time.cmp(a_time))
            .then_with(|| b.cmp(a))
    });
    Ok(names)
}

fn backup_timestamp(name: &str) -> Option<&str> {
    let stem = name.strip_prefix("backup-")?.strip_suffix(".basproj")?;
    let (timestamp, uuid) = match stem.split_once('-') {
        Some((timestamp, uuid)) => (timestamp, Some(uuid)),
        None => (stem, None),
    };
    if timestamp.is_empty() || !timestamp.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if let Some(uuid) = uuid {
        if uuid.len() != 36
            || !uuid.bytes().enumerate().all(|(i, b)| {
                if matches!(i, 8 | 13 | 18 | 23) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
        {
            return None;
        }
    }
    Some(timestamp)
}

fn valid_backup_name(name: &str) -> bool {
    backup_timestamp(name).is_some()
}

#[tauri::command]
pub fn read_disk_backup(directory: PathBuf, name: String) -> Result<String, String> {
    if !valid_backup_name(&name) {
        return Err("INVALID_BACKUP_NAME".into());
    }
    let backup_dir = project_support_directory(&directory)?.join(".danmakucut-backups");
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
    if name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        || name.starts_with('.')
        || name.contains("..")
    {
        return Err("INVALID_ASSET_NAME".into());
    }
    let root = if create {
        ensure_support_directory(directory)?
    } else {
        project_support_directory(directory)?
    };
    let assets = root.join("assets");
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
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    fn temp_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "danmakucut-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn lists_and_reads_both_backup_names_and_rejects_invalid_names() {
        let directory = temp_directory();
        let backups = directory.join(".danmakucut-backups");
        fs::create_dir(&backups).unwrap();
        let desktop = "backup-9.basproj";
        let browser = "backup-10-12345678-1234-4234-8234-123456789abc.basproj";
        fs::write(backups.join(desktop), "desktop").unwrap();
        fs::write(backups.join(browser), "browser").unwrap();
        fs::write(backups.join("backup-11-not-a-uuid.basproj"), "invalid").unwrap();
        assert_eq!(
            list_disk_backups(directory.clone(), None).unwrap(),
            vec![browser, desktop]
        );
        assert_eq!(
            read_disk_backup(directory.clone(), desktop.into()).unwrap(),
            "desktop"
        );
        assert_eq!(
            read_disk_backup(directory.clone(), browser.into()).unwrap(),
            "browser"
        );
        for name in [
            "../backup-9.basproj",
            "backup-11-not-a-uuid.basproj",
            "backup--12345678-1234-4234-8234-123456789abc.basproj",
            "backup-1-12345678-1234-4234-8234-123456789abz.basproj",
        ] {
            assert_eq!(
                read_disk_backup(directory.clone(), name.into()).unwrap_err(),
                "INVALID_BACKUP_NAME"
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn migrates_legacy_support_once_and_preserves_conflicts() {
        let directory = temp_directory();
        let project = directory.join("example.basproj");
        let legacy = directory.join(".danmakucut-project_1");
        let support = directory.join(".example.basproj.danmakucut");
        let contents = r#"{"id":"project_1"}"#;
        fs::write(&project, contents).unwrap();
        fs::create_dir(&legacy).unwrap();
        fs::create_dir(legacy.join("nested")).unwrap();
        fs::write(legacy.join("nested/asset"), "old").unwrap();
        assert_eq!(read_disk_project(project.clone()).unwrap(), contents);
        assert_eq!(
            fs::read_to_string(support.join("nested/asset")).unwrap(),
            "old"
        );
        assert!(support.join(".legacy-project_1.migrated").is_file());
        fs::write(legacy.join("nested/asset"), "changed").unwrap();
        read_disk_project(project.clone()).unwrap();
        assert_eq!(
            fs::read_to_string(support.join("nested/asset")).unwrap(),
            "old"
        );
        fs::remove_file(support.join(".legacy-project_1.migrated")).unwrap();
        assert_eq!(
            read_disk_project(project.clone()).unwrap_err(),
            "SUPPORT_DIRECTORY_CONFLICT"
        );
        assert_eq!(
            fs::read_to_string(legacy.join("nested/asset")).unwrap(),
            "changed"
        );
        assert_eq!(
            fs::read_to_string(support.join("nested/asset")).unwrap(),
            "old"
        );
        fs::write(&project, r#"{"id":"../escape"}"#).unwrap();
        assert_eq!(
            read_disk_project(project).unwrap_err(),
            "INVALID_PROJECT_ID"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn retention_counts_browser_and_desktop_backups() {
        let directory = temp_directory();
        let backups = directory.join(".danmakucut-backups");
        fs::create_dir(&backups).unwrap();
        for i in 1..=10 {
            let name = if i % 2 == 0 {
                format!("backup-{i}-12345678-1234-4234-8234-123456789abc.basproj")
            } else {
                format!("backup-{i}.basproj")
            };
            fs::write(backups.join(name), i.to_string()).unwrap();
        }
        backup_project(&directory, "new", true).unwrap();
        let names = list_disk_backups(directory.clone(), None).unwrap();
        assert_eq!(names.len(), 10);
        assert!(!backups.join("backup-1.basproj").exists());
        assert!(backups
            .join("backup-2-12345678-1234-4234-8234-123456789abc.basproj")
            .exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn restore_migrates_legacy_support_without_removing_it() {
        let directory = temp_directory();
        let project = directory.join("restored.basproj");
        let legacy = directory.join(".danmakucut-restored");
        fs::create_dir(&legacy).unwrap();
        fs::write(legacy.join("asset"), "data").unwrap();
        restore_missing_disk_project(project, r#"{"id":"restored"}"#.into()).unwrap();
        assert_eq!(
            fs::read_to_string(directory.join(".restored.basproj.danmakucut/asset")).unwrap(),
            "data"
        );
        assert_eq!(fs::read_to_string(legacy.join("asset")).unwrap(), "data");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn lists_legacy_backups_even_when_project_is_corrupt() {
        let directory = temp_directory();
        let project = directory.join("broken.basproj");
        let legacy = directory.join(".danmakucut-project_1/.danmakucut-backups");
        let name = "backup-10-12345678-1234-4234-8234-123456789abc.basproj";
        fs::write(&project, "{broken").unwrap();
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join(name), "backup").unwrap();
        assert_eq!(
            list_disk_backups(project.clone(), Some("project_1".into())).unwrap(),
            vec![name]
        );
        assert_eq!(read_disk_backup(project, name.into()).unwrap(), "backup");
        assert!(legacy.join(name).exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn create_save_and_reject_external_change() {
        let directory = temp_directory();
        create_disk_project(directory.clone(), "first".into()).unwrap();
        assert!(create_disk_project(directory.clone(), "other".into()).is_err());
        assert_eq!(read_disk_project(directory.clone()).unwrap(), "first");
        save_disk_project(directory.clone(), "first".into(), "second".into(), None).unwrap();
        assert!(save_disk_project(directory.clone(), "first".into(), "lost".into(), None).is_err());
        assert_eq!(read_disk_project(directory.clone()).unwrap(), "second");
        assert!(restore_missing_disk_project(directory.clone(), "replacement".into()).is_err());
        fs::remove_file(directory.join(PROJECT_FILE)).unwrap();
        assert_eq!(
            read_disk_project(directory.clone()).unwrap_err(),
            "PROJECT_FILE_NOT_FOUND"
        );
        restore_missing_disk_project(directory.clone(), "restored".into()).unwrap();
        assert_eq!(read_disk_project(directory.clone()).unwrap(), "restored");
        fs::remove_dir_all(directory).unwrap();
    }
}
