@echo off
title Time-Chainage Studio
rem Starts Time-Chainage Studio on http://localhost:8765 and opens it in your browser.
rem Keep this window open while you use the app; close it to stop the app.
cd /d "%~dp0"

set PY=python
where python >nul 2>nul || set PY=py
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.11 or later from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  pause
  exit /b 1
)

rem install the four packages only if they are missing
%PY% -c "import fastapi, uvicorn, multipart, openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Installing the packages the app needs, one moment...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo The package install failed. The message above says why.
    pause
    exit /b 1
  )
)

rem if the app is already running, just open it
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:8765/api/presets -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Time-Chainage Studio is already running. Opening it.
  start "" http://localhost:8765
  timeout /t 3 >nul
  exit /b 0
)

rem open the browser once the server answers (checks for up to 30 seconds)
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){ try { Invoke-WebRequest http://localhost:8765/api/presets -UseBasicParsing -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:8765'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo Starting Time-Chainage Studio at http://localhost:8765
echo Keep this window open while you use the app. Close it to stop the app.
echo.
%PY% -m uvicorn server.main:app --port 8765
echo.
echo The app stopped. If there is an error above, send it to Claude.
pause
