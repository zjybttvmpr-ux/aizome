# Windows 版に同梱する ConPTY（conpty.dll と OpenConsole.exe）を取ってくる。
# Windows 10 の古い ConPTY では日本語などの幅の広い文字が 2 回ずつ表示されるため、
# Windows Terminal と同じ新しい ConPTY（Microsoft 公式・MIT ライセンス）を使う。
$ErrorActionPreference = "Stop"
$base = "https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty"
$versions = (Invoke-RestMethod "$base/index.json").versions | Where-Object { $_ -notmatch "-" }
$ver = $versions[-1]
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "aizome-conpty"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest "$base/$ver/microsoft.windows.console.conpty.$ver.nupkg" -OutFile "$tmp\pkg.zip"
Expand-Archive "$tmp\pkg.zip" "$tmp\pkg" -Force
Write-Host "ConPTY $ver の中身:"
Get-ChildItem -Recurse "$tmp\pkg" -Include conpty.dll, OpenConsole.exe | ForEach-Object { Write-Host "  $($_.FullName)" }
$dll = Get-ChildItem -Recurse "$tmp\pkg" -Filter conpty.dll | Where-Object { $_.FullName -match "x64" } | Select-Object -First 1
$exe = Get-ChildItem -Recurse "$tmp\pkg" -Filter OpenConsole.exe | Where-Object { $_.FullName -match "x64" } | Select-Object -First 1
if (-not $dll -or -not $exe) { throw "conpty.dll / OpenConsole.exe (x64) が見つかりません" }
$out = Join-Path $PSScriptRoot "..\src-tauri\conpty"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $dll.FullName (Join-Path $out "conpty.dll") -Force
Copy-Item $exe.FullName (Join-Path $out "OpenConsole.exe") -Force
Write-Host "コピーしました: $($dll.FullName) / $($exe.FullName)"
