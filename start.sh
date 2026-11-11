#!/bin/bash
# SnapVision 本地启动脚本
# 用法: ./start.sh          启动 OCR 后端 + 桌面应用
#       ./start.sh backend  只启动 OCR 后端
#       ./start.sh app      只启动桌面应用（需后端已在运行）

set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
VENV="$ROOT/backend/.venv"
TMPDIR_BACKEND="$ROOT/backend/.tmp"
mkdir -p "$TMPDIR_BACKEND"

start_backend() {
  echo "▶ 启动 OCR 后端 (http://127.0.0.1:5002)..."
  cd "$ROOT/backend"
  # 行情数据 (OKX/Yahoo) 需走系统代理 (Clash 等); 已设置 SNAPVISION_PROXY 则优先用
  export SNAPVISION_PROXY="${SNAPVISION_PROXY:-http://127.0.0.1:7890}"
  echo "  代理: $SNAPVISION_PROXY (可用 export SNAPVISION_PROXY=... 覆盖)"
  TMPDIR="$TMPDIR_BACKEND" "$VENV/bin/python" ocr_server.py
}

start_app() {
  echo "▶ 启动 SnapVision 桌面应用..."
  cd "$ROOT"
  # 生产构建产物存在则直接跑桌面版，否则跑开发模式
  if [ -d "$ROOT/dist" ] && [ -d "$ROOT/dist-electron" ]; then
    npx electron .
  else
    npm run dev
  fi
}

case "${1:-all}" in
  backend) start_backend ;;
  app)     start_app ;;
  all)
    start_backend &
    BACKEND_PID=$!
    trap 'kill $BACKEND_PID 2>/dev/null' EXIT INT TERM
    echo "  等待 OCR 服务就绪..."
    for i in $(seq 1 40); do
      if curl -s --max-time 2 http://127.0.0.1:5002/health | grep -q '"ready":true'; then
        echo "  OCR 服务已就绪"
        break
      fi
      sleep 1
    done
    start_app
    ;;
  *)
    echo "用法: ./start.sh [all|backend|app]"
    exit 1
    ;;
esac
