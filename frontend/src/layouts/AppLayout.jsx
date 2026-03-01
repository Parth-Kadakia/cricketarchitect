import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/fixtures', label: 'Season Center' },
  { to: '/league', label: 'Table & Seasons' },
  { to: '/squad', label: 'Player Cards' },
  { to: '/youth', label: 'Youth Academy' },
  { to: '/transfer-market', label: 'Transfers' },
  { to: '/marketplace', label: 'City Market' },
  { to: '/financials', label: 'Valuation' },
  { to: '/trophies', label: 'Trophies' }
];

export default function AppLayout() {
  const { user, franchise, logout } = useAuth();
  const { connected } = useSocket();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="brand-overline">Global T20</p>
          <h1>Franchise Notebook</h1>
          <span className={`status-pill ${connected ? 'online' : 'offline'}`}>{connected ? 'Live Feed On' : 'Live Feed Off'}</span>
        </div>

        <nav className="nav-links">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p>{user?.display_name}</p>
          <button className="button ghost" type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <div>
            <h2>{franchise?.franchise_name || 'Select Your City Franchise'}</h2>
            <p>
              {franchise?.city_name
                ? `${franchise.city_name}, ${franchise.country} • League ${franchise?.league_tier || franchise?.current_league_tier || 1}`
                : 'Choose one city and build from the bottom.'}
            </p>
          </div>
          <div className="top-metrics">
            <div>
              <span>Prospect Points</span>
              <strong>{franchise?.prospect_points ?? 0}</strong>
            </div>
            <div>
              <span>Growth Points</span>
              <strong>{franchise?.growth_points ?? 0}</strong>
            </div>
            <div>
              <span>Value</span>
              <strong>${Number(franchise?.total_valuation || 100).toFixed(2)}</strong>
            </div>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
