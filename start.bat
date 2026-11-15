@echo off
rem IGNIS-SI: install, build, train, test, launch and smoke-test.
rem
rem   start.bat            full setup, then leave both servers running
rem   start.bat --verify   full setup and checks, then stop the servers and exit
setlocal
set "ROOT=%~dp0"
set "PY=%ROOT%backend\.venv\Scripts\python.exe"

where python >nul 2>nul || (echo Python 3.11+ is required. & exit /b 1)
where node >nul 2>nul || (echo Node.js 20+ is required. & exit /b 1)

rem A server left running from an earlier launch holds file locks in
rem node_modules, which makes npm ci fail.
call :stop_servers

echo.
echo == Backend dependencies ==
if not exist "%PY%" python -m venv "%ROOT%backend\.venv" || goto :fail
"%PY%" -m pip install --quiet --disable-pip-version-check -r "%ROOT%backend\requirements.txt" || goto :fail

echo.
echo == Dataset generation and model training ==
pushd "%ROOT%backend"
"%PY%" -m ml.train --regenerate || (popd & goto :fail)

echo.
echo == Backend unit tests ==
"%PY%" -m pytest -q || (popd & goto :fail)
popd

echo.
echo == Frontend dependencies and build ==
pushd "%ROOT%frontend"
if exist package-lock.json (
  call npm ci --no-audit --no-fund --loglevel=error || (popd & goto :fail)
) else (
  call npm install --no-audit --no-fund --loglevel=error || (popd & goto :fail)
)
call npx tsc --noEmit || (popd & goto :fail)
call npx next build || (popd & goto :fail)
popd

echo.
echo == Launching servers ==
call :stop_servers
start "IGNIS-SI backend" /min cmd /c "cd /d "%ROOT%backend" && "%PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning"
start "IGNIS-SI frontend" /min cmd /c "cd /d "%ROOT%frontend" && npx next start -p 3000"

echo.
echo == API smoke test ==
"%PY%" "%ROOT%scripts\smoke_test.py" --wait 90 || (call :stop_servers & goto :fail)

if /i "%~1"=="--verify" (
  call :stop_servers
  echo.
  echo == Verification complete ==
  exit /b 0
)

echo.
echo IGNIS-SI is running.
echo   Workbench  http://localhost:3000
echo   Analytics  http://localhost:3000/analytics
echo   API docs   http://127.0.0.1:8000/docs
echo Close the two minimised server windows to stop.
exit /b 0

:stop_servers
for %%P in (8000 3000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do taskkill /F /PID %%I >nul 2>nul
)
exit /b 0

:fail
echo.
echo Setup failed. See the output above.
exit /b 1
