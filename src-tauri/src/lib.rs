mod ai;
mod extensions;
mod fsops;
mod pty;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .manage(ai::AiState::new())
        .invoke_handler(tauri::generate_handler![
            sys_info,
            fsops::fs_list_dir,
            fsops::fs_walk,
            fsops::fs_read_file,
            fsops::fs_write_file,
            fsops::fs_create_file,
            fsops::fs_create_dir,
            fsops::fs_rename,
            fsops::fs_remove,
            fsops::fs_exists,
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
