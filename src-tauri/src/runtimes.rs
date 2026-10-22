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
fn registry_pythons() -> Vec<(bool, Vec<u32>, PathBuf)> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let mut out: Vec<(bool, Vec<u32>, PathBuf)> = Vec::new();
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
                        // PythonCore ＝ python.org の公式版
                        out.push((company.eq_ignore_ascii_case("PythonCore"), ver, exe));
                    }
                }
            }
        }
    }
    // 公式版を先に、その中では新しい版を先に
    out.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    out
}

/// ほかのアプリに組み込まれた Python（「埋め込み版」）か。
/// 埋め込み版は python3xx._pth というファイルを持ち、ふつうのプログラムの実行には向かない
#[cfg(windows)]
fn is_embedded(exe: &Path) -> bool {
    let Some(dir) = exe.parent() else { return false };
    std::fs::read_dir(dir)
        .map(|it| {
            it.flatten().any(|e| {
                let n = e.file_name().to_string_lossy().to_lowercase();
                n.starts_with("python") && n.ends_with("._pth")
            })
        })
        .unwrap_or(false)
}

/// 本当に Python として動くか、一度だけ試す（3 秒で打ち切り）。動けば版（例：3.12.4）を返す
fn probe(program: &str, pre_args: &[&str]) -> Option<String> {
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    let mut cmd = Command::new(program);
    cmd.args(pre_args)
        .args(["-c", "import sys;print('AIZOME_OK', '.'.join(map(str, sys.version_info[:3])))"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // 黒い画面を出さない
    }
    let mut child = cmd.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut s = String::new();
        let mut r = stdout;
        let _ = r.read_to_string(&mut s);
        let _ = tx.send(s);
    });
    let out = match rx.recv_timeout(std::time::Duration::from_secs(3)) {
        Ok(s) => s,
        Err(_) => {
            let _ = child.kill();
            return None;
        }
    };
    let _ = child.wait();
    let line = out.lines().find(|l| l.starts_with("AIZOME_OK"))?;
    Some(line.trim_start_matches("AIZOME_OK").trim().to_string())
}

/// 試す順番：PATH → py ランチャー → 公式版（レジストリ）→ インストールマネージャー → よくある場所 → その他のレジストリ → Anaconda → Store 版
#[cfg(windows)]
fn candidates() -> (Vec<(String, Vec<String>, String)>, bool) {
    let mut list: Vec<(String, Vec<String>, String)> = Vec::new();
    let mut stub = false;
    let mut push = |exe: PathBuf, src: &str, list: &mut Vec<(String, Vec<String>, String)>| {
        if is_embedded(&exe) {
            return;
        }
        let s = exe.to_string_lossy().to_string();
        if !list.iter().any(|(p, _, _)| p.eq_ignore_ascii_case(&s)) {
            list.push((s, vec![], src.to_string()));
        }
    };
    for dir in path_dirs() {
        let exe = dir.join("python.exe");
        if !exe.exists() {
            continue;
        }
        if is_windows_apps(&dir) {
            if !store_python_installed() {
                stub = true;
            }
            continue;
        }
        push(exe, "PATH", &mut list);
    }
    let windir = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    for py in path_dirs().into_iter().filter(|d| !is_windows_apps(d)).map(|d| d.join("py.exe")).chain([windir.join("py.exe")]) {
        if py.is_file() {
            list.push((py.to_string_lossy().to_string(), vec!["-3".into()], "py ランチャー".into()));
            break;
        }
    }
    let reg = registry_pythons();
    for (_, _, exe) in reg.iter().filter(|r| r.0) {
        push(exe.clone(), "公式版（レジストリ）", &mut list);
    }
    if let Some(exe) = install_manager_python() {
        push(exe, "Python インストールマネージャー", &mut list);
    }
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
        for exe in installed_pythons(&b) {
            push(exe, "よくある場所", &mut list);
        }
    }
    for (_, _, exe) in reg.iter().filter(|r| !r.0) {
        push(exe.clone(), "レジストリ", &mut list);
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        for name in ["anaconda3", "miniconda3", "Anaconda3", "Miniconda3"] {
            push(Path::new(&home).join(name).join("python.exe"), "Anaconda", &mut list);
        }
    }
    if store_python_installed() {
        list.push(("python".into(), vec![], "Microsoft Store 版".into()));
    }
    (list, stub)
}

fn to_cmd(program: &str, args: &[String]) -> String {
    let p = if program.contains(['\\', '/', ' ']) { format!("\"{program}\"") } else { program.to_string() };
    if args.is_empty() { p } else { format!("{p} {}", args.join(" ")) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonCandidate {
    pub command: String,
    pub path: String,
    pub source: String,
    pub version: String,
}

/// 見つかった Python の一覧（実際に動くものだけ）。設定で選ぶとき用
#[tauri::command(async)]
pub fn list_pythons() -> Vec<PythonCandidate> {
    #[cfg(windows)]
    {
        let (list, _) = candidates();
        list.into_iter()
            .filter_map(|(prog, args, src)| {
                let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                let version = probe(&prog, &a)?;
                Some(PythonCandidate { command: to_cmd(&prog, &args), path: prog, source: src, version })
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        ["python3", "python"]
            .iter()
            .filter_map(|n| probe(n, &[]).map(|v| PythonCandidate { command: n.to_string(), path: n.to_string(), source: "PATH".into(), version: v }))
            .collect()
    }
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
        // 見つけた順に、本当に動くかを試して、最初に動いたものを使う
        let (list, stub) = candidates();
        for (prog, args, src) in list.iter().take(10) {
            let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            if probe(prog, &a).is_some() {
                return found(to_cmd(prog, args), src);
            }
        }
        PythonInfo { command: None, store_stub: stub, source: String::new() }
    }
    #[cfg(not(windows))]
    {
        for name in ["python3", "python"] {
            if path_dirs().iter().any(|d| d.join(name).is_file()) && probe(name, &[]).is_some() {
                return found(name.into(), "PATH");
            }
        }
        PythonInfo { command: None, store_stub: false, source: String::new() }
    }
}
