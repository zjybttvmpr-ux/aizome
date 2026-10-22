//! 疑似端末（PTY）。本物のシェルを起動し、入出力をフロントエンドへ中継する。

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, Serialize)]
struct DataPayload {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    id: u32,
    code: Option<u32>,
}

pub fn default_shell() -> String {
    #[cfg(windows)]
    {
        let has_pwsh = std::process::Command::new("where")
            .arg("pwsh")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if has_pwsh { "pwsh.exe".into() } else { "powershell.exe".into() }
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

/// 末尾で途切れた UTF-8 の手前までの長さを返す（文字化け防止）
fn utf8_valid_prefix(b: &[u8]) -> usize {
    match std::str::from_utf8(b) {
        Ok(_) => b.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => b.len(),
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;

    let shell = shell.filter(|s| !s.trim().is_empty()).unwrap_or_else(default_shell);
    let mut parts = shell.split_whitespace();
    let program = parts.next().unwrap_or("sh");
    let mut cmd = CommandBuilder::new(program);
    for a in parts {
        cmd.arg(a);
    }
    match cwd.filter(|c| Path::new(c).is_dir()) {
        Some(c) => cmd.cwd(c),
        None => cmd.cwd(crate::fsops::home_dir()),
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Aizome");

    let child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;

    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    state
        .sessions
        .lock()
        .map_err(err)?
        .insert(id, Session { master: pair.master, writer, child });

    // 出力の読み取り
    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let valid = utf8_valid_prefix(&pending);
                    if valid > 0 {
                        let data = String::from_utf8_lossy(&pending[..valid]).to_string();
                        pending.drain(..valid);
                        let _ = app_out.emit("pty:data", DataPayload { id, data });
                    }
                }
            }
        }
    });

    // 終了の監視（Windows の ConPTY は読み取り側に EOF が届かないことがあるため別スレッドで見る）
    let app_exit = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(300));
        let st = app_exit.state::<PtyState>();
        let mut sessions = match st.sessions.lock() {
            Ok(s) => s,
            Err(_) => break,
        };
        let Some(session) = sessions.get_mut(&id) else { break };
        if let Ok(Some(status)) = session.child.try_wait() {
            sessions.remove(&id);
            drop(sessions);
            let _ = app_exit.emit("pty:exit", ExitPayload { id, code: Some(status.exit_code()) });
            break;
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(err)?;
    let s = sessions.get_mut(&id).ok_or("NO_SESSION")?;
    s.writer.write_all(data.as_bytes()).map_err(err)?;
    s.writer.flush().map_err(err)
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(err)?;
    let s = sessions.get(&id).ok_or("NO_SESSION")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) -> Result<(), String> {
    let removed = state.sessions.lock().map_err(err)?.remove(&id);
    if let Some(mut s) = removed {
        let _ = s.child.kill();
    }
    Ok(())
}
