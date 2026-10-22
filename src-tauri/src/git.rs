//! Git の状態（ブランチ名と変更ファイル）。git コマンドがなければ何も返さない

use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// ワークスペースからの相対パス（区切りは /）
    path: String,
    /// "M" 変更 / "A" 追加 / "D" 削除 / "R" 名前変更 / "U" 未追跡 / "C" 衝突
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    is_repo: bool,
    branch: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<GitFile>,
}

fn git(root: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // コンソール窓を出さない
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn parse_branch(line: &str) -> (Option<String>, u32, u32) {
    // 例: "## main...origin/main [ahead 1, behind 2]" / "## No commits yet on main"
    let rest = line.trim_start_matches("## ");
    let name_part = rest.split(' ').next().unwrap_or("");
    let branch = if rest.starts_with("No commits yet on ") {
        Some(rest.trim_start_matches("No commits yet on ").to_string())
    } else if rest.starts_with("HEAD (no branch)") {
        Some("HEAD".to_string())
    } else {
        name_part.split("...").next().map(String::from)
    };
    let mut ahead = 0;
    let mut behind = 0;
    if let (Some(s), Some(e)) = (rest.find('['), rest.find(']')) {
        for part in rest[s + 1..e].split(", ") {
            if let Some(n) = part.strip_prefix("ahead ") {
                ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                behind = n.parse().unwrap_or(0);
            }
        }
    }
    (branch, ahead, behind)
}

fn classify(xy: &str) -> &'static str {
    let b = xy.as_bytes();
    let (x, y) = (b.first().copied().unwrap_or(b' '), b.get(1).copied().unwrap_or(b' '));
    match (x, y) {
        (b'?', b'?') => "U",
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => "C",
        (b'R', _) => "R",
        (b'A', _) => "A",
        (b'D', _) | (_, b'D') => "D",
        _ => "M",
    }
}

#[tauri::command]
pub async fn git_status(root: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let empty = GitStatus { is_repo: false, branch: None, ahead: 0, behind: 0, files: vec![] };
        let Ok(out) = git(&root).args(["status", "--porcelain=v1", "-b", "--untracked-files=normal"]).output() else {
            return empty;
        };
        if !out.status.success() {
            return empty;
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let mut status = GitStatus { is_repo: true, ..empty };
        for line in text.lines() {
            if line.starts_with("## ") {
                let (b, a, be) = parse_branch(line);
                status.branch = b;
                status.ahead = a;
                status.behind = be;
                continue;
            }
            if line.len() < 4 {
                continue;
            }
            let xy = &line[..2];
            let mut path = line[3..].to_string();
            if let Some(i) = path.find(" -> ") {
                path = path[i + 4..].to_string();
            }
            let path = path.trim_matches('"').to_string();
            status.files.push(GitFile { path, status: classify(xy).to_string() });
        }
        status
    })
    .await
    .map_err(|e| e.to_string())
}
