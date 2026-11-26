$ErrorActionPreference = 'Stop'
$url = 'http://localhost:8787'
$project = Join-Path $PSScriptRoot 'web-karaoke'
$logFolder = Join-Path $PSScriptRoot 'dados\web-karaoke'
$ready = $false
function Get-KaraokeRoom {
    # A verificacao local nao deve passar por proxies do Windows ou do ambiente.
    $request = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8787/api/room')
    $request.Proxy = $null
    $request.Timeout = 2000
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        return ($reader.ReadToEnd() | ConvertFrom-Json)
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Close() }
    }
}
try {
    $room = Get-KaraokeRoom
    $ready = $room.PSObject.Properties.Name -contains 'queue'
} catch {}
if (-not $ready) {
    New-Item -ItemType Directory -Force -Path $logFolder | Out-Null
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $serverPath = Join-Path $project 'server.mjs'
    $server = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $serverPath + '"')) -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logFolder 'servidor.log') -RedirectStandardError (Join-Path $logFolder 'servidor-erros.log') -PassThru
    $server.Id | Set-Content -LiteralPath (Join-Path $logFolder 'servidor.pid')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $room = Get-KaraokeRoom
            $ready = $room.PSObject.Properties.Name -contains 'queue'
            if ($ready) { break }
        } catch {}
        if ($server.HasExited) { break }
    }
}
if (-not $ready) { throw 'Nao foi possivel iniciar o karaoke. Consulte dados\web-karaoke\servidor-erros.log.' }
Start-Process $url
