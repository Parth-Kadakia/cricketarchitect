# Cricket Architect — The Most Data-Rich Cricket Management Game Ever Built

**Every ball. Every boundary. Every breakthrough. Tracked, stored, and queryable forever.**

Cricket Architect doesn't just simulate matches — it builds a living, breathing statistical universe across every player, team, and season in your career. From ball-by-ball delivery logs to multi-season career aggregates, no cricket game has ever gone this deep.

---

## 📊 Stats at a Glance

| Category | Tracked Metrics |
|----------|----------------|
| **Batting (per match)** | Runs, Balls Faced, Fours, Sixes, Strike Rate, Dismissal Type, Batting Order, Not Outs |
| **Bowling (per match)** | Overs, Runs Conceded, Wickets, Maidens, Economy Rate |
| **Fielding (per match)** | Catches, Run Outs |
| **Match Performance** | Player Rating (per match), Player of the Match |
| **Career Batting** | Career Matches, Runs, Balls, Fours, Sixes, Fifties, Hundreds, Player of the Match Awards |
| **Career Bowling** | Career Wickets, Overs Bowled, Runs Conceded |
| **Career Fielding** | Career Catches |
| **Player Rankings** | Top 100 Batsmen, Top 100 Bowlers, Top 100 All-Rounders — filterable by season or all-time |
| **League Standings** | Played, Won, Lost, Tied, Points, Net Run Rate, Runs For, Balls Faced, Runs Against, Balls Bowled, League Position, Movement (Promoted / Relegated / Stay) |
| **Match Scorecard** | Full batting card, full bowling card, fall of wickets, partnerships, extras, run rate, required rate |
| **Ball-by-Ball** | Every delivery logged: striker, non-striker, bowler, runs, extras, boundaries, sixes, wickets, commentary text |
| **Over-by-Over** | Runs per over, wickets per over, cumulative score, required runs, balls remaining, required rate, summary |
| **Fall of Wickets** | Wicket number, score at fall, ball/over label, batter dismissed, dismissal description |
| **Partnerships** | Partnership number, runs, balls, both batters' individual contributions |
| **Innings Summary** | Total runs, wickets, balls, run rate, target, required rate, summary text |
| **Player Attributes** | Batting, Bowling, Fielding, Fitness, Temperament, Potential (all 0–100), Age, Role, Morale, Form |
| **Player Growth** | Per-season deltas for Batting, Bowling, Fielding, Fitness, Temperament, and Market Value |
| **Franchise Financials** | Balance, Revenue, Expenses, Salary Totals, Transfer Spend, Prize Money, Sponsorships, Academy Investment |
| **Club Valuation** | Base Value, Win Bonus, Streak Bonus, Cup Bonus, Fan Bonus, Player Bonus, Total Valuation — tracked every season |
| **Franchise Record** | Wins, Losses, Championships, Win Streak, Best Win Streak, Fan Rating, Promotions, Relegations |
| **Youth Academy** | Academy Level (1–10), Youth Development Rating, Prospect Points, Growth Points, Regional Quality Ratings |
| **Transfer Activity** | Full transfer feed: CPU buys/sells, loans, retirements, player movements, season notes |
| **Trophy Cabinet** | Every title won, linked to season and franchise |
| **Season History** | Season number, year, format, competition mode, team count, league count, status, date range |

---

## 🏏 Batting Leaderboard — 16 Columns Deep

The batting rankings page alone tracks **16 statistical columns** per player:

`#` · `Player` · `Team` · `Role` · `Age` · `Matches` · `Innings` · `Runs` · `Balls` · `Average` · `Strike Rate` · `Highest Score` · `Fours` · `Sixes` · `Not Outs` · `Rating`

Filter by season or view all-time career aggregates across hundreds of matches.

## 🎳 Bowling Leaderboard — 14 Columns Deep

`#` · `Player` · `Team` · `Role` · `Age` · `Matches` · `Overs` · `Runs Conceded` · `Wickets` · `Average` · `Economy` · `Best Wickets` · `Maidens` · `Rating`

## ⚡ All-Rounder Rankings — 12 Columns

`#` · `Player` · `Team` · `Role` · `Age` · `Matches` · `Runs` · `Strike Rate` · `Wickets` · `Economy` · `Catches` · `Rating`

---

## 🔬 Match-Level Granularity

Every single match generates:

- **Full ball-by-ball event log** — delivery type, runs, extras, boundaries, wickets, striker/non-striker/bowler identity, and natural language commentary
- **Over-by-over progression** — cumulative scores, run rates, wickets per over, required rate for chasing teams
- **Partnership breakdowns** — every batting pair's contribution in runs and balls with individual batter splits
- **Fall of wickets timeline** — exact score, over, ball number, and dismissal description for each wicket
- **Individual scorecards** — separate batting and bowling cards for both innings
- **Innings summaries** — total score, wickets, overs, run rate, target, required rate
- **Player of the Match** — algorithmically selected and stored per match
- **Toss result and decision** — winner and bat/bowl choice
- **Result summary** — natural language description ("Team A won by 5 wickets")
- **AI match analysis** — generated narrative of the match storyline

---

## 📈 Career-Long Tracking

Every player accumulates **persistent career statistics** that follow them across seasons:

- Career Matches Played
- Career Runs Scored
- Career Balls Faced
- Career Fours and Sixes
- Career Fifties and Hundreds
- Career Wickets Taken
- Career Overs Bowled
- Career Runs Conceded
- Career Catches
- Career Player of the Match Awards

These are **not recalculated** — they are incremented in real time as matches complete, giving you instant access to any player's complete career at a glance.

---

## 📉 Player Growth Logs

Every season, the game records **attribute deltas** for each player:

- Batting change (e.g., +3)
- Bowling change (e.g., -1)
- Fielding, Fitness, Temperament changes
- Market value change

This creates a **full development history** — you can trace a youth prospect's journey from a 35-rated teenager to a 78-rated star across multiple seasons.

---

## 💰 Financial Depth

Every transaction in the game is categorized and stored:

| Transaction Type | Description |
|------------------|-------------|
| `SALARY` | Weekly/seasonal player wages |
| `TRANSFER_IN` | Player purchase cost |
| `TRANSFER_OUT` | Sale revenue |
| `LOAN` | Loan fees |
| `SPONSORSHIP` | Sponsor income |
| `PRIZE_MONEY` | League/cup prize payouts |
| `SALE` | Franchise sale proceeds |
| `PURCHASE` | Franchise acquisition cost |
| `ACADEMY_UPGRADE` | Youth academy investment |
| `POINT_REWARD` | Special point-based rewards |

Club valuation is a **composite metric** broken into six components — all tracked historically:

> Base Value + Win Bonus + Streak Bonus + Cup Bonus + Fan Bonus + Player Bonus = **Total Valuation**

---

## 🏆 League Table Precision

Standing tables track **10+ data points** per team per season:

- Matches Played, Won, Lost, Tied
- Points
- Runs Scored / Balls Faced (for NRR calculation)
- Runs Conceded / Balls Bowled (for NRR calculation)
- **Net Run Rate** — calculated from real match data, not approximated
- League Position
- Movement indicator (Promoted / Relegated / Stayed / New)
- Previous league tier

---

## 🌍 Two Career Modes, Same Statistical Depth

Whether you play **Club T20** (city-based franchise) or **International** (national team), every stat listed above is tracked identically. 100+ national teams or 50+ club franchises — same engine, same depth.

---

## 🔑 Keywords

`cricket management game` · `cricket statistics engine` · `ball-by-ball cricket simulation` · `T20 management sim` · `cricket career mode` · `player development tracking` · `cricket analytics game` · `franchise management` · `cricket scorecard generator` · `over-by-over match simulation` · `net run rate calculator` · `cricket league system` · `youth academy cricket` · `cricket transfer market` · `partnership statistics` · `fall of wickets tracker` · `cricket player ratings` · `career batting average` · `bowling economy tracker` · `cricket game with real stats` · `deep cricket simulation` · `cricket data game` · `player growth system` · `cricket valuation model` · `full scorecard cricket game`

---

*Cricket Architect — Where every run counts and every stat tells a story.*
