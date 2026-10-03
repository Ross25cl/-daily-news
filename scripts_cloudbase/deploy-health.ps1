# ============================================================
# deploy-health.ps1 — 一键部署 health 云函数（Day 15）
# ------------------------------------------------------------
# ⚠️ 2026-10-03 实测备注：本脚本用 `powershell -File` 调用时会新开一个
#   PowerShell，工作目录丢失，导致相对路径找不到脚本。Day 15 实战改用
#   直接命令，更稳（见 docs/cloudbase-deploy-day15.md 第 2.3 节）：
#       node scripts_cloudbase/normalize-eol.mjs
#       tcb fn deploy health --httpFn -e <环境ID>
#       tcb deploy --only gateway -e <环境ID>   # 关键：配 HTTP 路由
#   本脚本保留作参考，但优先用上面的直接命令。
#
# 前提：已装好 CLI 并登录（见 docs/cloudbase-deploy-day15.md 第 1 步）
# 用法（项目根目录，PowerShell 里执行 .\scripts_cloudbase\deploy-health.ps1 -EnvId xxx）
#
# 脚本做的事，按顺序：
#   1. 检查 tcb 命令在不在
#   2. 把 scf_bootstrap 换行规范成 LF（防 Windows CRLF 坑）
#   3. 把环境 ID 写进项目根 .env（cloudbaserc.json 用 {{env.TCB_ENV_ID}} 读取）
#   4. 部署 health 云函数（--httpFn 表示 HTTP 型）
#   5. 打印函数详情，供你核对
# ============================================================

param(
  [Parameter(Mandatory = $true)]
  [string]$EnvId
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # 项目根目录
Set-Location $root

Write-Host ''
Write-Host '===== 每日体坛速览 · health 云函数部署 =====' -ForegroundColor Cyan
Write-Host "项目根目录：$root"
Write-Host "目标环境：$EnvId"
Write-Host ''

# ---- 1. 检查 CLI ----
Write-Host '[1/5] 检查 CloudBase CLI ...' -ForegroundColor Yellow
$tcb = Get-Command tcb -ErrorAction SilentlyContinue
if (-not $tcb) {
  Write-Host '  ✗ 没找到 tcb 命令。先安装：npm i -g @cloudbase/cli' -ForegroundColor Red
  Write-Host '    安装完再执行：tcb login' -ForegroundColor Red
  exit 1
}
Write-Host "  ✓ 找到：$($tcb.Source)"

# ---- 2. 规范化换行 ----
Write-Host '[2/5] 规范 scf_bootstrap 换行符为 LF ...' -ForegroundColor Yellow
node scripts_cloudbase/normalize-eol.mjs

# ---- 3. 写 .env ----
Write-Host '[3/5] 写入 TCB_ENV_ID 到 .env ...' -ForegroundColor Yellow
$envPath = Join-Path $root '.env'
$envLine = "TCB_ENV_ID=$EnvId"
if (Test-Path $envPath) {
  $content = Get-Content $envPath -Raw
  if ($content -match '(?m)^TCB_ENV_ID=') {
    $content = $content -replace '(?m)^TCB_ENV_ID=.*$', $envLine
  } else {
    $content = $content.TrimEnd() + "`n$envLine`n"
  }
  Set-Content -Path $envPath -Value $content -NoNewline -Encoding UTF8
} else {
  Set-Content -Path $envPath -Value "$envLine`n" -NoNewline -Encoding UTF8
}
Write-Host "  ✓ 已写入 $envPath（该文件被 .gitignore 忽略，不会上传）"

# ---- 4. 部署 ----
Write-Host '[4/5] 部署 health 云函数（HTTP 型）...' -ForegroundColor Yellow
tcb fn deploy health --httpFn -e $EnvId

# ---- 5. 查看详情 ----
Write-Host '[5/5] 拉取函数详情核对 ...' -ForegroundColor Yellow
tcb fn detail health -e $EnvId

Write-Host ''
Write-Host '===== 部署完成 =====' -ForegroundColor Green
Write-Host '下一步：' -ForegroundColor Green
Write-Host '  在浏览器打开云函数访问地址（见 docs/cloudbase-deploy-day15.md 第 3 步），'
Write-Host '  实测地址形如：'
Write-Host '  https://<环境ID>-<hash>.ap-shanghai.app.tcloudbase.com/api/health'
Write-Host '  （<hash> 由网关生成，不是环境 ID；准确地址以 tcb routes list 或控制台为准）'
Write-Host '  应看到：{"ok": true, "service": "Daily Sports Express"}'
Write-Host ''
