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
    /// どこで見つけたか（表示用）
    pub source: String,
}

fn found(cmd: String, source: &str) -> PythonInfo {
    PythonInfo { command: Some(cmd), store_stub: false, source: source.into() }
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

#[cfg(windows)]
fn is_windows_apps(dir: &Path) -> bool {
    dir.to_string_lossy().to_lowercase().contains("\\microsoft\\windowsapps")
}

/// Microsoft Store から本物の Python（または Python インストールマネージャー）を入れている
/// （この場合は WindowsApps の python が本物につながる）
#[cfg(windows)]
fn store_python_installed() -> bool {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return false };
    let dir = Path::new(&local).join("Microsoft").join("WindowsApps");
    std::fs::read_dir(dir)
        .map(|it| it.flatten().any(|e| e.file_name().to_string_lossy().starts_with("PythonSoftwareFoundation.")))
        .unwrap_or(false)
}

#[cfg(windows)]
fn exists_loose(p: &Path) -> bool {
    // WindowsApps の「アプリ実行エイリアス」は普通のファイルとして見えないことがあるので、リンクとしても確かめる
    p.is_file() || std::fs::symlink_metadata(p).is_ok()
}

/// Windows のレジストリ（PEP 514）に記録された Python。VS Code や py ランチャーと同じ探し方。
/// 好きな場所（D ドライブなど）に入れて PATH に入れていなくても見つかる
#[cfg(windows)]
fn registry_pythons() -> Vec<(Vec<u32>, PathBuf)> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let mut out: Vec<(Vec<u32>, PathBuf)> = Vec::new();
    let roots = [
        (HKEY_CURRENT_USER, "Software\\Python"),
        (HKEY_LOCAL_MACHINE, "Software\\Python"),
        (HKEY_LOCAL_MACHINE, "Software\\WOW6432Node\\Python"),
    ];
    for (hive, path) in roots {
        let Ok(python) = RegKey::predef(hive).open_subkey(path) else { continue };
        for company in python.enum_keys().flatten() {
            if company.eq_ignore_ascii_case("PyLauncher") {
                continue;
            }
            let Ok(ck) = python.open_subkey(&company) else { continue };
            for tag in ck.enum_keys().flatten() {
                let Ok(ip) = ck.open_subkey(format!("{tag}\\InstallPath")) else { continue };
                let exe = ip
                    .get_value::<String, _>("ExecutablePath")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .map(PathBuf::from)
                    .or_else(|| ip.get_value::<String, _>("").ok().filter(|s| !s.is_empty()).map(|d| Path::new(&d).join("python.exe")));
                if let Some(exe) = exe {
                    if exists_loose(&exe) {
                        let ver: Vec<u32> = tag.split(|c: char| !c.is_ascii_digit()).filter_map(|s| s.parse().ok()).collect();
                        out.push((ver, exe));
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

/// 新しい「Python インストールマネージャー」（python.org の Windows 版の既定）で入れた Python
#[cfg(windows)]
fn install_manager_python() -> Option<PathBuf> {
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA")?);
    let base = local.join("Python");
    let bin = base.join("bin").join("python.exe");
    if exists_loose(&bin) {
        return Some(bin);
    }
    let mut found: Vec<(Vec<u32>, PathBuf)> = std::fs::read_dir(&base)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if !name.starts_with("pythoncore-") {
                return None;
            }
            let exe = e.path().join("python.exe");
            let ver: Vec<u32> = name.split(|c: char| !c.is_ascii_digit()).filter_map(|s| s.parse().ok()).collect();
            exe.is_file().then_some((ver, exe))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().next().map(|x| x.1)
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
pub fn find_python(preferred: Option<String>) -> PythonInfo {
    // 0. 設定で場所を指定しているとき
    if let Some(p) = preferred.filter(|p| !p.trim().is_empty()) {
        let path = PathBuf::from(p.trim().trim_matches('"'));
        if path.is_file() {
            return found(format!("\"{}\"", path.display()), "設定で指定した場所");
        }
    }
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
                    return found("python".into(), "Microsoft Store 版");
                }
                stub = true;
                continue;
            }
            return found(quote(&exe), "PATH");
        }
        // 1.5 レジストリに記録された Python（D ドライブなど、好きな場所に入れたものも）
        if let Some((_, exe)) = registry_pythons().into_iter().next() {
            return found(quote(&exe), "レジストリ");
        }
        // 1.6 Python インストールマネージャー
        if let Some(exe) = install_manager_python() {
            return found(quote(&exe), "Python インストールマネージャー");
        }
        // 2. py ランチャー
        let windir = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        let py_in_path = path_dirs().into_iter().any(|d| !is_windows_apps(&d) && d.join("py.exe").is_file());
        if py_in_path || windir.join("py.exe").is_file() {
            let cmd = if py_in_path { "py -3".to_string() } else { format!("{} -3", quote(&windir.join("py.exe"))) };
            return found(cmd, "py ランチャー");
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
                return found(quote(&exe), "よくある場所");
            }
        }
        // Anaconda / Miniconda
        if let Some(home) = std::env::var_os("USERPROFILE") {
            for name in ["anaconda3", "miniconda3", "Anaconda3", "Miniconda3"] {
                let exe = Path::new(&home).join(name).join("python.exe");
                if exe.is_file() {
                    return found(quote(&exe), "Anaconda");
                }
            }
        }
        // 最後に：Store 版がありそうなら python に任せる
        if store_python_installed() {
            return found("python".into(), "Microsoft Store 版");
        }
        PythonInfo { command: None, store_stub: stub, source: String::new() }
    }
    #[cfg(not(windows))]
    {
        for name in ["python3", "python"] {
            if path_dirs().iter().any(|d| d.join(name).is_file()) {
                return found(name.into(), "PATH");
            }
        }
        PythonInfo { command: None, store_stub: false, source: String::new() }
    }
}
