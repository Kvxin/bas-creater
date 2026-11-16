mod app_update;
mod commands;
mod project_files;
mod recent_projects;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 单实例：再次启动时聚焦已打开的窗口，避免多个实例同时读写同一份 IndexedDB / OPFS 数据
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(app_update::UpdateState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 标题栏由前端自绘，不能让旧版本保存的 decorations 状态把系统标题栏恢复回来
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_update::app_update_status,
            app_update::check_app_update,
            app_update::download_app_update,
            app_update::install_app_update,
            commands::write_text_file,
            recent_projects::read_recent_projects,
            recent_projects::write_recent_projects,
            project_files::create_disk_project,
            project_files::reserve_project_support,
            project_files::restore_missing_disk_project,
            project_files::read_disk_project,
            project_files::save_disk_project,
            project_files::read_audio_reference,
            project_files::list_disk_backups,
            project_files::read_disk_backup,
            project_files::write_project_audio,
            project_files::read_project_audio,
            project_files::delete_disk_project_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
