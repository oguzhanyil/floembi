$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$output = Join-Path $root 'build\floemway'
$work = Join-Path $root 'build\floemway-work'
[IO.Directory]::CreateDirectory($output) | Out-Null
& "$root\.venv\Scripts\pyinstaller.exe" --noconfirm --distpath $output --workpath $work "$PSScriptRoot\floemway.spec"
if ($LASTEXITCODE) { throw 'Floemway paketlenemedi.' }
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /reference:System.ServiceProcess.dll "/out:$output\FloemwayService.exe" "$PSScriptRoot\FloemwayService.cs"
if ($LASTEXITCODE) { throw 'Hizmet derlenemedi.' }
$nsis = (Get-Command makensis.exe -ErrorAction SilentlyContinue).Source
if (-not $nsis) {
    $nsis = Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\nsis-*" -Recurse -Filter makensis.exe |
        Where-Object { $_.Directory.Name -ne 'Bin' } | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $nsis) { throw 'NSIS makensis.exe bulunamadı.' }
& $nsis /V2 "/DOUTPUT=$output" "$PSScriptRoot\floemway.nsi"
if ($LASTEXITCODE) { throw 'Floemway yükleyicisi derlenemedi.' }
Write-Output "$output\Floemway-Setup.exe"
