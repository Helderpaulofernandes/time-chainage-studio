@echo off
rem Starts Time-Chainage Studio on http://localhost:8765 and opens it in the browser.
cd /d "%~dp0"
python -m pip install -q -r requirements.txt
start "" http://localhost:8765
python -m uvicorn server.main:app --port 8765
