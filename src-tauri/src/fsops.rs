//! ファイル操作。フロントエンドからはすべてここを経由する。

use serde::Serialize;
use std::fs;
use std::path::Path;

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

/// クイックオープン用の走査で中に入らないフォルダ
const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__",
    ".next", ".cache", ".idea", ".gradle", "vendor",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command(async)]
pub fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(err)? {
        let Ok(entry) = entry else { continue };
        let p = entry.path();
        let is_dir = p.is_dir();
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: p.to_string_lossy().to_string(),
            is_dir,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// ワークスペース内のファイルを列挙する（クイックオープン用）
#[tauri::command(async)]
pub fn fs_walk(root: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(20_000);
    let mut out = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(&root)];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(entry.path());
                }
            } else if ft.is_file() {
                out.push(entry.path().to_string_lossy().to_string());
                if out.len() >= limit {
                    return Ok(out);
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn fs_read_file(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("FILE_TOO_LARGE".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    let head = &bytes[..bytes.len().min(8192)];
    if head.contains(&0) {
        return Err("BINARY_FILE".into());
    }
    match String::from_utf8(bytes) {
        Ok(s) => Ok(s),
        Err(e) => Ok(String::from_utf8_lossy(e.as_bytes()).to_string()),
    }
}

#[tauri::command(async)]
pub fn fs_write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(&path, content).map_err(err)
}

#[tauri::command(async)]
pub fn fs_create_file(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("ALREADY_EXISTS".into());
    }
    fs_write_file(path, String::new())
}

#[tauri::command(async)]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("ALREADY_EXISTS".into());
    }
    fs::create_dir_all(&path).map_err(err)
}

#[tauri::command(async)]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("ALREADY_EXISTS".into());
    }
    fs::rename(&from, &to).map_err(err)
}

#[tauri::command(async)]
pub fn fs_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(err)
    } else {
        fs::remove_file(p).map_err(err)
    }
}

#[tauri::command(async)]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command(async)]
pub fn fs_is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// 画像ファイルを data: URL として読む（背景画像用）
#[tauri::command(async)]
pub fn fs_read_data_url(path: String) -> Result<String, String> {
    use base64::Engine;
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > 40 * 1024 * 1024 {
        return Err("FILE_TOO_LARGE".into());
    }
    let ext = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return Err("NOT_AN_IMAGE".into()),
    };
    let bytes = fs::read(&path).map_err(err)?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
