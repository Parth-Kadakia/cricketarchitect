# Cricket Architect — Build Your Cricket Empire From the Ground Up

**The deepest single-player cricket management career game ever made. Free. Browser-based. No downloads.**

---

## What is Cricket Architect?

Cricket Architect is a full-stack cricket management simulation where you take charge of a T20 franchise or a national team and build a dynasty from nothing. Pick a city, assemble a squad of unknowns, develop youth, survive board pressure, climb the pyramid, and compete for the championship — season after season.

This isn't a one-off match app. It's a persistent career with financials, player growth, promotion/relegation, manager reputation, and a 52-club world ecosystem that runs around you.

---

## Two Career Paths

### Club T20 Franchise
- Pick any city from **1,200+ worldwide** to found your franchise
- Compete in a **52-club, 4-league pyramid** with promotion and relegation
- Full transfer market, player loans, and club finances
- Club valuation grows from wins, streaks, trophies, and squad quality
- Home-and-away double round-robin league seasons

### International Management
- Choose from **100+ nations** — Afghanistan to Zimbabwe
- **10 divisions** with promotion and relegation
- No transfers — results and youth development only
- Build squad strength through call-ups and performance
- Rise through pure cricket merit

---

## Core Features

### Ball-by-Ball Match Engine (3,800+ lines)
- Full T20 simulation with toss, pitch conditions (good/green/flat/dusty/damp/bouncy), weather, wind, time of day, and ground size
- **Live ball-by-ball** mode via WebSocket with configurable speed, or instant simulation
- Realistic batting/bowling outcomes influenced by skill, form, morale, temperament, fitness, and match phase (Powerplay/Middle/Death)
- 9 bowling styles (Express Pace, Swing, Seam, Cutters, Off Spin, Leg Spin, Left-arm Orthodox, Left-arm Wrist, Mystery Spin)
- 4 bowler mentalities (Wicket Taker, Economical, Powerplay Specialist, Death Over Specialist)
- 5 batsman types (Aggressive, Defensive, Balanced, Accumulator, Tail Ender)
- Dismissal types: bowled, caught, LBW, run out, stumped
- Player of the Match, AI match analysis narrative, full scorecards

### Live Match Center
- Real-time ball-by-ball feed via WebSocket
- Batting & bowling scorecards for both innings
- Over-by-over progression chart (worm-style)
- Partnership breakdowns and fall of wickets timeline
- Innings summary with run rate, target, required rate
- Match result and Player of the Match display

### Squad Management
- Full squad view with attributes, roles, form, morale
- **Starting XI selection** with batting order builder
- **Smart auto-lineup** — generates a balanced XI (1 WK, 4 BAT, 2 AR, 4 BOWL)
- Promote youth to main squad / demote back
- Loan players to other franchises
- Release players from roster
- **Salary cap** ($120) with payroll tracking
- View any franchise's squad

### Youth Academy & Scouting
- Regional scouting network with quality ratings
- Generate prospects using Prospect Points (region-aware realistic names)
- Apply seasonal growth cycles to all youth players
- Upgrade academy quality (Level 1–10) and youth development rating using Growth Points
- Role-aware growth multipliers — batters grow batting faster, bowlers grow bowling faster
- Growth history tracked per player with sparkline visualization

### Manager Career & Board System
- Manager XP, level (1–100), reputation, and persistent career record
- **Board confidence** (0–100) with checkpoint evaluations every 3 rounds
- 4 board objectives: win rate, league position, youth pipeline, squad strength
- Drop too low → **you get sacked**
- **Job market** when unemployed — receive 3–6 offers, apply to open positions, or wait
- Manager directory with profiles, power scores, and stint history
- CPU managers with their own careers, levels, and movement between clubs

### Transfer Market & Economy
- Auction pool with role/sort filters — buy players for your squad
- CPU teams actively buy, sell, loan, upgrade academies, and generate prospects
- Full transfer feed — chronological log of all activity across the world
- Disabled in International mode (by design)

### Franchise Marketplace
- Browse all 52 franchises with valuation, record, and tier info
- List your franchise for sale or sell instantly
- Purchase CPU or unowned franchises and take over
- Franchise sales history tracked

### Financials & Valuation
- Cash balance, payroll, player market value, cash flow health rating
- Full transaction history (Salary, Transfer In/Out, Loan, Sponsorship, Prize Money, Academy Upgrade, etc.)
- **Club valuation formula**: Base + Win Bonus + Streak Bonus + Cup Bonus + Fan Bonus + Player Bonus
- Valuation history tracked per season with sparkline chart

### League System
- Double round-robin fixtures (Club) / single round-robin (International)
- Full **standings table** with NRR, points, movement indicators
- **Promotion & relegation** — top 2 up, bottom 2 down every season
- League finals / playoff stage
- Season-to-season continuity with automatic next season creation
- Season history browseable across all past years

### Statistics & Records — Deepest in Any Cricket Game
- **Top 100 Batsmen** — 16 columns (Matches, Innings, Runs, Balls, Avg, SR, HS, 4s, 6s, NOs, Rating…)
- **Top 100 Bowlers** — 14 columns (Matches, Overs, Runs, Wkts, Avg, Econ, Best, Maidens, Rating…)
- **Top All-Rounders** — 12 columns
- Filter by season or all-time
- **Excel export** for all stat tables

### Statbook & Records
- Match archive — every match ever played, paginated and filterable
- Player records: most runs, most wickets, best average, best SR, best economy, most 50s/100s/6s, fastest 50, fastest 100, best bowling innings
- Team records: most wins, highest/lowest totals, biggest wins by runs/wickets
- **Head-to-head**: pick any two teams and see full match history and results
- Overview: total matches, runs, wickets, overs, milestones across the world

### Trophy Room & Legacy
- Trophy cabinet for every championship won
- Retired players archive
- Seasonal history with standings snapshots

### Player System
- 6 core attributes (0–100): Batting, Bowling, Fielding, Fitness, Temperament, Potential
- Dynamic morale and form affected by results
- Persistent career stats: Runs, Wickets, Catches, 50s, 100s, PotM awards
- Growth logs per season — every attribute delta recorded
- Retirement system based on age + fitness, with automatic replacement generation
- Market value and salary tracked throughout career

### Simulation Controls
- Simulate **next round**, **my league round**, **half-season**, or **full season**
- Simulate individual matches from fixtures page
- Live simulation with WebSocket progress updates
- Season auto-creation when current season ends

---

## Technical Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Database | PostgreSQL (25 tables) |
| Realtime | WebSockets |
| Auth | JWT + bcrypt |
| Hosting | Browser-based, free to play |

---

## What Makes This Different?

- **Not a mobile clicker.** This is a full management sim with real depth.
- **Every ball is tracked.** 25 database tables store ball-by-ball data, partnerships, fall of wickets, over progression, career aggregates — everything.
- **Two full career modes.** Club franchise with finances and transfers, or international management focused purely on results.
- **Manager career is real.** Board pressure, sacking, job market, offers, reputation — your manager career persists across jobs.
- **CPU world is alive.** CPU teams buy, sell, loan, upgrade academies, hire/fire managers — all without your input.
- **Season after season.** Promotion, relegation, retirements, youth development, growth — every season builds on the last.
- **Stats you can export.** Excel export for batting, bowling, and all-rounder leaderboards.
- **Free, browser-based.** No app store. No downloads. Sign up and play.

---

## Screenshots?

Coming soon — but honestly, just sign up and try it. It takes 30 seconds to start your first career.

---

**Play now: [your-url-here]**

Questions? Feedback? Drop a comment below — actively developing and shipping updates regularly.
