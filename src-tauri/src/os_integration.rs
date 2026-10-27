//! OS との連携：「プログラムから開く」の候補や右クリックメニューに Aizome を出し、
//! そこから渡されたファイルを開く。
//! - Windows：HKEY_CURRENT_USER に登録する（管理者権限は不要。いつも使うアプリは変えない）
//! - Mac / Linux：アプリの中で宣言している（tauri.macos.conf.json / tauri.linux.conf.json）

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// 起動時や起動中に「開いて」と渡されたファイル（画面の準備ができたら取り出す）
#[derive(Default)]
pub struct OpenRequests {
    pending: Mutex<Vec<String>>,
}

/// 開く対象の拡張子（「プログラムから開く」の候補に出す）
pub const EXTENSIONS: &[&str] = &[
    "py", "pyw", "js", "mjs", "cjs", "jsx", "ts", "mts", "tsx", "json", "jsonc", "md", "markdown", "txt", "log", "csv",
    "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "rs", "go", "c", "h", "cpp", "cc", "cxx", "hpp",
    "java", "kt", "kts", "cs", "rb", "php", "lua", "sh", "bash", "zsh", "ps1", "bat", "cmd", "yaml", "yml", "toml",
    "ini", "cfg", "conf", "xml", "sql", "swift", "dart", "r", "pl", "gitignore", "env",
];

/// コマンドライン引数から、開くファイルやフォルダを取り出す
pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.is_empty())
        .map(|a| {
            let p = PathBuf::from(a);
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            p.to_string_lossy().to_string()
        })
        .filter(|p| Path::new(p).exists())
        .collect()
}

/// 画面へ「このファイルを開いて」と伝える（画面がまだなら取っておく）
pub fn deliver(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<OpenRequests>() {
        if let Ok(mut p) = state.pending.lock() {
            p.extend(paths.iter().cloned());
        }
    }
    let _ = app.emit("open:paths", paths);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn take_open_paths(state: State<'_, OpenRequests>) -> Vec<String> {
    state.pending.lock().map(|mut p| std::mem::take(&mut *p)).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    supported: bool,
    registered: bool,
}

// ───────── Windows のレジストリ

#[cfg(windows)]
mod win {
    //! レジストリは Windows の API で直接書く（reg.exe やスクリプトは使わない）
    use super::EXTENSIONS;
    use std::path::Path;
    use winreg::enums::{HKEY_CURRENT_USER, REG_NONE};
    use winreg::{RegKey, RegValue};

    const PROG_ID: &str = "Aizome.SourceFile";
    const CLASSES: &str = "Software\\Classes";
    /// Windows の「既定のアプリ」の一覧に出すための登録場所
    const CAPABILITIES: &str = "Software\\Aizome\\Capabilities";
    const REGISTERED_APPS: &str = "Software\\RegisteredApplications";
    pub const APP_NAME: &str = "Aizome";

    fn classes() -> std::io::Result<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(CLASSES, winreg::enums::KEY_ALL_ACCESS)
    }

    fn set_default(root: &RegKey, path: &str, value: &str) -> std::io::Result<RegKey> {
        let (key, _) = root.create_subkey(path)?;
        key.set_value("", &value)?;
        Ok(key)
    }

    pub fn apply(exe: &Path, register: bool) -> Result<(), String> {
        let root = classes().map_err(|e| e.to_string())?;
        let exe_s = exe.to_string_lossy().to_string();
        let open_cmd = format!("\"{exe_s}\" \"%1\"");
        let dir_cmd = format!("\"{exe_s}\" \"%V\"");
        let icon = format!("\"{exe_s}\",0");
        let shell_keys = ["*", "Directory", "Directory\\Background"];
        if register {
            let r = || -> std::io::Result<()> {
                // ファイルの種類（ProgID）
                set_default(&root, PROG_ID, "Aizome で開くファイル")?;
                set_default(&root, &format!("{PROG_ID}\\DefaultIcon"), &icon)?;
                set_default(&root, &format!("{PROG_ID}\\shell\\open\\command"), &open_cmd)?;
                // 「プログラムから開く」の一覧に出す（いつも使うアプリは変えない）
                let (app, _) = root.create_subkey("Applications\\Aizome.exe")?;
                app.set_value("FriendlyAppName", &"Aizome")?;
                set_default(&root, "Applications\\Aizome.exe\\shell\\open\\command", &open_cmd)?;
                let (types, _) = root.create_subkey("Applications\\Aizome.exe\\SupportedTypes")?;
                for ext in EXTENSIONS {
                    types.set_value(format!(".{ext}"), &"")?;
                    let (owp, _) = root.create_subkey(format!(".{ext}\\OpenWithProgids"))?;
                    owp.set_raw_value(PROG_ID, &RegValue { vtype: REG_NONE, bytes: vec![] })?;
                }
                // 「設定 → アプリ → 既定のアプリ」に Aizome を出す（ここに出ないと、いつも使うアプリに選べないことがある）
                let hkcu = RegKey::predef(HKEY_CURRENT_USER);
                let (cap, _) = hkcu.create_subkey(CAPABILITIES)?;
                cap.set_value("ApplicationName", &APP_NAME)?;
                cap.set_value("ApplicationDescription", &"ローカル AI で補完する、日本語にやさしいコードエディタ")?;
                cap.set_value("ApplicationIcon", &icon)?;
                let (fa, _) = cap.create_subkey("FileAssociations")?;
                for ext in EXTENSIONS {
                    fa.set_value(format!(".{ext}"), &PROG_ID)?;
                }
                let (reg_apps, _) = hkcu.create_subkey(REGISTERED_APPS)?;
                reg_apps.set_value(APP_NAME, &CAPABILITIES)?;
                // ファイルの種類の説明（既定のアプリの画面に出る名前）
                let (pid, _) = root.create_subkey(PROG_ID)?;
                pid.set_value("FriendlyTypeName", &"Aizome で開くファイル")?;
                // 右クリックメニュー：ファイル、フォルダ、フォルダの空いている所
                for key in shell_keys {
                    let cmd = if key == "*" { &open_cmd } else { &dir_cmd };
                    let k = set_default(&root, &format!("{key}\\shell\\Aizome"), "Aizome で開く")?;
                    k.set_value("Icon", &icon)?;
                    set_default(&root, &format!("{key}\\shell\\Aizome\\command"), cmd)?;
                }
                Ok(())
            };
            r().map_err(|e| e.to_string())?;
        } else {
            let _ = root.delete_subkey_all(PROG_ID);
            let _ = root.delete_subkey_all("Applications\\Aizome.exe");
            for ext in EXTENSIONS {
                if let Ok(k) = root.open_subkey_with_flags(format!(".{ext}\\OpenWithProgids"), winreg::enums::KEY_ALL_ACCESS) {
                    let _ = k.delete_value(PROG_ID);
                }
            }
            for key in shell_keys {
                let _ = root.delete_subkey_all(format!("{key}\\shell\\Aizome"));
            }
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let _ = hkcu.delete_subkey_all("Software\\Aizome\\Capabilities");
            if let Ok(k) = hkcu.open_subkey_with_flags(REGISTERED_APPS, winreg::enums::KEY_ALL_ACCESS) {
                let _ = k.delete_value(APP_NAME);
            }
        }
        notify_shell();
        Ok(())
    }

    /// エクスプローラーに関連付けが変わったことを知らせる
    fn notify_shell() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as _, SHCNF_IDLIST as _, std::ptr::null(), std::ptr::null()) };
    }

    pub fn is_registered(exe: &Path) -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(format!("{CLASSES}\\{PROG_ID}\\shell\\open\\command"))
            .and_then(|k| k.get_value::<String, _>(""))
            .map(|v| v.to_lowercase().contains(&exe.to_string_lossy().to_lowercase()))
            .unwrap_or(false)
    }
}

/// 初回起動時（またはアプリの場所が変わったとき）に自動で登録する
pub fn auto_register(app: &AppHandle) {
    #[cfg(windows)]
    {
        let Ok(exe) = std::env::current_exe() else { return };
        // 開発中（target フォルダから起動）は登録しない
        if exe.components().any(|c| c.as_os_str() == "target") {
            return;
        }
        let Ok(dir) = app.path().app_data_dir() else { return };
        let marker = dir.join("os-integration.txt");
        let want = format!("{}|{}", exe.to_string_lossy(), app.package_info().version);
        if std::fs::read_to_string(&marker).ok().as_deref() == Some(want.as_str()) {
            return;
        }
        // 自分で「解除」した人には勝手に登録し直さない
        if std::fs::read_to_string(&marker).map(|s| s == "off").unwrap_or(false) {
            return;
        }
        std::thread::spawn(move || {
            if win::apply(&exe, true).is_ok() {
                let _ = std::fs::create_dir_all(&dir);
                let _ = std::fs::write(&marker, want);
            }
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command(async)]
pub fn os_integration_status() -> IntegrationStatus {
    #[cfg(windows)]
    {
        let registered = std::env::current_exe().map(|e| win::is_registered(&e)).unwrap_or(false);
        return IntegrationStatus { supported: true, registered };
    }
    #[cfg(not(windows))]
    IntegrationStatus { supported: false, registered: true }
}

#[tauri::command]
pub async fn os_integration_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let version = app.package_info().version.to_string();
        return tauri::async_runtime::spawn_blocking(move || {
            win::apply(&exe, enabled)?;
            let _ = std::fs::create_dir_all(&dir);
            let marker = if enabled { format!("{}|{}", exe.to_string_lossy(), version) } else { "off".into() };
            let _ = std::fs::write(dir.join("os-integration.txt"), marker);
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (app, enabled);
        Err("UNSUPPORTED".into())
    }
}

/// Windows の「既定のアプリ」の画面（Aizome のページ）を開く
#[tauri::command(async)]
pub fn os_default_apps() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Windows 11 は Aizome のページを直接、Windows 10 は既定のアプリの画面を開く
        let uri = format!("ms-settings:defaultapps?registeredAppUser={}", win::APP_NAME);
        std::process::Command::new("explorer.exe").arg(uri).creation_flags(0x0800_0000).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    Err("UNSUPPORTED".into())
}

/// 「プログラムから開く」の画面を、その種類のファイルで出す（「常にこのアプリを使う」を選べる）
#[tauri::command(async)]
pub fn os_open_with(app: AppHandle, ext: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let ext: String = ext.trim_start_matches('.').chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        if ext.is_empty() {
            return Err("BAD_EXT".into());
        }
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("open-with");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join(format!("見本.{ext}"));
        if !file.exists() {
            std::fs::write(&file, b"").map_err(|e| e.to_string())?;
        }
        let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let openwith = std::path::Path::new(&sys).join("System32").join("OpenWith.exe");
        let r = if openwith.exists() {
            std::process::Command::new(openwith).arg(&file).spawn()
        } else {
            std::process::Command::new("rundll32.exe").arg("shell32.dll,OpenAs_RunDLL").arg(&file).creation_flags(0x0800_0000).spawn()
        };
        r.map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = (app, ext);
        Err("UNSUPPORTED".into())
    }
}
