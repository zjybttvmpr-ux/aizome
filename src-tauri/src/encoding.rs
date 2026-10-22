//! 文字コードを指定して（または自動で判定して）ファイルを読み書きする
use encoding_rs::{Encoding, EUC_JP, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;
use std::fs;
use std::path::Path;

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedFile {
    pub text: String,
    /// "utf-8" "shift_jis" "euc-jp" "utf-16le" "utf-16be"
    pub encoding: String,
    pub bom: bool,
    /// 読めない文字があって、置き換えて読んだ
    pub lossy: bool,
    /// "crlf" か "lf"
    pub eol: String,
}

fn err(e: std::io::Error) -> String {
    e.to_string()
}

fn label_of(enc: &'static Encoding) -> String {
    if enc == SHIFT_JIS {
        "shift_jis".into()
    } else if enc == EUC_JP {
        "euc-jp".into()
    } else if enc == UTF_16LE {
        "utf-16le".into()
    } else if enc == UTF_16BE {
        "utf-16be".into()
    } else {
        enc.name().to_ascii_lowercase()
    }
}

fn decode_with(enc: &'static Encoding, bytes: &[u8]) -> (String, bool) {
    let (text, had_errors) = enc.decode_without_bom_handling(bytes);
    (text.into_owned(), had_errors)
}

fn find_encoding(label: &str) -> Option<&'static Encoding> {
    match label.to_ascii_lowercase().as_str() {
        "utf-8" | "utf8" | "utf-8-bom" => Some(UTF_8),
        "shift_jis" | "sjis" | "cp932" | "windows-31j" => Some(SHIFT_JIS),
        "euc-jp" | "eucjp" => Some(EUC_JP),
        "utf-16le" | "utf-16" => Some(UTF_16LE),
        "utf-16be" => Some(UTF_16BE),
        other => Encoding::for_label(other.as_bytes()),
    }
}

fn detect_eol(text: &str) -> String {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count();
    if crlf > 0 && crlf * 2 >= lf { "crlf".into() } else { "lf".into() }
}

/// encoding が空なら自動で判定する（BOM → UTF-8 として正しいか → guess なら Shift_JIS・EUC-JP）
#[tauri::command(async)]
pub fn fs_read_file_enc(path: String, encoding: Option<String>, guess: Option<bool>) -> Result<DecodedFile, String> {
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("FILE_TOO_LARGE".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    let finish = |text: String, enc: String, bom: bool, lossy: bool| {
        let eol = detect_eol(&text);
        Ok(DecodedFile { text, encoding: enc, bom, lossy, eol })
    };
    // 指定されたとき
    if let Some(label) = encoding.filter(|l| !l.is_empty()) {
        let enc = find_encoding(&label).ok_or_else(|| format!("UNKNOWN_ENCODING: {label}"))?;
        let (body, bom) = strip_bom(enc, &bytes);
        let (text, lossy) = decode_with(enc, body);
        return finish(text, label_of(enc), bom, lossy);
    }
    // BOM
    if let Some((enc, len)) = Encoding::for_bom(&bytes) {
        let (text, lossy) = decode_with(enc, &bytes[len..]);
        return finish(text, label_of(enc), true, lossy);
    }
    let head = &bytes[..bytes.len().min(8192)];
    if head.contains(&0) {
        return Err("BINARY_FILE".into());
    }
    if let Ok(s) = std::str::from_utf8(&bytes) {
        return finish(s.to_string(), "utf-8".into(), false, false);
    }
    if guess.unwrap_or(true) {
        for enc in [SHIFT_JIS, EUC_JP] {
            let (text, had_errors) = decode_with(enc, &bytes);
            if !had_errors {
                return finish(text, label_of(enc), false, false);
            }
        }
    }
    let (text, lossy) = decode_with(UTF_8, &bytes);
    finish(text, "utf-8".into(), false, lossy)
}

fn strip_bom<'a>(enc: &'static Encoding, bytes: &'a [u8]) -> (&'a [u8], bool) {
    if let Some((found, len)) = Encoding::for_bom(bytes) {
        if found == enc {
            return (&bytes[len..], true);
        }
    }
    (bytes, false)
}

/// その文字コードで書けない文字があれば、最初のいくつかを返す
fn unmappable(enc: &'static Encoding, text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for ch in text.chars() {
        if ch.is_ascii() {
            continue;
        }
        let mut buf = [0u8; 4];
        let (_, _, had_errors) = enc.encode(ch.encode_utf8(&mut buf));
        if had_errors && !out.iter().any(|c: &String| c == &ch.to_string()) {
            out.push(ch.to_string());
            if out.len() >= 8 {
                break;
            }
        }
    }
    out
}

#[tauri::command(async)]
pub fn fs_write_file_enc(path: String, content: String, encoding: String, bom: bool, eol: Option<String>) -> Result<(), String> {
    let text = if eol.as_deref() == Some("crlf") { content.replace("\r\n", "\n").replace('\n', "\r\n") } else { content };
    let enc = find_encoding(&encoding).ok_or_else(|| format!("UNKNOWN_ENCODING: {encoding}"))?;
    let bytes: Vec<u8> = if enc == UTF_16LE || enc == UTF_16BE {
        // encoding_rs は UTF-16 への書き出しをしないので、自分で並べる
        let mut v = Vec::with_capacity(text.len() * 2 + 2);
        let le = enc == UTF_16LE;
        if bom {
            v.extend_from_slice(if le { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
        }
        for u in text.encode_utf16() {
            v.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() });
        }
        v
    } else if enc == UTF_8 {
        let mut v = Vec::with_capacity(text.len() + 3);
        if bom {
            v.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        v.extend_from_slice(text.as_bytes());
        v
    } else {
        let (encoded, _, had_errors) = enc.encode(&text);
        if had_errors {
            return Err(format!("UNMAPPABLE: {}", unmappable(enc, &text).join(" ")));
        }
        encoded.into_owned()
    };
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(&path, bytes).map_err(err)
}
