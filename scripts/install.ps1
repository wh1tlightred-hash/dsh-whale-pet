param(
  [string]$ProfilePath = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $ProfilePath 'package.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
$modulePath = Join-Path $ProfilePath 'node_modules\dsh-whale-pet'
$existing = Get-Item -LiteralPath $modulePath -ErrorAction SilentlyContinue
if ($existing -and (!$existing.LinkType -or [IO.Path]::GetFullPath($existing.Target) -ne $pluginRoot)) {
  throw "已有不同安装位于 $modulePath，请先核查，安装器不会覆盖。"
}
if (!$Uninstall -and !$env:DSH_WHALE_ELECTRON -and !(Test-Path -LiteralPath (Join-Path $pluginRoot '.runtime\electron\electron.exe'))) {
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron\Cache'
  $archive = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter 'electron-*-win32-x64.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (!$archive) { throw '没有可用的 Electron 缓存。请安装 Electron 运行时到插件 .runtime/electron 目录，或配置 DSH_WHALE_ELECTRON。' }
  Expand-Archive -LiteralPath $archive.FullName -DestinationPath (Join-Path $pluginRoot '.runtime\electron') -Force
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
Copy-Item -LiteralPath $manifestPath -Destination "$manifestPath.before-whale-$stamp.bak"
if ($Uninstall) {
  $manifest.dependencies.Remove('dsh-whale-pet') | Out-Null
  $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-whale-pet' })
  if ($existing) { $existing.Delete() }
} else {
  if (!$manifest.dependencies) { $manifest.dependencies = @{} }
  $manifest.dependencies['dsh-whale-pet'] = 'link:' + $pluginRoot.Replace('\','/')
  if ($manifest.dsh.profile.bundles -notcontains 'dsh-whale-pet') { $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles) + 'dsh-whale-pet' }
  if (!$existing) { New-Item -ItemType Junction -Path $modulePath -Target $pluginRoot | Out-Null }
}
$json = $manifest | ConvertTo-Json -Depth 30
[IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output $(if ($Uninstall) { '已卸载鲸鱼娘插件配置。重启 dsh 后生效。源文件和其他插件已保留。' } else { '已安装鲸鱼娘插件。重启 dsh 桌面客户端后自动启动。' })
