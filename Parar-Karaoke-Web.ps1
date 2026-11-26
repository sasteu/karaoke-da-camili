$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'dados\web-karaoke\servidor.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'Karaoke ja esta fechado.'; exit }
$serverPid = [int](Get-Content -LiteralPath $pidFile)
$serverPath = Join-Path $PSScriptRoot 'web-karaoke\server.mjs'
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
if (-not $process) { Write-Output 'Karaoke ja esta fechado.'; exit }
if ($process.Name -ne 'node.exe' -or -not $process.CommandLine.Contains($serverPath)) { throw 'Processo diferente do karaoke; nenhum aplicativo foi encerrado.' }
Stop-Process -Id $serverPid
Write-Output 'Karaoke fechado.'
