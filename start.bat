@echo off
REM Одна кнопка для Windows: при первом запуске ставит зависимости и поднимает игру.
cd /d "%~dp0"

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install --no-audit --no-fund
)

echo Запускаю VICE SHORE...
call npm run dev
