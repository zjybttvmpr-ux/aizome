//! ユーザーが追加した拡張機能の管理。
//! 置き場所は アプリのデータフォルダ/extensions/<拡張機能ID>/ で、
//! 各フォルダに extension.json（マニフェスト）と main.js（任意）を入れる。

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserExtension {
    dir: String,
    manifest: Value,
    main_source: Option<String>,
    error: Option<String>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn extensions_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?.join("extensions");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !id.starts_with('.')
}

fn read_one(dir: &Path) -> UserExtension {
    let dir_s = dir.to_string_lossy().to_string();
    let manifest_path = dir.join("extension.json");
    let manifest: Value = match fs::read_to_string(&manifest_path).map_err(err).and_then(|s| serde_json::from_str(&s).map_err(err)) {
        Ok(v) => v,
        Err(e) => return UserExtension { dir: dir_s, manifest: Value::Null, main_source: None, error: Some(e) },
    };
    let mut error = None;
    let main_source = manifest.get("main").and_then(|m| m.as_str()).and_then(|main| {
        // 拡張機能フォルダの外を読ませない
        let p = dir.join(main);
        match (p.canonicalize(), dir.canonicalize()) {
            (Ok(p), Ok(d)) if p.starts_with(&d) => fs::read_to_string(p).map_err(|e| error = Some(e.to_string())).ok(),
            _ => {
                error = Some(format!("main が見つかりません: {main}"));
                None
            }
        }
    });
    UserExtension { dir: dir_s, manifest, main_source, error }
}

#[tauri::command]
pub fn ext_dir(app: AppHandle) -> Result<String, String> {
    Ok(extensions_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ext_list(app: AppHandle) -> Result<Vec<UserExtension>, String> {
    let root = extensions_root(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(root).map_err(err)?.flatten() {
        let p = entry.path();
        if p.is_dir() && p.join("extension.json").exists() {
            out.push(read_one(&p));
        }
    }
    Ok(out)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        let name = entry.file_name();
        let n = name.to_string_lossy();
        if n == "node_modules" || n == ".git" {
            continue;
        }
        let src = entry.path();
        let dst = to.join(&name);
        let ft = entry.file_type()?;
        if ft.is_dir() {
            copy_dir(&src, &dst)?;
        } else if ft.is_file() {
            fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// フォルダから拡張機能をコピーして追加する。戻り値は拡張機能ID
#[tauri::command]
pub fn ext_install(app: AppHandle, from: String) -> Result<String, String> {
    let src = PathBuf::from(&from);
    let manifest: Value = serde_json::from_str(&fs::read_to_string(src.join("extension.json")).map_err(|_| "NO_MANIFEST")?).map_err(err)?;
    let id = manifest.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if !valid_id(&id) {
        return Err("INVALID_ID".into());
    }
    let dest = extensions_root(&app)?.join(&id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(err)?;
    }
    copy_dir(&src, &dest).map_err(err)?;
    Ok(id)
}

#[tauri::command]
pub fn ext_uninstall(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("INVALID_ID".into());
    }
    let dest = extensions_root(&app)?.join(&id);
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(err)?;
    }
    Ok(())
}
