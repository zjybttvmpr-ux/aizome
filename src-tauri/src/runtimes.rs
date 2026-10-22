//! 実行に使う言語処理系（いまは Python）を探す。
//! Windows の「python」は、Python が入っていないと Microsoft Store へ案内するだけの
//! 見せかけ（WindowsApps の python.exe）になっていて、実行しても「Python」と出るだけになる。
//! それを避けて、本物の python.exe か py ランチャーを見つける。
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonInfo {
    /// シェルにそのまま書けるコマンド（例：`py -3`、`"C:\...\python.exe"`）。見つからなければ None
    pub command: Option<String>,
    /// 見せかけの python しか無かった
    pub store_stub: bool,
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

#[cfg(windows)]
fn is_windows_apps(dir: &Path) -> bool {
    dir.to_string_lossy().to_lowercase().contains("\\microsoft\\windowsapps")
}

/// Microsoft Store から本物の Python を入れている（この場合は WindowsApps の python が本物につながる）
#[cfg(windows)]
fn store_python_installed() -> bool {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return false };
    let dir = Path::new(&local).join("Microsoft").join("WindowsApps");
    std::fs::read_dir(dir)
        .map(|it| it.flatten().any(|e| e.file_name().to_string_lossy().starts_with("PythonSoftwareFoundation.Python.3")))
        .unwrap_or(false)
}

/// Python3xx のフォルダを新しい順に
#[cfg(windows)]
fn installed_pythons(base: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(u32, PathBuf)> = std::fs::read_dir(base)
        .map(|it| {
            it.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    let ver = name.strip_prefix("python")?;
                    let digits: String = ver.chars().take_while(|c| c.is_ascii_digit()).collect();
                    let n: u32 = digits.parse().ok()?;
                    let exe = e.path().join("python.exe");
                    exe.is_file().then_some((n, exe))
                })
                .collect()
        })
        .unwrap_or_default();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|x| x.1).collect()
}

#[cfg(windows)]
fn quote(p: &Path) -> String {
    format!("\"{}\"", p.display())
}

#[tauri::command(async)]
pub fn find_python() -> PythonInfo {
    #[cfg(windows)]
    {
        let mut stub = false;
        // 1. PATH にある本物の python.exe
        for dir in path_dirs() {
            let exe = dir.join("python.exe");
            if !exe.exists() {
                continue;
            }
            if is_windows_apps(&dir) {
                if store_python_installed() {
                    return PythonInfo { command: Some("python".into()), store_stub: false };
                }
                stub = true;
                continue;
            }
            return PythonInfo { command: Some(quote(&exe)), store_stub: false };
        }
        // 2. py ランチャー
        let windir = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        let py_in_path = path_dirs().into_iter().any(|d| !is_windows_apps(&d) && d.join("py.exe").is_file());
        if py_in_path || windir.join("py.exe").is_file() {
            let cmd = if py_in_path { "py -3".to_string() } else { format!("{} -3", quote(&windir.join("py.exe"))) };
            return PythonInfo { command: Some(cmd), store_stub: false };
        }
        // 3. PATH に入っていないだけの、よくある場所
        let mut bases: Vec<PathBuf> = Vec::new();
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            bases.push(Path::new(&l).join("Programs").join("Python"));
        }
        for v in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(p) = std::env::var_os(v) {
                bases.push(PathBuf::from(p));
            }
        }
        bases.push(PathBuf::from("C:\\"));
        for b in bases {
            if let Some(exe) = installed_pythons(&b).into_iter().next() {
                return PythonInfo { command: Some(quote(&exe)), store_stub: false };
            }
        }
        // Anaconda / Miniconda
        if let Some(home) = std::env::var_os("USERPROFILE") {
            for name in ["anaconda3", "miniconda3", "Anaconda3", "Miniconda3"] {
                let exe = Path::new(&home).join(name).join("python.exe");
                if exe.is_file() {
                    return PythonInfo { command: Some(quote(&exe)), store_stub: false };
                }
            }
        }
        PythonInfo { command: None, store_stub: stub }
    }
    #[cfg(not(windows))]
    {
        for name in ["python3", "python"] {
            if path_dirs().iter().any(|d| d.join(name).is_file()) {
                return PythonInfo { command: Some(name.into()), store_stub: false };
            }
        }
        PythonInfo { command: None, store_stub: false }
    }
}
