@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"
set "ROOT_DIR=%~dp0"
set "HARDHAT_DISABLE_TELEMETRY_PROMPT=true"

echo ============================================
echo   StaySure - One-Click Local Launcher
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)

echo [1/5] Checking dependencies...
if not exist "contracts-project\node_modules" (
    echo Installing contracts-project dependencies...
    pushd "contracts-project"
    call npm install || goto :error
    popd
)

if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    pushd "backend"
    call npm install || goto :error
    popd
)

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    pushd "frontend"
    call npm install || goto :error
    popd
)

echo [2/5] Preparing backend environment and SQLite database...
if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
)

pushd "backend"
call npx prisma generate || goto :error
call npx prisma db push || goto :error
popd

echo [3/5] Starting local Hardhat blockchain node...
node -e "const s=require('net').connect(8545,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));"
if errorlevel 1 (
    start "StaySure Hardhat Node (8545)" /D "%ROOT_DIR%contracts-project" cmd /k "set HARDHAT_DISABLE_TELEMETRY_PROMPT=true && npx hardhat node"
    echo Waiting for Hardhat node on 127.0.0.1:8545...
    node -e "const net=require('net');let tries=0;(function wait(){const s=net.connect(8545,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>{if(++tries>30)process.exit(1);setTimeout(wait,500)})})();"
    if errorlevel 1 (
        echo [ERROR] Hardhat node did not start on port 8545 in time.
        pause
        exit /b 1
    )
) else (
    echo Hardhat node already running on port 8545.
)

echo [4/5] Deploying PropertyRegistry.sol and updating backend\.env...
pushd "contracts-project"
call npx hardhat run scripts/deploy.js --network localhost > "%TEMP%\staysure_deploy.txt"
if errorlevel 1 goto :error
popd

type "%TEMP%\staysure_deploy.txt"
node -e "const fs=require('fs'),path=require('path');const out=fs.readFileSync(path.join(process.env.TEMP,'staysure_deploy.txt'),'utf8');const m=out.match(/PropertyRegistry deployed to:\s*(0x[0-9a-fA-F]{40})/i);if(!m){console.error('Could not find deployed contract address');process.exit(1);}const envPath='backend/.env';let env=fs.readFileSync(envPath,'utf8');if(/^CONTRACT_ADDRESS=.*$/m.test(env)){env=env.replace(/^CONTRACT_ADDRESS=.*$/m,'CONTRACT_ADDRESS=\"'+m[1]+'\"');}else{env+='\nCONTRACT_ADDRESS=\"'+m[1]+'\"\n';}fs.writeFileSync(envPath,env);console.log('Updated backend/.env CONTRACT_ADDRESS='+m[1]);"
if errorlevel 1 goto :error

echo [5/5] Launching StaySure Backend (4000) and Frontend (5173)...
start "StaySure Backend (4000)" /D "%ROOT_DIR%backend" cmd /k "npm start"
start "StaySure Frontend (5173)" /D "%ROOT_DIR%frontend" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo StaySure is running!
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:4000
echo   Hardhat:  http://127.0.0.1:8545
echo.
exit /b 0

:error
echo.
echo [ERROR] Setup or startup failed. Check the messages above.
pause
exit /b 1
