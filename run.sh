#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

export HARDHAT_DISABLE_TELEMETRY_PROMPT=true

PIDS=()
cleanup() {
  echo ""
  echo "Stopping StaySure processes..."
  if [ "${#PIDS[@]}" -gt 0 ]; then
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done
  fi
  exit 0
}
trap cleanup INT TERM

echo "============================================"
echo "  StaySure - One-Click Local Launcher (Mac)"
echo "============================================"
echo ""

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] Node.js and npm are required."
  exit 1
fi

echo "[1/5] Checking dependencies..."
for dir in contracts-project backend frontend; do
  if [ ! -d "$ROOT_DIR/$dir/node_modules" ]; then
    echo "Installing $dir dependencies..."
    (cd "$ROOT_DIR/$dir" && npm install)
  fi
done

echo "[2/5] Preparing backend environment and SQLite database..."
if [ ! -f "$ROOT_DIR/backend/.env" ]; then
  cp "$ROOT_DIR/backend/.env.example" "$ROOT_DIR/backend/.env"
fi

(cd "$ROOT_DIR/backend" && npx prisma generate && npx prisma db push)

echo "[3/5] Checking local Hardhat node (127.0.0.1:8545)..."
if node -e "const s=require('net').connect(8545,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));" 2>/dev/null; then
  echo "Hardhat node already running on port 8545."
else
  echo "Starting Hardhat node..."
  (cd "$ROOT_DIR/contracts-project" && npx hardhat node > /tmp/staysure-hardhat.log 2>&1) &
  PIDS+=($!)
  node -e "const net=require('net');let tries=0;(function wait(){const s=net.connect(8545,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>{if(++tries>30)process.exit(1);setTimeout(wait,500)})})();"
fi

echo "[4/5] Ensuring PropertyRegistry.sol is deployed and updating backend/.env..."
NEED_DEPLOY=$(node -e "
const fs=require('fs'), {ethers}=require('./backend/node_modules/ethers');
const env=fs.existsSync('backend/.env')?fs.readFileSync('backend/.env','utf8'):'';
const m=env.match(/^CONTRACT_ADDRESS=\"?(0x[0-9a-fA-F]{40})\"?/m);
if(!m){console.log('yes');process.exit(0);}
const p=new ethers.JsonRpcProvider('http://127.0.0.1:8545');
p.getCode(m[1]).then(c=>console.log(c==='0x'?'yes':'no')).catch(()=>console.log('yes'));
")

if [ "$NEED_DEPLOY" = "yes" ]; then
  DEPLOY_OUT="$(cd "$ROOT_DIR/contracts-project" && npx hardhat run scripts/deploy.js --network localhost)"
  echo "$DEPLOY_OUT"
  DEPLOYED_ADDR="$(printf '%s\n' "$DEPLOY_OUT" | node -e "const fs=require('fs');const txt=fs.readFileSync(0,'utf8');const m=txt.match(/PropertyRegistry deployed to:\\s*(0x[0-9a-fA-F]{40})/i);if(!m)process.exit(1);process.stdout.write(m[1]);")"
  node -e "const fs=require('fs');const p='backend/.env';let env=fs.readFileSync(p,'utf8');const addr='$DEPLOYED_ADDR';if(/^CONTRACT_ADDRESS=.*$/m.test(env)){env=env.replace(/^CONTRACT_ADDRESS=.*$/m,'CONTRACT_ADDRESS=\"'+addr+'\"');}else{env+='\nCONTRACT_ADDRESS=\"'+addr+'\"\n';}fs.writeFileSync(p,env);console.log('Updated backend/.env CONTRACT_ADDRESS='+addr);"
else
  echo "PropertyRegistry already deployed at address in backend/.env."
fi

echo "[5/5] Starting Backend (4000) and Frontend (5173)..."
(cd "$ROOT_DIR/backend" && npm start > /tmp/staysure-backend.log 2>&1) &
PIDS+=($!)

(cd "$ROOT_DIR/frontend" && npm run dev > /tmp/staysure-frontend.log 2>&1) &
PIDS+=($!)

sleep 2
if command -v open >/dev/null 2>&1; then
  open "http://localhost:5173" >/dev/null 2>&1 || true
fi

echo ""
echo "StaySure is running! (Press Ctrl+C to stop)"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:4000"
echo "  Hardhat:  http://127.0.0.1:8545"
echo "  Logs:     /tmp/staysure-backend.log, /tmp/staysure-frontend.log"
echo ""

wait
