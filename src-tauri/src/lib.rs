mod ai;
mod extensions;
mod fsops;
mod git;
mod pty;
mod search;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SysInfo {
    os: String,
    home: String,
    default_shell: String,
    path_sep: String,
}

#[tauri::command]
fn sys_info() -> SysInfo {
    SysInfo {
        os: std::env::consts::OS.to_string(),
        home: fsops::home_dir(),
        default_shell: pty::default_shell(),
        path_sep: std::path::MAIN_SEPARATOR.to_string(),
    }
}

/// 開いているページを印刷する（OS の印刷ダイアログを出す）
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    tauri: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        tauri: tauri::VERSION.to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .manage(ai::AiState::new())
        .invoke_handler(tauri::generate_handler![
            sys_info,
            print_page,
            app_info,
            fsops::fs_list_dir,
            fsops::fs_walk,
            fsops::fs_read_file,
            fsops::fs_write_file,
            fsops::fs_create_file,
            fsops::fs_create_dir,
            fsops::fs_rename,
            fsops::fs_remove,
            fsops::fs_exists,
            fsops::fs_read_data_url,
            search::fs_search,
            git::git_status,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            ai::ai_complete,
            ai::ai_cancel,
            ai::ai_models,
            extensions::ext_dir,
            extensions::ext_list,
            extensions::ext_install,
            extensions::ext_uninstall,
        ])
        .run(tauri::generate_context!())
        .expect("Aizome の起動に失敗しました");
}
