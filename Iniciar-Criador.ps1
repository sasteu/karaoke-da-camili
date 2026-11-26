$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $PSScriptRoot 'runtime\PFiles\UltrastarCreatorTool'
$dataRoot = Join-Path $PSScriptRoot 'dados'
foreach ($folder in @('appdata', 'localappdata', 'huggingface', '.cache', 'temp')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot $folder) | Out-Null
}
$env:APPDATA = Join-Path $dataRoot 'appdata'
$env:LOCALAPPDATA = Join-Path $dataRoot 'localappdata'
$env:HF_HOME = Join-Path $dataRoot 'huggingface'
# O verificador da versão 5.0 procura alguns modelos em ~/.cache/torch.
# Mantemos o perfil do processo e o cache no mesmo local para evitar falsos avisos.
$env:USERPROFILE = $dataRoot
$env:TORCH_HOME = Join-Path $dataRoot '.cache\torch'
$env:TEMP = Join-Path $dataRoot 'temp'
$env:TMP = $env:TEMP
Start-Process -FilePath (Join-Path $appRoot 'ultrastar-creator.exe') -WorkingDirectory $appRoot
