param([switch]$Uninstall, [switch]$PrepareUpgrade)
$ErrorActionPreference = 'Stop'
$serviceName = 'Floemway'
$hostFile = Join-Path $PSScriptRoot 'FloemwayService.exe'
$expected = '"' + $hostFile + '"'
$existing = Get-CimInstance Win32_Service -Filter "Name='Floemway'"
if ($existing -and $existing.PathName.Trim('"') -ne $hostFile) {
    throw 'Aynı adda başka bir hizmet var.'
}
if ($existing) {
    Stop-Service -Name $serviceName -ErrorAction Stop
}
if ($PrepareUpgrade) { return }
if ($Uninstall) {
    if ($existing) {
        & sc.exe delete $serviceName
        if ($LASTEXITCODE) { throw 'Hizmet kaldırılamadı.' }
    }
    return
}
if (-not $existing) {
    # Win32_Service API kullanılarak boşluklu exe yolunun tırnakları korunur.
    $created = Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{
        Name=$serviceName; DisplayName='Floemway'; PathName=$expected; StartMode='Manual';
        StartName='NT AUTHORITY\LocalService'; ServiceType=[byte]16; ErrorControl=[byte]1
    }
    if ($created.ReturnValue -ne 0) { throw "Hizmet oluşturulamadı ($($created.ReturnValue))." }
}
& sc.exe sidtype $serviceName unrestricted
if ($LASTEXITCODE) { throw 'Hizmet kimliği etkinleştirilemedi.' }
$private = Join-Path $PSScriptRoot 'Private'
[IO.Directory]::CreateDirectory($private) | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$sid = ([Security.Principal.NTAccount]'NT SERVICE\Floemway').Translate([Security.Principal.SecurityIdentifier])
foreach ($item in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @($sid.Value,'ReadAndExecute'))) {
    $principal = [Security.Principal.SecurityIdentifier]::new($item[0])
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal, $item[1],
        'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
Set-Acl -LiteralPath $private -AclObject $acl
