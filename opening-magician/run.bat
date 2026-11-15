@echo off
REM Opening Magician - one-command start (Windows).
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Setting up the Python environment...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install --quiet --upgrade pip
  .venv\Scripts\python -m pip install --quiet -r backend\requirements.txt
)
if not exist frontend\dist\index.html (
  echo Building the interface...
  pushd frontend
  call npm install --no-audit --no-fund
  call npm run build
  popd
)
cd backend
..\.venv\Scripts\python -m om %*
