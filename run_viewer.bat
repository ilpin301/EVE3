@echo off
set "CHROME=F:\!___PORT\GoogleChromePortable\App\Chrome-bin\chrome.exe"
if not exist "%CHROME%" (
    echo ERROR: Chrome not found: "%CHROME%"
    pause
    exit /b 1
)
set "P=%~dp0viewer\viewer.html"
set "P=%P:\=/%"
start "" "%CHROME%" "file:///%P%"
