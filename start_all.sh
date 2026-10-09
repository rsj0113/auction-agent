#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "1. Installing PM2..."
npm install -g pm2

echo "2. Building frontend (to avoid dev server freeze)..."
cd frontend
npm run build
cd ..

echo "3. Starting services with PM2..."
pm2 delete all || true
pm2 start "uvicorn backend.main:app --port 8000" --name "auction-api"
cd frontend
pm2 start "npm run start" --name "auction-web"
cd ..

echo "4. Starting ngrok tunnel (Backend API)..."
pm2 start "ngrok http --domain=trivial-footprint-empirical.ngrok-free.dev 8000" --name "ngrok-tunnel"
pm2 save
