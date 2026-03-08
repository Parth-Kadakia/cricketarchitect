import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/* ── Inline SVG icons ──────────────────────────────────── */
const Icons = {
  globe: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
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
  trendingUp: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
  ),
  trophy: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
  ),
  bat: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 18 2 2"/><path d="M3.47 9.77a.5.5 0 0 1 .04-.68l7.58-7.58a.5.5 0 0 1 .68-.04l6.34 5.07a.5.5 0 0 1 .04.73L11.18 14a.5.5 0 0 1-.64.06z"/><path d="m11 14-1 5-3 3"/></svg>
  ),
  chevronRight: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  ),
  star: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  ),
};

const FEATURES = [
  {
    icon: Icons.globe,
    title: 'Global Franchise Career',
    desc: 'Pick any city worldwide. Build your club identity & culture from scratch. Shape its future season after season.',
    accent: 'var(--accent)',
  },
  {
    icon: Icons.layers,
    title: '4-League World Pyramid',
    desc: '52 clubs across Leagues 1–4. Full home & away seasons. Promotion, relegation, and a grand final every year.',
    accent: 'var(--info)',
  },
  {
    icon: Icons.users,
    title: 'Youth Academy',
    desc: 'Region-based prospect scouting. Invest in coaching, upgrade your pipeline, and promote talent to the first team.',
    accent: 'var(--success)',
  },
  {
    icon: Icons.zap,
    title: 'Match Day Drama',
    desc: 'Full T20 sim with ball-by-ball commentary, scorecards, worm charts, player-of-the-match, and toss dynamics.',
    accent: 'var(--warning)',
  },
  {
    icon: Icons.trendingUp,
    title: 'Living Club Economy',
    desc: 'Valuation grows from wins, streaks & trophies. Active transfer market with auctions, loans, and CPU activity.',
    accent: '#f472b6',
  },
  {
    icon: Icons.trophy,
    title: 'Career Legacy',
    desc: 'Persistent records across seasons. Trophy room, player histories, and the story of your rise from the bottom.',
    accent: '#fb923c',
  },
];

const STATS = [
  { value: '52', label: 'Global Clubs' },
  { value: '4', label: 'League Tiers' },
  { value: '120+', label: 'Balls per Match' },
  { value: '∞', label: 'Seasons to Play' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { token } = useAuth();

  // If already logged in, go straight to dashboard
  if (token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="landing">
      {/* ── HERO ────────────────────────────────────────── */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />

        <nav className="landing-nav">
          <div className="landing-nav-brand">
            {Icons.bat}
            <span>Cricket Architect</span>
          </div>
          <div className="landing-nav-actions">
            <button className="landing-btn-ghost" onClick={() => navigate('/login')}>
              Sign In
            </button>
            <button className="landing-btn-primary" onClick={() => navigate('/login?mode=register')}>
              Start Free {Icons.chevronRight}
            </button>
          </div>
        </nav>

        <div className="landing-hero-content">
          <div className="landing-hero-badge">
            {Icons.star}
            <span>Single-Player Career Mode</span>
          </div>

          <h1 className="landing-hero-title">
            Build Your Cricket<br />
            <span className="landing-gradient-text">Empire From Nothing.</span>
          </h1>

          <p className="landing-hero-sub">
            Choose a city. Develop unknown talent. Climb a 4-league global pyramid.
            Win the world title. This is your career — every decision matters.
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

        {/* Decorative cricket ball seam */}
        <div className="landing-hero-seam" />
      </section>

      {/* ── FEATURES ────────────────────────────────────── */}
      <section className="landing-features" id="features">
        <div className="landing-section-header">
          <p className="landing-overline">Everything You Need</p>
          <h2>A Complete Cricket<br />Management Experience</h2>
          <p className="landing-section-sub">
            From youth scouting to match-day tactics to financial growth — every layer is built for depth.
          </p>
        </div>

        <div className="landing-features-grid">
          {FEATURES.map((f) => (
            <div className="landing-feature-card" key={f.title}>
              <div className="landing-feature-icon" style={{ color: f.accent, background: `${f.accent}14` }}>
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────── */}
      <section className="landing-how">
        <div className="landing-section-header">
          <p className="landing-overline">Get Started in Minutes</p>
          <h2>Three Steps to Glory</h2>
        </div>

        <div className="landing-steps">
          <div className="landing-step">
            <div className="landing-step-num">1</div>
            <h3>Choose Your City</h3>
            <p>Pick any city in the world. Your franchise, your identity, your journey starts here.</p>
          </div>
          <div className="landing-step-divider" />
          <div className="landing-step">
            <div className="landing-step-num">2</div>
            <h3>Build & Compete</h3>
            <p>Develop youth talent, set your starting XI, and fight your way up the league pyramid.</p>
          </div>
          <div className="landing-step-divider" />
          <div className="landing-step">
            <div className="landing-step-num">3</div>
            <h3>Win The Title</h3>
            <p>Rise from League 4 to League 1. Win the grand final. Build a dynasty that lasts.</p>
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ──────────────────────────────────── */}
      <section className="landing-cta-section">
        <div className="landing-cta-card">
          <h2>Ready to Build Your Legacy?</h2>
          <p>Free to play. No downloads. Jump in and start your career right now.</p>
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
          <p>Global T20 Franchise Manager &middot; Single-player career mode</p>
        </div>
      </footer>
    </div>
  );
}
