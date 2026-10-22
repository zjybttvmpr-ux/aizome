// コピー履歴：アプリの外でコピーしたものも含めて、クリップボードの文字が変わったら画面側へ知らせる。
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
fn sequence() -> Option<u32> {
    // クリップボードを開かずに「変わったか」だけ調べる（ほかのアプリのコピーを邪魔しない）
    Some(unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() })
}

#[cfg(not(windows))]
fn sequence() -> Option<u32> {
    None
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut board: Option<arboard::Clipboard> = None;
        let mut last_text: Option<String> = None;
        let mut last_seq: Option<u32> = None;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let seq = sequence();
            if seq.is_some() && seq == last_seq {
                continue;
            }
            if board.is_none() {
                board = arboard::Clipboard::new().ok();
                if board.is_none() {
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            }
            let text = match board.as_mut().map(|b| b.get_text()) {
                Some(Ok(t)) => t,
                _ => {
                    // 文字ではないもの（画像など）か、ほかのアプリが使用中
                    last_seq = seq;
                    continue;
                }
            };
            last_seq = seq;
            if last_text.as_deref() == Some(text.as_str()) {
                continue;
            }
            last_text = Some(text.clone());
            if text.trim().is_empty() || text.len() > 200_000 {
                continue;
            }
            let _ = app.emit("clipboard:changed", text);
        }
    });
}
