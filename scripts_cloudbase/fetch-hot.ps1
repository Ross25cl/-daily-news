# ============================================================
# fetch-hot.ps1 — 三平台热搜同步脚本（Day 17｜板块②）
# ------------------------------------------------------------
# 作用：从三个官网实时抓取当日热搜/要闻，写入 db/hot_sync.sql，
#       由 tcb db execute 灌进 CloudBase PostgreSQL 的 hot_items 表。
#
# 为什么用 PowerShell 而不是 Node 脚本：
#   本机 Node 环境没有装 HTTP 抓取依赖（HTTP 云函数也不能带依赖），
#   PowerShell 自带 System.Net.WebClient，无需安装任何东西。
#
# 三个数据源（均为官网公开页面，只取标题+链接，不转载正文）：
#   hupu    虎扑步行街 24 小时榜  https://bbs.hupu.com/topic-hot
#   tencent 腾讯体育首页要闻      https://sports.qq.com/（内嵌 JSON type1502）
#   cctv5   央视体育首页要闻      https://sports.cctv.com/
#
# 数据合规（PRD 9.1 / tiyu-daily Skill 1.2）：
#   只存「标题 + 原文链接 + 平台内热度」，不存正文、不存图片。
#
# 用法（项目根目录，PowerShell）：
#   powershell -File scripts_cloudbase/fetch-hot.ps1
#   产物：db/hot_sync.sql（UTF-8 无 BOM，可重复执行）
# ============================================================

$ErrorActionPreference = 'Stop'
# 定位项目根目录：脚本预期位于 <root>/scripts_cloudbase/ 下。
# 不用 $PSScriptRoot —— 被 -Command 注入执行时它是空的，由调用方保证工作目录。
$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root 'db'))) {
  $root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
Set-Location $root

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
$nowIso = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')

# 抓页面字节并按正确编码解码（央视是 GBK 系，虎扑/腾讯是 UTF-8）
function Get-PageText([string]$url) {
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent', $UA)
  $bytes = $wc.DownloadData($url)
  # 从 HTTP 头或 <meta> 里取 charset，取不到按 UTF-8
  $charset = 'UTF-8'
  $probe = [System.Text.Encoding]::ASCII.GetString($bytes[0..([Math]::Min(2000, $bytes.Length - 1))])
  if ($probe -match 'charset=["'']?([\w-]+)') { $charset = $Matches[1] }
  try { $enc = [System.Text.Encoding]::GetEncoding($charset) } catch { $enc = [System.Text.Encoding]::UTF8 }
  return @{ text = $enc.GetString($bytes); charset = $charset }
}

# HTML 实体反转义（抓下来的标题里会带 &quot; 之类）
function Unescape-Html([string]$s) {
  if (-not $s) { return $s }
  $s = $s -replace '&quot;', '"' -replace '&#39;', "'" -replace '&apos;', "'"
  $s = $s -replace '&lt;', '<' -replace '&gt;', '>' -replace '&nbsp;', ' '
  return $s -replace '&amp;', '&'
}

# 从标题猜联赛标签（PRD 1.1 允许值：NBA/CBA/英超/中超/欧冠/电竞/综合）
function Guess-Tag([string]$s) {
  $map = @(
    @('NBA', 'NBA'), @('nba', 'NBA'),
    @('CBA', 'CBA'), @('cba', 'CBA'), @('辽宁', 'CBA'), @('广东宏远', 'CBA'), @('广厦', 'CBA'),
    @('英超', '英超'), @('曼城', '英超'), @('利物浦', '英超'), @('阿森纳', '英超'), @('曼联', '英超'), @('切尔西', '英超'), @('热刺', '英超'),
    @('欧冠', '欧冠'), @('皇家马德里', '欧冠'), @('拜仁', '欧冠'), @('巴萨', '欧冠'),
    @('中超', '中超'), @('亚冠', '中超'),
    @('电竞', '电竞'), @('LPL', '电竞')
  )
  foreach ($p in $map) { if ($s -like ('*' + $p[0] + '*')) { return $p[1] } }
  return '综合'
}

# 转义成 SQL 字符串（单引号翻倍），列名/字符串一律走这里，防注入
function SqlStr([string]$v) {
  if ($null -eq $v) { return 'NULL' }
  return "'" + $v.Replace("'", "''") + "'"
}

$rows = @()   # 收集所有平台的条目

# ---------- 1. 虎扑 · 步行街 24 小时榜 ----------
Write-Host '[1/3] 抓取虎扑热榜 ...' -ForegroundColor Yellow
$hupu = Get-PageText 'https://bbs.hupu.com/topic-hot'
$lis = [regex]::Matches($hupu.text, '<li class="bbs-sl-web-post-body">([\s\S]*?)</li>')
$rank = 0
$hupuCount = 0
foreach ($m in $lis) {
  $blk = $m.Groups[1].Value
  $t = [regex]::Match($blk, '<a href="(/[^"]+)"[^>]*class="p-title"[^>]*>([^<]+)</a>')
  if (-not $t.Success) { continue }
  $rank++
  $d = [regex]::Match($blk, '<div class="post-datum">([^<]+)</div>')
  $pt = [regex]::Match($blk, '<div class="post-time">([^<]+)</div>')
  # 热度用「回复数」（post-datum 形如 "198 / 44819"），榜单内外一致可比
  $heat = 0
  if ($d.Success -and $d.Groups[1].Value -match '(\d+)') { $heat = [int64]$Matches[1] }
  $href = 'https://bbs.hupu.com' + $t.Groups[1].Value
  $title = Unescape-Html ($t.Groups[2].Value.Trim())
  $rows += [pscustomobject]@{
    id = "hupu-$rank"; platform = 'hupu'; pname = '虎扑'; pdesc = '步行街 24 小时榜'
    rank = $rank; title = $title; heat = $heat; url = $href
    tag = (Guess-Tag $title); video = 0
  }
  $hupuCount++
}
Write-Host "      -> 虎扑 $hupuCount 条" -ForegroundColor Green

# ---------- 2. 腾讯体育 · 首页要闻（内嵌 JSON type1502） ----------
Write-Host '[2/3] 抓取腾讯体育 ...' -ForegroundColor Yellow
$tx = Get-PageText 'https://sports.qq.com/'
$s = $tx.text.IndexOf('"type1502"')
if ($s -lt 0) { throw '腾讯体育页面结构变化：找不到 type1502 数据块' }
$e = $tx.text.IndexOf('"type1503"')
$seg = if ($e -gt $s) { $tx.text.Substring($s, $e - $s) } else { $tx.text.Substring($s) }
$items = [regex]::Matches($seg, '\{"title":"([^"]{6,120})","summary":"[^"]*","pic":"[^"]*","createTime":"(\d+)","isVideo":(\d)')
$rank = 0
$txCount = 0
foreach ($m in $items) {
  $rank++
  $title = Unescape-Html ($m.Groups[1].Value.Trim())
  $isVideo = [int]$m.Groups[3].Value
  # 榜单没有浏览量，用「榜单位置反推热度」：热度 = (N-rank+1) * 10000，名次越前越高
  $heat = (20 - $rank + 1) * 10000
  $rows += [pscustomobject]@{
    id = "tencent-$rank"; platform = 'tencent'; pname = '腾讯体育'; pdesc = '首页要闻热榜'
    rank = $rank; title = $title; heat = $heat
    url = 'https://sports.qq.com/'; tag = (Guess-Tag $title); video = $isVideo
  }
  $txCount++
}
Write-Host "      -> 腾讯体育 $txCount 条" -ForegroundColor Green

# ---------- 3. 央视体育 · 首页要闻 ----------
Write-Host '[3/3] 抓取央视体育 ...' -ForegroundColor Yellow
$cctv = Get-PageText 'https://sports.cctv.com/'
$news = [regex]::Matches($cctv.text, '<a[^>]*href="(https?://sports\.cctv\.com/\d{4}/\d{2}/\d{2}/[^"]+)"[^>]*>([^<]{6,120})</a>')
$rank = 0
$cctvCount = 0
foreach ($m in $news) {
  $rank++
  $title = Unescape-Html (($m.Groups[2].Value.Trim()) -replace '\s+', ' ')
  $heat = (20 - $rank + 1) * 10000
  $rows += [pscustomobject]@{
    id = "cctv5-$rank"; platform = 'cctv5'; pname = '央视体育'; pdesc = '官方要闻'
    rank = $rank; title = $title; heat = $heat
    url = $m.Groups[1].Value; tag = (Guess-Tag $title); video = 0
  }
  $cctvCount++
}
Write-Host "      -> 央视体育 $cctvCount 条" -ForegroundColor Green

if ($rows.Count -eq 0) { throw '三个数据源都没抓到条目，中止（不覆盖已有数据）' }

# ---------- 4. 生成 SQL ----------
Write-Host "`n生成 db/hot_sync.sql（共 $($rows.Count) 条）..." -ForegroundColor Yellow
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('-- ============================================================')
[void]$sb.AppendLine('-- hot_sync.sql — 三平台热搜同步数据（由 scripts_cloudbase/fetch-hot.ps1 生成）')
[void]$sb.AppendLine("-- 生成时间：$nowIso")
[void]$sb.AppendLine("-- 条数：虎扑 $hupuCount · 腾讯体育 $txCount · 央视体育 $cctvCount")
[void]$sb.AppendLine('-- 可重复执行：先按平台清空，再插入，不会产生重复行')
[void]$sb.AppendLine('-- ============================================================')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("DELETE FROM public.hot_items WHERE platform IN ('hupu','tencent','cctv5');")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('INSERT INTO public.hot_items (id, platform, platform_name, platform_desc, rank, title, heat, url, tag, is_video, fetched_at) VALUES')
$sep = ''
foreach ($r in $rows) {
  $line = $sep + '  (' + (SqlStr $r.id) + ', ' + (SqlStr $r.platform) + ', ' + (SqlStr $r.pname) + ', ' +
          (SqlStr $r.pdesc) + ', ' + $r.rank + ', ' + (SqlStr $r.title) + ', ' + $r.heat + ', ' +
          (SqlStr $r.url) + ', ' + (SqlStr $r.tag) + ', ' + $(if ($r.video -eq 1) { 'TRUE' } else { 'FALSE' }) + ', ' +
          (SqlStr $nowIso) + ')'
  [void]$sb.AppendLine($line)
  $sep = ','
}
[void]$sb.AppendLine(';')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('-- 收尾自检')
[void]$sb.AppendLine('SELECT platform, count(*) AS 条数, min(rank) AS 最小名次, max(rank) AS 最大名次')
[void]$sb.AppendLine('FROM   public.hot_items GROUP BY platform ORDER BY platform;')

$out = Join-Path $root 'db/hot_sync.sql'
[System.IO.File]::WriteAllText($out, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
Write-Host "`n完成：$out" -ForegroundColor Green
Write-Host "下一步：tcb db execute -e <环境ID> --sql `"`$(Get-Content db/hot_sync.sql -Raw)`"" -ForegroundColor Cyan
