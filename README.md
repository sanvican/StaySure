# StaySure

A cryptographic **"Freshness & Anti-Tamper Seal"** for rental property listings—proving to guests that the photos shown today are the exact, unaltered photos verified on a specific date, without ever placing private photos, street addresses, or exact GPS coordinates on a public blockchain.

See `architecture.md` for the full system specification.

---

## Stack
- **Smart Contract:** Solidity `^0.8.20`, Hardhat 2, OpenZeppelin (`AccessControl`, `MerkleProof`)
- **Backend:** Node.js, Express.js, Prisma ORM + SQLite, `ethers` v6, `sharp`, `bcryptjs`, `jsonwebtoken`
- **Frontend:** React 18, Vite, React Router, plain CSS (`getUserMedia` + Geolocation API)

---

## Setup & Run (Local)

### 1. Smart Contract (`contracts-project/`)
```bash
cd contracts-project
npm install
npm test
```

Start a local Hardhat node and deploy `PropertyRegistry.sol`:
```bash
# Terminal 1
cd contracts-project
npx hardhat node

# Terminal 2
cd contracts-project
npm run deploy:local
```
Copy the deployed `PropertyRegistry` address into `backend/.env` as `CONTRACT_ADDRESS` (the default first Hardhat address `0x5FbDB2315678afecb367f032d93F642f64180aa3` is prefilled in `backend/.env`).

### 2. Backend (`backend/`)
```bash
cd backend
npm install
cp .env.example .env   # edit CONTRACT_ADDRESS if needed
npx prisma generate
npx prisma db push
npm start              # http://localhost:4000
```

### 3. Frontend (`frontend/`)
```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

---

## Testing & Evaluation

- **Smart contract tests:**
  ```bash
  cd contracts-project && npm test
  ```
- **Backend unit & API integration tests:**
  ```bash
  cd backend && npm test
  ```
- **Perceptual hash (pHash) precision/recall evaluation:**
  ```bash
  node eval/evaluatePhash.js
  ```
- **End-to-end live demo script (requires Hardhat node + deployed contract):**
  ```bash
  cd backend && npm run demo:e2e
  ```
- **Freshness expiry batch job (30-day expiry / 25-day due-soon):**
  ```bash
  cd backend && npm run check-expiry
  ```
