import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { TeamModalProvider } from '../context/TeamModalContext';

/* ── Inline SVG icons (Lucide-style, 18×18) ─────────── */
const Icon = ({ d, ...p }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d={d} />
  </svg>
);

const Icons = {
  dashboard: (p) => <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...p} />,
  fixtures: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  league: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  stats: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  squad: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  youth: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  transfer: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  marketplace: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  financials: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  trophies: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  ),
  menu: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  logout: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
};

function getNavItems(mode) {
  const isInternational = String(mode || '').toUpperCase() === 'INTERNATIONAL';
  return [
    { to: '/', label: 'Dashboard', icon: 'dashboard' },
    { to: '/fixtures', label: 'Season Center', icon: 'fixtures' },
    { to: '/league', label: 'Table & Seasons', icon: 'league' },
    { to: '/stats', label: 'Rankings', icon: 'stats' },
    { to: '/statbook', label: 'Statbook', icon: 'stats' },
    { to: '/squad', label: 'Player Cards', icon: 'squad' },
    { to: '/youth', label: 'Youth Academy', icon: 'youth' },
    ...(isInternational ? [] : [{ to: '/transfer-market', label: 'Transfers', icon: 'transfer' }]),
    { to: '/marketplace', label: isInternational ? 'Team Market' : 'City Market', icon: 'marketplace' },
    ...(isInternational ? [] : [{ to: '/financials', label: 'Valuation', icon: 'financials' }]),
    { to: '/trophies', label: 'Trophies', icon: 'trophies' }
  ];
}

export default function AppLayout() {
  const { user, franchise, logout } = useAuth();
  const { connected } = useSocket();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navItems = getNavItems(franchise?.competition_mode || user?.career_mode || 'CLUB');
  const isInternational = String(franchise?.competition_mode || user?.career_mode || '').toUpperCase() === 'INTERNATIONAL';
  const topMetricValue = isInternational
    ? Number(franchise?.strength_rating ?? franchise?.total_valuation ?? 0)
    : Number(franchise?.total_valuation || 100);

  return (
    <div className="app-shell">
      {/* Mobile hamburger */}
      <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">
        <Icons.menu />
      </button>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="brand-block">
          <p className="brand-overline">Global T20</p>
          <h1>Cricket Architect</h1>
          <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        <nav className="nav-links">
          {navItems.map((item) => {
            const IconComp = Icons[item.icon];
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setSidebarOpen(false)}>
                {IconComp && <IconComp />}
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <p>{user?.display_name}</p>
          <button className="button ghost" type="button" onClick={logout}>
            <Icons.logout />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <button className="mobile-menu-btn top-bar-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">
            <Icons.menu />
          </button>
          <div>
            <h2>{franchise?.franchise_name || 'Start Your Career'}</h2>
            <p>
              {franchise?.city_name
                ? `${franchise.city_name}, ${franchise.country} • League ${franchise?.league_tier || franchise?.current_league_tier || 1}`
                : 'Choose your career mode and build from the bottom.'}
            </p>
          </div>
          <div className="top-metrics">
            <div>
              <span>Prospect Pts</span>
              <strong>{franchise?.prospect_points ?? 0}</strong>
            </div>
            <div>
              <span>Growth Pts</span>
              <strong>{franchise?.growth_points ?? 0}</strong>
            </div>
            <div>
              <span>{isInternational ? 'Strength' : 'Value'}</span>
              <strong>{isInternational ? topMetricValue.toFixed(1) : `$${topMetricValue.toFixed(2)}`}</strong>
            </div>
          </div>
        </header>

        <TeamModalProvider>
          <Outlet />
        </TeamModalProvider>
      </main>
    </div>
  );
}
