#!/usr/bin/env bash
# Одна кнопка для macOS/Linux: при первом запуске ставит зависимости и поднимает игру.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Первый запуск: устанавливаю зависимости..."
  npm install --no-audit --no-fund
fi

echo "Запускаю VICE SHORE..."
npm run dev
