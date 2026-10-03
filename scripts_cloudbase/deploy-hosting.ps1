# ============================================================
# deploy-hosting.ps1 — 把前端静态页部署到 CloudBase 静态托管（Day 15）
# ------------------------------------------------------------
# 用法（项目根目录，PowerShell）：
#     powershell -ExecutionPolicy Bypass -File scripts_cloudbase/deploy-hosting.ps1 -EnvId 你的环境ID
#
# 为什么要排除文件：本项目根目录混着文档（.md）、工具、云函数源码、
#   git 元数据。静态托管只该上传「用户浏览器要的东西」：
#     *.html / css/ / js/ / data/
#   上传多余文件不仅没必要，scf_bootstrap 之类进静态目录还会让人困惑。
#
# 做法：先复制成一个临时发布目录（只含要上线的内容），再对那个目录 deploy。
#
# ---- 实测备注（Day 15）----
# 1) 本脚本本次实际上没跑通：套壳 powershell -File 会新开进程并把工作目录
#    重置为 C:\Users\XH，于是 Split-Path -Parent $PSScriptRoot 取到空值。
#    真正落地用的是手动三步（见 docs/cloudbase-deploy-day15.md 4.2）：
#      复制 html/css/js/data → 目录 → tcb hosting deploy <目录> -e <envId>
#    结论：脚本留着当参考，跑之前先确认当前目录就是项目根目录。
# 2) 实测可用地址形如：
#    https://<envId>-<hash>.tcloudbaseapp.com/index.html
#    （<hash> 不是 envId 本身，脚本末尾第 67 行的拼法不准，按控制台显示为准）
# 3) 部署完记得核对上传个数：本次 6 html + 4 css + 7 js + 7 data = 24 个。
# ============================================================

param(
  [Parameter(Mandatory = $true)]
  [string]$EnvId
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ''
Write-Host '===== 每日体坛速览 · 前端静态托管部署 =====' -ForegroundColor Cyan
Write-Host "项目根目录：$root"
Write-Host "目标环境：$EnvId"
Write-Host ''

$tcb = Get-Command tcb -ErrorAction SilentlyContinue
if (-not $tcb) {
  Write-Host '  ✗ 没找到 tcb 命令。先安装：npm i -g @cloudbase/cli 并 tcb login' -ForegroundColor Red
  exit 1
}

# ---- 1. 准备发布目录 ----
$pub = Join-Path $root '.cloudbase-publish'
Write-Host '[1/3] 准备发布目录（只含前端运行所需文件）...' -ForegroundColor Yellow
if (Test-Path $pub) { Remove-Item $pub -Recurse -Force }
New-Item -ItemType Directory -Path $pub | Out-Null

# 要发布的 HTML
$htmls = Get-ChildItem -Path $root -Filter '*.html' -File
foreach ($f in $htmls) { Copy-Item $f.FullName -Destination $pub }

# 静态资源目录
foreach ($dir in @('css', 'js', 'data')) {
  $src = Join-Path $root $dir
  if (Test-Path $src) {
    Copy-Item $src -Destination (Join-Path $pub $dir) -Recurse
    Write-Host "  ✓ 复制 $dir/"
  }
}

$count = (Get-ChildItem $pub -Recurse -File).Count
Write-Host "  ✓ 发布目录就绪：$pub（共 $count 个文件）"

# ---- 2. 部署 ----
Write-Host '[2/3] 部署到静态托管根路径 ...' -ForegroundColor Yellow
tcb hosting deploy $pub -e $EnvId

# ---- 3. 提示 ----
Write-Host '[3/3] 完成。' -ForegroundColor Yellow
Write-Host ''
Write-Host '===== 部署完成 =====' -ForegroundColor Green
Write-Host '在浏览器打开静态托管默认域名（形如）：' -ForegroundColor Green
Write-Host "  https://$EnvId-<hash>.tcloudbaseapp.com/index.html"
Write-Host '或控制台「静态网站托管」页会显示「默认域名」，点它即可。'
Write-Host '应看到首页「每日体坛速览」正常渲染（不是白屏、不是加载失败）。'
Write-Host ''
Write-Host '注意：本次未处理后端接口跨域，页面仍读本地 data/*.json，属正常。'
Write-Host ''
