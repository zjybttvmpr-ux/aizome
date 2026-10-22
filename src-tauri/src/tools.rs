//! コンパイラなどの道具（go・gcc・rustc・dotnet・java など）を探す。
//! winget で入れた直後は、あいぞめが起動したときの PATH に入っていないので、
//! レジストリに書かれた最新の PATH と、よくある場所も探す。
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    /// 見つかった実行ファイル
    pub path: String,
    /// そのフォルダ
    pub dir: String,
    /// あいぞめの PATH にすでに入っているか（入っていなければ、実行前に PATH に足す）
    pub in_path: bool,
}

fn process_path() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

#[cfg(windows)]
fn registry_path() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let mut out = Vec::new();
    let keys = [
        (HKEY_LOCAL_MACHINE, "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
        (HKEY_CURRENT_USER, "Environment"),
    ];
    for (root, sub) in keys {
        if let Ok(k) = RegKey::predef(root).open_subkey(sub) {
            if let Ok(v) = k.get_value::<String, _>("Path") {
                for part in v.split(';') {
                    let expanded = expand_env(part.trim());
                    if !expanded.is_empty() {
                        out.push(PathBuf::from(expanded));
                    }
                }
            }
        }
    }
    out
}

#[cfg(windows)]
fn expand_env(s: &str) -> String {
    // %USERPROFILE% のような書き方を展開する
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        if let Some(j) = after.find('%') {
            let name = &after[..j];
            out.push_str(&std::env::var(name).unwrap_or_default());
            rest = &after[j + 1..];
        } else {
            out.push_str(&rest[i..]);
            rest = "";
        }
    }
    out.push_str(rest);
    out
}

#[cfg(not(windows))]
fn registry_path() -> Vec<PathBuf> {
    Vec::new()
}

#[allow(dead_code)]
/// フォルダの中の、名前が prefix で始まるフォルダ（jdk-21… など）
fn subdirs_starting(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .filter(|e| e.path().is_dir() && e.file_name().to_string_lossy().to_lowercase().starts_with(&prefix.to_lowercase()))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v.reverse(); // 新しい版を先に
    v
}

fn common_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    if let Some(home) = env("USERPROFILE").or_else(|| env("HOME")) {
        v.push(home.join(".cargo").join("bin"));
        v.push(home.join("go").join("bin"));
        v.push(home.join(".dotnet"));
    }
    #[cfg(windows)]
    {
        for pf in [env("ProgramFiles"), env("ProgramFiles(x86)")].into_iter().flatten() {
            v.push(pf.join("Go").join("bin"));
            v.push(pf.join("dotnet"));
            for vendor in ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Amazon Corretto"] {
                for jdk in subdirs_starting(&pf.join(vendor), "jdk") {
                    v.push(jdk.join("bin"));
                }
            }
            v.push(pf.join("LLVM").join("bin"));
            v.push(pf.join("mingw64").join("bin"));
        }
        for d in ["C:\\msys64\\ucrt64\\bin", "C:\\msys64\\mingw64\\bin", "C:\\MinGW\\bin", "C:\\mingw64\\bin", "C:\\TDM-GCC-64\\bin", "C:\\Go\\bin"] {
            v.push(PathBuf::from(d));
        }
        if let Some(local) = env("LOCALAPPDATA") {
            // winget で入れた WinLibs（gcc）
            let pkgs = local.join("Microsoft").join("WinGet").join("Packages");
            for p in subdirs_starting(&pkgs, "BrechtSanders.WinLibs") {
                v.push(p.join("mingw64").join("bin"));
                v.push(p.join("mingw32").join("bin"));
            }
            v.push(local.join("Programs").join("Go").join("bin"));
        }
    }
    #[cfg(not(windows))]
    {
        for d in ["/usr/local/go/bin", "/opt/homebrew/bin", "/usr/local/bin"] {
            v.push(PathBuf::from(d));
        }
    }
    v
}

fn exe_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.cmd"), format!("{name}.bat")]
    } else {
        vec![name.to_string()]
    }
}

/// names のどれか（gcc / cc など）を探す
#[tauri::command(async)]
pub fn find_tool(names: Vec<String>) -> Option<ToolInfo> {
    let proc_dirs = process_path();
    let mut dirs: Vec<(PathBuf, bool)> = proc_dirs.iter().map(|d| (d.clone(), true)).collect();
    for d in registry_path().into_iter().chain(common_dirs()) {
        if !dirs.iter().any(|(x, _)| x == &d) {
            dirs.push((d, false));
        }
    }
    for name in &names {
        for (dir, in_path) in &dirs {
            #[cfg(windows)]
            if dir.to_string_lossy().to_lowercase().contains("\\microsoft\\windowsapps") {
                continue;
            }
            for exe in exe_names(name) {
                let p = dir.join(&exe);
                if p.is_file() {
                    return Some(ToolInfo { path: p.to_string_lossy().into_owned(), dir: dir.to_string_lossy().into_owned(), in_path: *in_path });
                }
            }
        }
    }
    None
}
