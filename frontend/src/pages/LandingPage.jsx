import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setPageTitle } from '../utils/format';

/* ── Inline SVG icons ──────────────────────────────────── */
const Icons = {
  globe: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
  ),
  flag: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
  ),
  layers: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.84Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>
  ),
  users: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/></svg>
  ),
  zap: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>
  ),
  shield: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
  ),
  trendingUp: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
  ),
  trophy: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
  ),
  briefcase: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>
  ),
  bat: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 18 2 2"/><path d="M3.47 9.77a.5.5 0 0 1 .04-.68l7.58-7.58a.5.5 0 0 1 .68-.04l6.34 5.07a.5.5 0 0 1 .04.73L11.18 14a.5.5 0 0 1-.64.06z"/><path d="m11 14-1 5-3 3"/></svg>
  ),
  chevronRight: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  ),
};

const FEATURES = [
  {
    icon: Icons.globe,
    title: 'Club Franchise Career',
    desc: 'Choose any city from 1,200+ worldwide. Found a T20 franchise. Climb a 52-club, 4-league pyramid with promotion and relegation every season.',
    accent: 'var(--accent)',
  },
  {
    icon: Icons.flag,
    title: 'International Career',
    desc: 'Take charge of a national team. Manage a four-year Future Tours Programme with 100 countries, global rankings, bilateral T20 series, and a World Cup every cycle.',
    accent: 'var(--info)',
  },
  {
    icon: Icons.briefcase,
    title: 'Manager Career & Board',
    desc: 'Earn XP, level up to 100, build reputation. Meet board expectations every 3 rounds on win rate, league position, youth pipeline, and squad strength — or get sacked.',
    accent: 'var(--warning)',
  },
  {
    icon: Icons.zap,
    title: 'Ball-by-Ball Match Engine',
    desc: 'Live T20 simulation via WebSocket. Pitch conditions, weather, wind, ground size, 9 bowling styles, 5 batsman types, phase-aware play, scorecards, and AI match analysis.',
    accent: 'var(--danger)',
  },
  {
    icon: Icons.users,
    title: 'Youth Academy & Scouting',
    desc: 'Run a regional scouting network. Generate prospects, invest in growth cycles, upgrade academy level 1–10, and promote talent into your starting XI.',
    accent: 'var(--success)',
  },
  {
    icon: Icons.trendingUp,
    title: 'Transfers & Club Economy',
    desc: 'Auction market, player loans, salary cap, club valuation formula with 6 components. CPU teams actively buy, sell, and upgrade around you.',
    accent: '#f472b6',
  },
  {
    icon: Icons.shield,
    title: 'Hire, Fire & Job Market',
    desc: 'Get fired? Enter the unemployed job market. Receive 3–6 board offers, apply to open teams, or wait for the right opportunity to get back in.',
    accent: '#a78bfa',
  },
  {
    icon: Icons.trophy,
    title: 'Stats, Records & Legacy',
    desc: 'Top 100 leaderboards (16 batting, 14 bowling columns), head-to-head, match archive, Excel export, trophy cabinet, and a full statbook across every season.',
    accent: '#fb923c',
  },
];

const STATS = [
  { value: '52', label: 'Club Teams' },
  { value: '100', label: 'National Teams' },
  { value: '4Y', label: 'FTP Cycle' },
  { value: '25', label: 'Data Tables' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => { setPageTitle('Cricket Architect — Build Your Dynasty'); }, []);

  if (token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="landing">
      {/* ── NAVBAR ──────────────────────────────────────── */}
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-nav-brand">
            {Icons.bat}
            <span>Cricket Architect</span>
          </div>
          <div className={`landing-nav-links ${mobileMenuOpen ? 'open' : ''}`}>
            <a href="#modes" onClick={() => setMobileMenuOpen(false)}>Career Paths</a>
            <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
            <a href="#engine" onClick={() => setMobileMenuOpen(false)}>Match Engine</a>
            <a href="#how" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
          </div>
          <div className="landing-nav-actions">
            <button className="landing-btn-ghost" onClick={() => navigate('/login')}>
              Sign In
            </button>
            <button className="landing-btn-primary" onClick={() => navigate('/login?mode=register')}>
              Start Free {Icons.chevronRight}
            </button>
          </div>
          <button className="landing-mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileMenuOpen
                ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
              }
            </svg>
          </button>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-hero-bg">
          {/* Decorative cricket field arcs */}
          <div className="landing-deco landing-deco--circle" />
          <div className="landing-deco landing-deco--pitch" />
          <div className="landing-deco landing-deco--glow" />
        </div>

        <div className="landing-hero-content">
          <span className="landing-hero-badge">🏏 Free-to-Play Browser Game</span>
          <h1 className="landing-hero-title">
            Build a Cricket Dynasty.<br />
            <span className="landing-hero-accent">Club or Country.</span>
          </h1>
          <p className="landing-hero-sub">
            The deepest cricket management sim ever made. Pick a franchise from 1,200+ cities or manage one of 100 national teams.
            Ball-by-ball match engine, youth development, transfers, board pressure — every decision shapes your legacy.
          </p>

          <div className="landing-hero-cta">
            <button className="landing-btn-hero" onClick={() => navigate('/login?mode=register')}>
              Create Your Career {Icons.chevronRight}
            </button>
            <button className="landing-btn-secondary" onClick={() => navigate('/login')}>
              Sign In to Continue
            </button>
          </div>

          <div className="landing-stats-row">
            {STATS.map((s) => (
              <div className="landing-stat" key={s.label}>
                <span className="landing-stat-value">{s.value}</span>
                <span className="landing-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF TICKER ─────────────────────────── */}
      <section className="landing-ticker">
        <div className="landing-ticker-inner">
          <span>🏟️ 52-club league pyramid</span>
          <span>🌍 100+ national teams</span>
          <span>⚡ Ball-by-ball engine</span>
          <span>📊 25+ data tables</span>
          <span>🧑‍💼 Manager XP &amp; reputation</span>
          <span>🏆 World Cup every 4 years</span>
        </div>
      </section>

      {/* ── TWO CAREER PATHS ────────────────────────────── */}
      <section className="landing-modes" id="modes">
        <div className="landing-section-header">
          <p className="landing-overline">Two Career Paths</p>
          <h2>Club or Country. You Choose.</h2>
          <p className="landing-section-sub">
            Two completely different experiences with shared depth. One save, one career, years of decisions ahead.
          </p>
        </div>

        <div className="landing-modes-grid">
          <div className="landing-mode-card landing-mode-card--club">
            <div className="landing-mode-badge">Most Popular</div>
            <div className="landing-mode-icon">{Icons.globe}</div>
            <h3>Club T20 Franchise</h3>
            <p className="landing-mode-tagline">Pick any city. Build from nothing. Dominate the pyramid.</p>
            <ul>
              <li>Pick any city from 1,200+ worldwide</li>
              <li>52-club league with 4 tiers</li>
              <li>Full transfer market, loans &amp; salary cap</li>
              <li>Promotion, relegation, league finals</li>
              <li>Club valuation with 6-component formula</li>
              <li>Buy &amp; sell franchises on the marketplace</li>
            </ul>
            <button className="landing-mode-cta" onClick={() => navigate('/login?mode=register')}>
              Start Club Career {Icons.chevronRight}
            </button>
          </div>

          <div className="landing-mode-card landing-mode-card--intl">
            <div className="landing-mode-badge landing-mode-badge--intl">New</div>
            <div className="landing-mode-icon">{Icons.flag}</div>
            <h3>International Management</h3>
            <p className="landing-mode-tagline">Lead your nation through a four-year FTP cycle to the World Cup.</p>
            <ul>
              <li>100+ nations from Afghanistan to Zimbabwe</li>
              <li>4-year Future Tours Programme calendar</li>
              <li>Every nation faces the full world once per cycle</li>
              <li>Global rankings decide World Cup qualification</li>
              <li>Top 32 reach the World Cup every four years</li>
              <li>No transfers — results and youth development only</li>
            </ul>
            <button className="landing-mode-cta" onClick={() => navigate('/login?mode=register')}>
              Start International Career {Icons.chevronRight}
            </button>
          </div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────── */}
      <section className="landing-features" id="features">
        <div className="landing-section-header">
          <p className="landing-overline">Built for Depth</p>
          <h2>Everything a Cricket Manager Needs</h2>
          <p className="landing-section-sub">
            From board pressure to ball-by-ball drama — every system is connected. Nothing is cosmetic.
          </p>
        </div>

        <div className="landing-features-grid">
          {FEATURES.map((f) => (
            <div className="landing-feature-card" key={f.title}>
              <div className="landing-feature-icon" style={{ '--feature-accent': f.accent }}>
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── MATCH ENGINE SHOWCASE ──────────────────────── */}
      <section className="landing-engine" id="engine">
        <div className="landing-section-header">
          <p className="landing-overline">The Heart of the Game</p>
          <h2>Ball-by-Ball T20 Match Engine</h2>
          <p className="landing-section-sub">
            Not just a dice roll. A physics-aware simulation with 9 bowling styles, 5 batting types, matchups, fatigue, pitch, weather, and phase-aware logic.
          </p>
        </div>

        <div className="landing-engine-grid">
          <div className="landing-engine-card">
            <span className="landing-engine-num">9</span>
            <h4>Bowling Styles</h4>
            <p>Express Pace, Swing, Seam, Cutters, Off/Leg Spin, Left-arm, Mystery — each with unique delivery profiles and phase effectiveness.</p>
          </div>
          <div className="landing-engine-card">
            <span className="landing-engine-num">7</span>
            <h4>Pitch Conditions</h4>
            <p>Good, green, flat, dusty, dry, damp, bouncy — combined with weather, wind, time of day, and ground dimensions.</p>
          </div>
          <div className="landing-engine-card">
            <span className="landing-engine-num">20</span>
            <h4>Overs Simulated</h4>
            <p>Every ball generates commentary, tracks momentum, models fatigue, and respects real T20 phases — powerplay, middle, death.</p>
          </div>
          <div className="landing-engine-card">
            <span className="landing-engine-num">AI</span>
            <h4>Smart CPU</h4>
            <p>CPU teams manage squads, buy &amp; sell players, develop youth, upgrade academies, and hire/fire managers autonomously.</p>
          </div>
        </div>
      </section>

      {/* ── MANAGER CAREER ─────────────────────────────── */}
      <section className="landing-manager">
        <div className="landing-section-header">
          <p className="landing-overline">Your Reputation is Everything</p>
          <h2>Survive the Board. Build a Legacy.</h2>
          <p className="landing-section-sub">
            This isn&apos;t just a game of wins. Your board watches, evaluates, and will sack you if you fail.
          </p>
        </div>

        <div className="landing-manager-grid">
          <div className="landing-manager-item">
            <span className="landing-manager-num">62</span>
            <div>
              <h4>Starting Confidence</h4>
              <p>Every board starts at 62/100. Meet targets to keep their trust. Fall below 24 and you are out.</p>
            </div>
          </div>
          <div className="landing-manager-item">
            <span className="landing-manager-num">4</span>
            <div>
              <h4>Board Objectives</h4>
              <p>Win rate, league position, youth pipeline, and squad strength. Checkpoints every 3 rounds.</p>
            </div>
          </div>
          <div className="landing-manager-item">
            <span className="landing-manager-num">XP</span>
            <div>
              <h4>Manager Progression</h4>
              <p>Earn XP every match. Level up to 100. Build reputation across multiple clubs.</p>
            </div>
          </div>
          <div className="landing-manager-item">
            <span className="landing-manager-num">?</span>
            <div>
              <h4>Fired? Not Over.</h4>
              <p>Enter the job market. Receive board offers. Apply to open teams. Get back in the game.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── DATA DEPTH ──────────────────────────────────── */}
      <section className="landing-data">
        <div className="landing-data-inner">
          <div className="landing-data-text">
            <p className="landing-overline">Stats &amp; Records</p>
            <h2>25+ Database Tables. Infinite Stories.</h2>
            <p>
              Top 100 leaderboards with 16 batting and 14 bowling columns. Head-to-head records.
              Full match archive with ball-by-ball data. Season histories, trophy cabinets, career timelines.
              Export anything to Excel/CSV.
            </p>
          </div>
          <div className="landing-data-numbers">
            <div className="landing-data-num"><strong>16</strong><span>Batting Columns</span></div>
            <div className="landing-data-num"><strong>14</strong><span>Bowling Columns</span></div>
            <div className="landing-data-num"><strong>25+</strong><span>Data Tables</span></div>
            <div className="landing-data-num"><strong>∞</strong><span>Match Archive</span></div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────── */}
      <section className="landing-how" id="how">
        <div className="landing-section-header">
          <p className="landing-overline">Get Started in 60 Seconds</p>
          <h2>Three Steps to Your First Match</h2>
        </div>

        <div className="landing-steps">
          <div className="landing-step">
            <div className="landing-step-num">1</div>
            <h3>Pick Your Path</h3>
            <p>Club franchise or national team. Choose a city or country and create your identity.</p>
          </div>
          <div className="landing-step-divider" />
          <div className="landing-step">
            <div className="landing-step-num">2</div>
            <h3>Build Your Squad</h3>
            <p>Scout youth, set your starting XI, manage transfers, and prepare for match day.</p>
          </div>
          <div className="landing-step-divider" />
          <div className="landing-step">
            <div className="landing-step-num">3</div>
            <h3>Climb the Ladder</h3>
            <p>Simulate rounds, win titles, survive the board, and build a multi-season dynasty.</p>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ───────────────────────────────────── */}
      <section className="landing-cta-section">
        <div className="landing-cta-card">
          <div className="landing-cta-icon">🏏</div>
          <h2>Ready to Manage?</h2>
          <p>Free to play. No downloads. No app store. Start your career in the browser right now.</p>
          <div className="landing-cta-actions">
            <button className="landing-btn-hero" onClick={() => navigate('/login?mode=register')}>
              Start Your Career {Icons.chevronRight}
            </button>
            <button className="landing-btn-ghost-light" onClick={() => navigate('/login')}>
              or sign in to continue
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            {Icons.bat}
            <span>Cricket Architect</span>
          </div>
          <p>Club &middot; International &middot; Single-player cricket management</p>
        </div>
      </footer>
    </div>
  );
}
