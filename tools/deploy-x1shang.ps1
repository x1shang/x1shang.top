# 一键把 x1shang 站点推送到 GitHub（x1shang/x1shang.top），走本地 v2rayN 代理
# 脚本住在 x1shang/tools/ 里，仓库根由脚本自己的位置推出（换机器/换路径都不用改）
#
# 用法：
#   pwsh -File tools/deploy-x1shang.ps1
#   pwsh -File tools/deploy-x1shang.ps1 -Message "更新文章"
#   pwsh -File tools/deploy-x1shang.ps1 -SkipPhotos     # 跳过照片流水线（没装 Python 时更快）
#   pwsh -File tools/deploy-x1shang.ps1 -NoPush         # 只本地 build + 提交，不联网
#
# 为什么有"自愈"这一段：
#   .github/workflows/stats.yml 每天（cron 03:17 UTC = 北京 11:17，GitHub 常延后数小时）抓完
#   访客统计后，会自动往 main 推一个 chore(stats) 提交，内容全是生成物
#   （stats.json / content.auto.js / 预渲染页 / feed / sitemap）。它只要插在你的提交之前，
#   你的 push 就必然 non-fast-forward 被拒。所以本脚本：
#     1) build（含照片）→ 有改动就提交
#     2) fetch origin：远端领先 → 自动 rebase 到 origin/main
#        冲突若只落在生成物上 → 取远端那份（最新 stats），继续 rebase
#     3) rebase 完再 build 一次 → 生成物 = 本地内容 + 最新统计，并入最后一次提交
#     4) push：成功即完；若期间 bot 又推了导致再次被拒 → 回到第 2 步，最多 -SyncAttempts 轮
#   真·正文冲突（同一篇文章在两处被改）不会被静默吞掉：脚本会停下并告诉你怎么手工处理。

param(
  [string]$Message,
  [string]$Proxy = 'http://127.0.0.1:10809',
  [switch]$SkipPhotos,
  [switch]$NoPush,
  [int]$SyncAttempts = 3
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot          # x1shang/tools/ → x1shang/
$env:GIT_TERMINAL_PROMPT = '0'                    # 别卡在交互式凭据输入上
$env:GIT_EDITOR = 'true'                          # rebase --continue 时不弹编辑器
$env:GIT_SEQUENCE_EDITOR = 'true'
$net = @('-c', "http.proxy=$Proxy", '-c', 'http.sslBackend=openssl')

# 生成物：这些文件的冲突不需要人来判断——一律取远端，随后由 build 重算
$generated = @('content.auto.js', 'stats.json', 'feed.xml', 'atom.xml', 'sitemap.xml',
               'articles', 'assertions', 'academic')

function Test-Generated([string]$p) {
  $n = $p -replace '\\', '/'
  foreach ($g in $generated) { if ($n -eq $g -or $n.StartsWith("$g/")) { return $true } }
  return $false
}

function Test-RebaseInProgress {
  $d = (git rev-parse --absolute-git-dir).Trim()
  return (Test-Path (Join-Path $d 'rebase-merge')) -or (Test-Path (Join-Path $d 'rebase-apply'))
}

function Invoke-Build {
  if ($SkipPhotos) { node tools/build-content.mjs } else { node tools/build-content.mjs --photos }
  if ($LASTEXITCODE -ne 0) { throw "build 失败（exit $LASTEXITCODE）" }
}

# 把本地提交 rebase 到 origin/main 上；生成物冲突自动取远端（rebase 里 --ours 就是远端那侧）
function Sync-ToRemote {
  git rebase origin/main
  $rc = $LASTEXITCODE
  if (-not (Test-RebaseInProgress)) {
    if ($rc -ne 0) { throw "git rebase origin/main 没能开始（exit $rc，先看上面的输出）" }
    return
  }
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-RebaseInProgress)) { return }
    $unmerged = @(git diff --name-only --diff-filter=U)
    if ($unmerged.Count -gt 0) {
      $manual = @($unmerged | Where-Object { -not (Test-Generated $_) })
      if ($manual.Count -gt 0) {
        throw ("冲突里有非生成物，需要你手工处理：`n    " + ($manual -join "`n    ") +
               "`n  处理完：git add <文件> → git rebase --continue" +
               "`n  想放弃：git rebase --abort（回到本次同步前的状态，你的提交都还在）")
      }
      Write-Host "  · 生成物冲突（$($unmerged -join '、')）→ 取远端版本，稍后由 build 重算"
      git checkout --ours -- @unmerged
      if ($LASTEXITCODE -ne 0) { throw "取远端版本失败：$($unmerged -join '、')" }
      git add -A
    }
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  · 这个提交的内容已被远端生成物完全覆盖 → 跳过该提交"
      git rebase --skip
    } else {
      git rebase --continue
    }
  }
  throw "rebase 反复停下超过 30 次，已放弃。当前处于 rebase 中间态：git rebase --abort 可回到原状"
}

# rebase 之后用最新 stats.json 重算生成物，并并进最后一次提交
function Update-Generated {
  Invoke-Build
  if (-not (git status --porcelain)) { return }
  git add -A
  if ([int](git rev-list --count 'origin/main..HEAD') -gt 0) {
    git commit --amend --no-edit -q
    Write-Host "  · 生成物已按最新统计重算，并入最后一次提交"
  } else {
    git commit -q -m "chore(build): 按最新统计重建生成物"
    Write-Host "  · 生成物已按最新统计重建并单独提交"
  }
}

Push-Location $repo
$ok = $false
try {
  Write-Host "1/3 重建站点（$(if ($SkipPhotos) { '跳过照片流水线' } else { '含照片流水线' })）"
  Invoke-Build

  $dirty = git status --porcelain
  if ($dirty) {
    git add -A
    if (-not $Message) { $Message = "更新站点内容 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
    git commit -q -m $Message
    Write-Host "已提交：$Message"
  } else {
    Write-Host "没有需要提交的改动"
  }

  if ($NoPush) {
    Write-Host "-NoPush：本地整理完毕，未联网。"
    $ok = $true
    return
  }

  Write-Host "2/3 与远端同步"
  for ($attempt = 1; $attempt -le $SyncAttempts; $attempt++) {
    $fetchArgs = $net + @('fetch', 'origin', '+main:refs/remotes/origin/main')
    git @fetchArgs
    if ($LASTEXITCODE -ne 0) { throw "fetch 失败（代理 $Proxy 在跑吗？）" }

    $behind = [int](git rev-list --count 'HEAD..origin/main')
    if ($behind -gt 0) {
      Write-Host "  远端领先 $behind 个提交（通常是 stats 定时任务），rebase 到 origin/main"
      Sync-ToRemote
      Update-Generated
    }

    Write-Host "3/3 推送 $(if ($attempt -gt 1) { "（第 $attempt 轮）" } else { '' })"
    $pushArgs = $net + @('push', 'origin', 'main')
    git @pushArgs
    if ($LASTEXITCODE -eq 0) {
      Write-Host "推送完成：https://github.com/x1shang/x1shang.top"
      $ok = $true
      return
    }
    Write-Host "  · 推送被拒（远端又在窗口期内更新了）→ 自愈重试"
  }
  throw "连续 $SyncAttempts 轮都被远端抢先，已停止；过一会儿重跑一次即可。"
}
catch {
  Write-Host ""
  Write-Host "❌ $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Pop-Location
}
if (-not $ok) { exit 1 }
