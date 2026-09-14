#!/bin/bash
echo "🚀 백엔드와 프론트엔드를 동시에 실행합니다..."

# nvm 로드 (스크립트 환경에서 npm을 찾기 위해 필수)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "1️⃣ FastAPI 백엔드 실행 중 (포트 8000)..."
uvicorn backend.main:app --reload --port 8000 &
BACKEND_PID=$!

echo "2️⃣ Next.js 프론트엔드 실행 중 (포트 3000)..."
cd frontend && npm run dev &
FRONTEND_PID=$!

trap "echo '서버 종료 중...'; kill $BACKEND_PID; kill $FRONTEND_PID" SIGINT
wait
