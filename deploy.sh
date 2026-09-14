#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "🚀 배포 파이프라인 시작..."
# git pull origin main (현재는 로컬 테스트 중이므로 주석 처리)

echo "📦 프론트엔드 빌드 중..."
cd frontend
npm install
npm run build
cd ..

echo "🔄 서버 재시작 중..."
# pm2가 설치되어 있다면 pm2로 재시작, 아니면 기존 스크립트 킬 후 재시작
if command -v pm2 &> /dev/null
then
    pm2 restart auction-api || pm2 start "uvicorn backend.main:app --port 8000" --name "auction-api"
    cd frontend
    pm2 restart auction-web || pm2 start "npm run start" --name "auction-web"
    cd ..
else
    echo "⚠️ pm2가 설치되어 있지 않습니다. 기존 실행된 프로세스를 종료합니다..."
    pkill -f "uvicorn backend.main:app"
    pkill -f "next-server"
    
    echo "▶️ 백그라운드로 서버를 재실행합니다..."
    uvicorn backend.main:app --port 8000 &
    cd frontend && npm run start &
fi

echo "✅ 무중단 배포 완료!"
