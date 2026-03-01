# Global T20 Franchise Manager

Single-player full-stack cricket management game.

- You control **1 franchise**.
- The rest of the league is **CPU-controlled**.
- League size is **52 total teams** split into **4 leagues** with home + away fixtures inside each league.
- Franchise starts at **$100.00** and grows from wins, streaks, player performance, and trophies.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL
- Realtime: WebSockets (`ws`)
- Auth: JWT + bcrypt

## Core gameplay in this build

- City claim flow with no pre-owned demo team
- 52-team world pyramid (League 1-4) with season + round structures
- Full match engine with:
  - Ball-by-ball commentary
  - Scorecards (batting + bowling)
  - Worm-style over chart data
  - Player of the match
- Win rewards:
  - `+5 prospect points`
  - `+5 growth points`
- Youth academy progression is point-based only
- Region/country-aware realistic player name generation
- Retirement system at season rollover
- CPU transfer/loan/sell activity feed
- Player cards with career + match stats

## Project structure

```text
backend/
  src/
    db/
    routes/
    services/
    ws/
frontend/
  src/
    pages/
    components/
```

## Setup

1. Start PostgreSQL:

```bash
docker compose up -d postgres
```

2. Install dependencies:

```bash
npm install
```

3. Configure env files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

4. Initialize DB + bootstrap full world:

```bash
npm run db:init
```

5. Run backend + frontend:

```bash
npm run dev
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173`

## Demo login

- `demo@globalt20.com`
- `Demo@123`

## Key API endpoints

- `POST /api/franchises/claim`
- `GET /api/franchises/me`
- `POST /api/youth/upgrade`
- `POST /api/league/simulate-next-round`
- `POST /api/league/simulate-season`
- `GET /api/league/matches/:matchId/scorecard`
- `GET /api/marketplace/transfer-feed`
- `GET /api/squad/player/:playerId`
