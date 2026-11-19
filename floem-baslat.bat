@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Hata: .venv\Scripts\python.exe bulunamadı. Önce README'deki kurulumu tamamlayın.
    echo.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" -m floem_bi.start_all
set "FLOEM_EXIT=%ERRORLEVEL%"
echo.
if not "%FLOEM_EXIT%"=="0" echo Bazı bileşenler başlatılamadı; yukarıdaki hatayı kontrol edin.
pause
exit /b %FLOEM_EXIT%
