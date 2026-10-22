//! ローカルAIへの中継。Ollama と OpenAI 互換サーバー（llama.cpp server、LM Studio など）に対応。
//! ブラウザ側から直接呼ぶと CORS で弾かれるため、Rust 側でリクエストして結果をイベントで流す。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AiState {
    next: AtomicU32,
    tasks: Mutex<HashMap<u32, JoinHandle<()>>>,
    client: reqwest::Client,
}

impl AiState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .build()
            .unwrap_or_default();
        Self { next: AtomicU32::new(0), tasks: Mutex::new(HashMap::new()), client }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    /// "ollama" または "openai"
    provider: String,
    endpoint: String,
    model: String,
    prompt: String,
    /// カーソル後ろのコード。あれば FIM（途中埋め）として送る
    suffix: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    stop: Option<Vec<String>>,
    api_key: Option<String>,
    /// 同じ言葉の繰り返しを抑える強さ（1.0 で無効）
    repeat_penalty: Option<f32>,
}

#[derive(Clone, Serialize)]
struct Chunk {
    id: u32,
    text: String,
    done: bool,
    error: Option<String>,
}

fn base(endpoint: &str) -> String {
    endpoint.trim().trim_end_matches('/').to_string()
}

fn openai_url(endpoint: &str, path: &str) -> String {
    let b = base(endpoint);
    if b.ends_with("/v1") { format!("{b}{path}") } else { format!("{b}/v1{path}") }
}

fn emit_text(app: &AppHandle, id: u32, text: &str) {
    if !text.is_empty() {
        let _ = app.emit("ai:chunk", Chunk { id, text: text.to_string(), done: false, error: None });
    }
}

async fn run(app: &AppHandle, client: &reqwest::Client, id: u32, req: AiRequest) -> Result<(), String> {
    let max_tokens = req.max_tokens.unwrap_or(128);
    let temperature = req.temperature.unwrap_or(0.2);
    let stop = req.stop.clone().unwrap_or_default();
    let is_ollama = req.provider != "openai";

    let mut builder = if is_ollama {
        let mut body = json!({
            "model": req.model,
            "prompt": req.prompt,
            "stream": true,
            "options": {
                "num_predict": max_tokens,
                "temperature": temperature,
                "stop": stop,
                "repeat_penalty": req.repeat_penalty.unwrap_or(1.1),
                "repeat_last_n": 128
            }
        });
        if let Some(s) = &req.suffix {
            body["suffix"] = json!(s);
        }
        client.post(format!("{}/api/generate", base(&req.endpoint))).json(&body)
    } else {
        let mut body = json!({
            "model": req.model,
            "prompt": req.prompt,
            "stream": true,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "frequency_penalty": ((req.repeat_penalty.unwrap_or(1.1) - 1.0) * 3.0).clamp(0.0, 1.0),
        });
        if !stop.is_empty() {
            body["stop"] = json!(stop);
        }
        if let Some(s) = &req.suffix {
            body["suffix"] = json!(s);
        }
        client.post(openai_url(&req.endpoint, "/completions")).json(&body)
    };
    if let Some(key) = req.api_key.as_ref().filter(|k| !k.is_empty()) {
        builder = builder.bearer_auth(key);
    }

    let resp = builder.send().await.map_err(|e| format!("CONNECT_FAILED: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {}", body.chars().take(300).collect::<String>()));
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if is_ollama {
                let v: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
                if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
                    return Err(e.to_string());
                }
                if let Some(t) = v.get("response").and_then(|t| t.as_str()) {
                    emit_text(app, id, t);
                }
                if v.get("done").and_then(|d| d.as_bool()) == Some(true) {
                    return Ok(());
                }
            } else {
                let Some(data) = line.strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    return Ok(());
                }
                let v: Value = serde_json::from_str(data).map_err(|e| e.to_string())?;
                if let Some(t) = v.pointer("/choices/0/text").and_then(|t| t.as_str()) {
                    emit_text(app, id, t);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ai_complete(app: AppHandle, state: State<'_, AiState>, req: AiRequest) -> Result<u32, String> {
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let client = state.client.clone();
    let mut tasks = state.tasks.lock().map_err(|e| e.to_string())?;
    let app2 = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let result = run(&app2, &client, id, req).await;
        let _ = app2.emit("ai:chunk", Chunk { id, text: String::new(), done: true, error: result.err() });
        if let Ok(mut t) = app2.state::<AiState>().tasks.lock() {
            t.remove(&id);
        }
    });
    tasks.insert(id, handle);
    Ok(id)
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, id: u32) -> Result<(), String> {
    if let Some(h) = state.tasks.lock().map_err(|e| e.to_string())?.remove(&id) {
        h.abort();
    }
    Ok(())
}

/// サーバーにあるモデル名の一覧
#[tauri::command]
pub async fn ai_models(state: State<'_, AiState>, provider: String, endpoint: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    let is_ollama = provider != "openai";
    let url = if is_ollama { format!("{}/api/tags", base(&endpoint)) } else { openai_url(&endpoint, "/models") };
    let mut req = state.client.get(url).timeout(Duration::from_secs(6));
    if let Some(key) = api_key.as_ref().filter(|k| !k.is_empty()) {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await.map_err(|e| format!("CONNECT_FAILED: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let list = if is_ollama { v.get("models") } else { v.get("data") };
    let key = if is_ollama { "name" } else { "id" };
    Ok(list
        .and_then(|l| l.as_array())
        .map(|arr| arr.iter().filter_map(|m| m.get(key).and_then(|n| n.as_str()).map(String::from)).collect())
        .unwrap_or_default())
}
