//! ワークスペース全体の文字列検索

use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__",
    ".next", ".cache", ".idea", ".gradle", "vendor",
];
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    line: usize,
    col: usize,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    hits: Vec<SearchHit>,
    truncated: bool,
    files_searched: usize,
}

#[tauri::command]
pub async fn fs_search(
    root: String,
    query: String,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    limit: Option<usize>,
) -> Result<SearchResult, String> {
    // 重い処理なので別スレッドで行う
    tauri::async_runtime::spawn_blocking(move || search(root, query, regex, case_sensitive, whole_word, limit.unwrap_or(2000)))
        .await
        .map_err(|e| e.to_string())?
}

fn search(root: String, query: String, is_regex: bool, case_sensitive: bool, whole_word: bool, limit: usize) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult { hits: vec![], truncated: false, files_searched: 0 });
    }
    let mut pattern = if is_regex { query.clone() } else { regex::escape(&query) };
    if whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("INVALID_REGEX: {e}"))?;

    let mut hits = Vec::new();
    let mut files = 0usize;
    let mut stack = vec![PathBuf::from(&root)];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().to_string();
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(entry.path());
                }
                continue;
            }
            if !ft.is_file() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            let Ok(bytes) = fs::read(entry.path()) else { continue };
            if bytes[..bytes.len().min(4096)].contains(&0) {
                continue;
            }
            files += 1;
            let text = String::from_utf8_lossy(&bytes);
            for (i, line) in text.lines().enumerate() {
                if let Some(m) = re.find(line) {
                    let col = line[..m.start()].chars().count() + 1;
                    let shown: String = line.trim_start().chars().take(240).collect();
                    hits.push(SearchHit { path: entry.path().to_string_lossy().to_string(), line: i + 1, col, text: shown });
                    if hits.len() >= limit {
                        return Ok(SearchResult { hits, truncated: true, files_searched: files });
                    }
                }
            }
        }
    }
    Ok(SearchResult { hits, truncated: false, files_searched: files })
}
