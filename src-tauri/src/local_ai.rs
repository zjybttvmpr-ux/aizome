//! PC の中のローカルAI（Ollama）を探して使えるようにする。
//! - 動いている Ollama があればそれを使う
//! - 止まっていれば、インストール場所を探して自動で起動する
//! - USB メモリなどの ollama-models フォルダを見つけたら、そのモデルを読み込んで起動する
//! - 選ばれたモデルファイル（.gguf）を Ollama に取り込む

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

/// Aizome が自分で起動した Ollama（アプリ終了時に止める）
#[derive(Default)]
pub struct LocalAiState {
    managed: Mutex<Option<(Child, u16, PathBuf)>>,
}

impl LocalAiState {
    pub fn shutdown(&self) {
        if let Ok(mut m) = self.managed.lock() {
            if let Some((mut child, _, _)) = m.take() {
                let _ = child.kill();
            }
        }
    }
}

const DEFAULT_PORT: u16 = 11434;
/// 別のモデルフォルダを使うときのポート（いつもの Ollama とぶつからないように）
const MANAGED_PORT: u16 = 11435;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    /// 使えるようになったエンドポイント（使えなければ None）
    endpoint: Option<String>,
    models: Vec<String>,
    /// "running" 動いていた / "started" 起動した / "usb" USB のモデルで起動した / "folder" 選んだフォルダで起動した
    source: String,
    ollama_path: Option<String>,
    models_dir: Option<String>,
    /// 見つかった USB などのモデルフォルダ
    found_dirs: Vec<String>,
    /// 見つかったモデルファイル（.gguf）
    found_gguf: Vec<String>,
    /// OLLAMA_NOT_FOUND / START_FAILED / NO_MODELS など
    error: Option<String>,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(6))
        .build()
        .unwrap_or_default()
}

fn endpoint_of(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn port_of(endpoint: &str) -> Option<u16> {
    endpoint.trim().trim_end_matches('/').rsplit(':').next()?.parse().ok()
}

async fn list_models(endpoint: &str) -> Result<Vec<String>, String> {
    let r = client().get(format!("{}/api/tags", endpoint.trim_end_matches('/'))).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(v.get("models")
        .and_then(|m| m.as_array())
        .map(|a| a.iter().filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from)).collect())
        .unwrap_or_default())
}

async fn wait_ready(endpoint: &str, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if client().get(format!("{endpoint}/api/version")).send().await.map(|r| r.status().is_success()).unwrap_or(false) {
            return true;
        }
        tokio_sleep(Duration::from_millis(300)).await;
    }
    false
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "ollama.exe" } else { "ollama" }
}

/// ollama コマンドの場所を探す
pub fn find_ollama() -> Option<PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(exe_name());
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(Path::new(&local).join("Programs").join("Ollama").join("ollama.exe"));
        }
        for var in ["ProgramFiles", "ProgramW6432"] {
            if let Ok(pf) = std::env::var(var) {
                candidates.push(Path::new(&pf).join("Ollama").join("ollama.exe"));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/ollama"));
        candidates.push(PathBuf::from("/usr/local/bin/ollama"));
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/local/bin/ollama"));
        candidates.push(PathBuf::from("/usr/bin/ollama"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn is_models_dir(p: &Path) -> bool {
    p.join("manifests").is_dir() && p.join("blobs").is_dir()
}

/// USB メモリなど、外付けドライブにある ollama-models フォルダを探す
pub fn find_model_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut check = |p: PathBuf| {
        if is_models_dir(&p) && !out.contains(&p) {
            out.push(p);
        }
    };
    #[cfg(windows)]
    {
        for letter in b'D'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", letter as char));
            if root.exists() {
                check(root.join("ollama-models"));
            }
        }
    }
    #[cfg(not(windows))]
    {
        let user = std::env::var("USER").unwrap_or_default();
        let roots = [
            PathBuf::from("/Volumes"),
            PathBuf::from(format!("/media/{user}")),
            PathBuf::from(format!("/run/media/{user}")),
            PathBuf::from("/media"),
            PathBuf::from("/mnt"),
        ];
        for root in roots {
            if let Ok(rd) = std::fs::read_dir(&root) {
                for e in rd.flatten() {
                    check(e.path().join("ollama-models"));
                }
            }
        }
    }
    out
}

/// USB メモリなどに置かれたモデルファイル（.gguf）を探す（ドライブ直下と models・ai フォルダ）
pub fn find_gguf_files() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        for letter in b'D'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", letter as char));
            if root.exists() {
                roots.push(root);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let user = std::env::var("USER").unwrap_or_default();
        for base in [PathBuf::from("/Volumes"), PathBuf::from(format!("/media/{user}")), PathBuf::from(format!("/run/media/{user}"))] {
            if let Ok(rd) = std::fs::read_dir(&base) {
                roots.extend(rd.flatten().map(|e| e.path()));
            }
        }
    }
    let mut out = Vec::new();
    for root in roots {
        for dir in [root.clone(), root.join("models"), root.join("ai"), root.join("AI"), root.join("gguf")] {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                let is_gguf = p.extension().map(|x| x.to_string_lossy().eq_ignore_ascii_case("gguf")).unwrap_or(false);
                // 分割ファイルの2つ目以降（-00002-of-00003.gguf など）は除く
                let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                let later_part = name.contains("-of-") && !name.contains("-00001-of-");
                if is_gguf && !later_part && p.is_file() && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    out
}

fn hidden(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// ollama serve を起動する（models_dir があればそのモデルを使う）
fn spawn_serve(ollama: &Path, port: u16, models_dir: Option<&Path>) -> Result<Child, String> {
    let mut cmd = Command::new(ollama);
    cmd.arg("serve")
        .env("OLLAMA_HOST", format!("127.0.0.1:{port}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(dir) = models_dir {
        cmd.env("OLLAMA_MODELS", dir);
    }
    hidden(&mut cmd);
    cmd.spawn().map_err(|e| format!("START_FAILED: {e}"))
}

async fn start_managed(state: &LocalAiState, ollama: &Path, port: u16, dir: Option<PathBuf>) -> Result<String, String> {
    // 前に自分で起動したものがあれば止める
    state.shutdown();
    let child = spawn_serve(ollama, port, dir.as_deref())?;
    if let Ok(mut m) = state.managed.lock() {
        *m = Some((child, port, dir.unwrap_or_default()));
    }
    let ep = endpoint_of(port);
    if wait_ready(&ep, Duration::from_secs(20)).await {
        Ok(ep)
    } else {
        state.shutdown();
        Err("START_FAILED: Ollama が応答しませんでした".into())
    }
}

/// PC の中の AI を探して、使える状態にする
#[tauri::command]
pub async fn ai_autodetect(state: State<'_, LocalAiState>, endpoint: String) -> Result<Detected, String> {
    let mut d = Detected { source: "running".into(), ..Default::default() };
    let ollama = find_ollama();
    d.ollama_path = ollama.as_ref().map(|p| p.to_string_lossy().to_string());
    let dirs = find_model_dirs();
    d.found_dirs = dirs.iter().map(|p| p.to_string_lossy().to_string()).collect();
    d.found_gguf = find_gguf_files().iter().map(|p| p.to_string_lossy().to_string()).collect();

    // 1. 設定のエンドポイントで動いているか
    let configured = if endpoint.trim().is_empty() { endpoint_of(DEFAULT_PORT) } else { endpoint.trim().trim_end_matches('/').to_string() };
    let mut candidates = vec![configured.clone()];
    for ep in [endpoint_of(DEFAULT_PORT), endpoint_of(MANAGED_PORT)] {
        if !candidates.contains(&ep) {
            candidates.push(ep);
        }
    }
    let mut running_empty: Option<String> = None;
    for ep in &candidates {
        if let Ok(models) = list_models(ep).await {
            if !models.is_empty() {
                d.endpoint = Some(ep.clone());
                d.models = models;
                return Ok(d);
            }
            running_empty.get_or_insert(ep.clone());
        }
    }

    let Some(ollama) = ollama else {
        d.error = Some("OLLAMA_NOT_FOUND".into());
        d.endpoint = running_empty;
        return Ok(d);
    };

    // 2. USB などにモデルがあれば、それを読み込んで起動する
    if let Some(dir) = dirs.first().cloned() {
        // いつもの Ollama が動いていればぶつからないよう別のポートで
        let port = if running_empty.is_some() { MANAGED_PORT } else { DEFAULT_PORT };
        match start_managed(&state, &ollama, port, Some(dir.clone())).await {
            Ok(ep) => {
                d.models = list_models(&ep).await.unwrap_or_default();
                d.endpoint = Some(ep);
                d.source = "usb".into();
                d.models_dir = Some(dir.to_string_lossy().to_string());
                if d.models.is_empty() {
                    d.error = Some("NO_MODELS".into());
                }
                return Ok(d);
            }
            Err(e) => d.error = Some(e),
        }
    }

    // 3. 止まっていれば起動する
    if running_empty.is_none() {
        match start_managed(&state, &ollama, DEFAULT_PORT, None).await {
            Ok(ep) => {
                d.models = list_models(&ep).await.unwrap_or_default();
                d.endpoint = Some(ep);
                d.source = "started".into();
                if d.models.is_empty() {
                    d.error = Some("NO_MODELS".into());
                }
                return Ok(d);
            }
            Err(e) => {
                d.error = Some(e);
                return Ok(d);
            }
        }
    }

    d.endpoint = running_empty;
    d.error.get_or_insert("NO_MODELS".into());
    Ok(d)
}

/// 選ばれたモデルフォルダ（ollama-models）を使って Ollama を起動する
#[tauri::command]
pub async fn ai_use_models_dir(state: State<'_, LocalAiState>, dir: String) -> Result<Detected, String> {
    let mut path = PathBuf::from(&dir);
    // フォルダの中に ollama-models があればそちらを使う
    if !is_models_dir(&path) && is_models_dir(&path.join("ollama-models")) {
        path = path.join("ollama-models");
    }
    if !is_models_dir(&path) {
        return Err("NOT_MODELS_DIR".into());
    }
    let ollama = find_ollama().ok_or("OLLAMA_NOT_FOUND")?;
    // いつもの Ollama が動いていても使えるよう、別のポートで起動する
    let port = if list_models(&endpoint_of(DEFAULT_PORT)).await.is_ok() { MANAGED_PORT } else { DEFAULT_PORT };
    let ep = start_managed(&state, &ollama, port, Some(path.clone())).await?;
    let models = list_models(&ep).await.unwrap_or_default();
    Ok(Detected {
        error: if models.is_empty() { Some("NO_MODELS".into()) } else { None },
        endpoint: Some(ep),
        models,
        source: "folder".into(),
        ollama_path: Some(ollama.to_string_lossy().to_string()),
        models_dir: Some(path.to_string_lossy().to_string()),
        found_dirs: vec![],
        found_gguf: vec![],
    })
}

/// Qwen2.5-Coder の途中埋め（FIM）用テンプレート。ファイル名から判断できるときだけ付ける
const QWEN_CODER_TEMPLATE: &str = r#"{{- if .Suffix }}<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>
{{- else }}<|im_start|>user
{{ .Prompt }}<|im_end|>
<|im_start|>assistant
{{ end }}"#;

/// モデルファイル（.gguf）を Ollama に取り込む。戻り値は取り込んだモデル名
#[tauri::command]
pub async fn ai_import_gguf(path: String, name: String, endpoint: String) -> Result<String, String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err("FILE_NOT_FOUND".into());
    }
    if file.extension().map(|e| e.to_string_lossy().to_lowercase()) != Some("gguf".into()) {
        return Err("NOT_GGUF".into());
    }
    let ollama = find_ollama().ok_or("OLLAMA_NOT_FOUND")?;
    let safe: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || "._-:".contains(c) { c } else { '-' })
        .collect();
    let model_name = if safe.is_empty() { "my-model".to_string() } else { safe };
    let lower = file.file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
    let port = port_of(&endpoint).unwrap_or(DEFAULT_PORT);

    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::env::temp_dir().join(format!("aizome-import-{}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut modelfile = format!("FROM \"{}\"\n", file.to_string_lossy().replace('\\', "/"));
        if lower.contains("qwen") && lower.contains("coder") {
            modelfile.push_str(&format!("TEMPLATE \"\"\"{QWEN_CODER_TEMPLATE}\"\"\"\n"));
            for stop in ["<|endoftext|>", "<|im_end|>", "<|fim_pad|>", "<|repo_name|>", "<|file_sep|>"] {
                modelfile.push_str(&format!("PARAMETER stop \"{stop}\"\n"));
            }
        }
        let mf = dir.join("Modelfile");
        std::fs::write(&mf, modelfile).map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&ollama);
        cmd.args(["create", &model_name, "-f"])
            .arg(&mf)
            .env("OLLAMA_HOST", format!("127.0.0.1:{port}"))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hidden(&mut cmd);
        let out = cmd.output().map_err(|e| format!("START_FAILED: {e}"))?;
        let _ = std::fs::remove_dir_all(&dir);
        if out.status.success() {
            Ok(model_name)
        } else {
            let err = String::from_utf8_lossy(&out.stderr).to_string();
            Err(format!("IMPORT_FAILED: {}", err.lines().last().unwrap_or("").trim()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
