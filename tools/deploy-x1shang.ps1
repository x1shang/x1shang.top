# 一键把 x1shang 站点推送到 GitHub（x1shang/x1shang.top），走本地 v2rayN 代理
# 脚本住在 x1shang/tools/ 里，仓库根由脚本自己的位置推出（换机器/换路径都不用改）
# 用法：  pwsh -File x1shang/tools/deploy-x1shang.ps1
#         pwsh -File x1shang/tools/deploy-x1shang.ps1 -Message "更新文章"

param(
  [string]$Message,
  [string]$Proxy = 'http://127.0.0.1:10809'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot   # x1shang/tools/ → x1shang/
$env:GIT_TERMINAL_PROMPT = '0'

Push-Location $repo
try {
  # 1) 重新生成内容包（如需照片，另跑 npm run photos）
  node tools/build-content.mjs

  # 2) 有改动就提交
  $dirty = (git status --porcelain)
  if ($dirty) {
    git add -A
    if (-not $Message) { $Message = "更新站点内容 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
    git commit -q -m $Message
    Write-Host "已提交：$Message"
  } else {
    Write-Host "没有需要提交的改动"
  }

  # 3) 推送（GitHub 直连不通，走本地代理 + openssl TLS 后端）
  git -c "http.proxy=$Proxy" -c http.sslBackend=openssl push origin main
  Write-Host "推送完成：https://github.com/x1shang/x1shang.top"
}
finally {
  Pop-Location
}
