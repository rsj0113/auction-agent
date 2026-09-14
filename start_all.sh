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

echo "4. Starting localtunnel..."
pm2 start "npx localtunnel --port 3000 --subdomain auction-agent-seonjin" --name "localtunnel"
pm2 save
