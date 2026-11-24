Unicode true
!include "LogicLib.nsh"
Name "Floemway"
OutFile "${OUTPUT}\Floemway-Setup.exe"
InstallDir "$PROGRAMFILES64\Floemway"
RequestExecutionLevel admin
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section
  IfFileExists "$INSTDIR\service-setup.ps1" 0 copy_files
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service-setup.ps1" -PrepareUpgrade'
    Pop $0
    ${If} $0 != 0
      Abort "Mevcut hizmet durdurulamadi."
    ${EndIf}
  copy_files:
  SetOutPath "$INSTDIR"
  File "${OUTPUT}\FloemwayService.exe"
  File "service-setup.ps1"
  SetOutPath "$INSTDIR\worker"
  File /r "${OUTPUT}\worker\*"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service-setup.ps1"'
  Pop $0
  ${If} $0 != 0
    Abort "Windows hizmeti kurulamadi."
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  SetRegView 64
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Floemway" "DisplayName" "Floemway"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Floemway" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd

Section "Uninstall"
  StrCmp $INSTDIR "$PROGRAMFILES64\Floemway" +2
    Abort "Kurulum dizini dogrulanamadi."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\service-setup.ps1" -Uninstall'
  Pop $0
  ${If} $0 != 0
    Abort "Windows hizmeti kaldirilamadi."
  ${EndIf}
  RMDir /r "$INSTDIR\worker"
  Delete "$INSTDIR\Private\identity.json"
  Delete "$INSTDIR\registration.json"
  RMDir "$INSTDIR\Private"
  Delete "$INSTDIR\FloemwayService.exe"
  Delete "$INSTDIR\service-setup.ps1"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  SetRegView 64
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Floemway"
SectionEnd
