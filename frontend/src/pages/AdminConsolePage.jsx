import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api/client';
import { timeAgo, setPageTitle } from '../utils/format';

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Inline SVG icons (small, purposeful) ── */
const Icons = {
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  active: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  franchise: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  matches: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  bolt: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  refresh: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  cpu: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  ),
  clock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  retire: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18" /><path d="M6 6l12 12" />
    </svg>
  ),
  sort: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 3 18 9" /><polyline points="6 15 12 21 18 15" />
    </svg>
  ),
  trophy: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" /><path d="M18 2H6v7a6 6 0 1 0 12 0V2Z" />
    </svg>
  ),
  chart: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  globe: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  player: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

function pct(w, l) {
  const total = Number(w || 0) + Number(l || 0);
  return total > 0 ? ((Number(w || 0) / total) * 100).toFixed(1) + '%' : '—';
}

function num(v) { return Number(v || 0); }
function money(v) { return `$${Number(v || 0).toFixed(2)}`; }

const SORT_OPTIONS = [
  { key: 'created_at', label: 'Newest', dir: 'desc' },
  { key: 'display_name', label: 'Name A-Z', dir: 'asc' },
  { key: 'last_active_at', label: 'Active', dir: 'desc' },
  { key: 'total_valuation', label: 'Value', dir: 'desc' },
];

export default function AdminConsolePage() {
  const { user, token } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [actionBusy, setActionBusy] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [wipeTyped, setWipeTyped] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => { setPageTitle('Admin Console'); }, []);

  // Gate: only admin can see this
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  const loadUsers = useCallback(async () => {
    try {
      const [usersData, statsData] = await Promise.all([
        api.admin.users(token),
        api.admin.stats(token)
      ]);
      setUsers(usersData.users || []);
      setStats(statsData || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  /* ── Admin actions ── */
  async function runAction(key, fn) {
    setActionBusy(key);
    try {
      const result = await fn();
      toast.success(`${key} completed`);
      loadUsers();
      return result;
    } catch (err) {
      toast.error(err.message || `${key} failed`);
    } finally {
      setActionBusy(null);
    }
  }

  /* ── Filtering & sorting ── */
  const filtered = users
    .filter((u) => {
      if (statusFilter !== 'ALL' && u.manager_status !== statusFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        u.email?.toLowerCase().includes(q) ||
        u.display_name?.toLowerCase().includes(q) ||
        u.franchise_name?.toLowerCase().includes(q) ||
        u.city_name?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const opt = SORT_OPTIONS.find((o) => o.key === sortKey) || SORT_OPTIONS[0];
      const dir = opt.dir === 'asc' ? 1 : -1;
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
      return String(aVal).localeCompare(String(bVal)) * dir;
    });

  const totalUsers = users.length;
  const activeManagers = users.filter((u) => u.manager_status === 'ACTIVE').length;
  const withFranchise = users.filter((u) => u.franchise_id).length;
  const totalMatches = users.reduce((s, u) => s + Number(u.manager_matches_managed || 0), 0);

  const statusCounts = {
    ALL: users.length,
    ACTIVE: activeManagers,
    UNEMPLOYED: users.filter((u) => u.manager_status === 'UNEMPLOYED').length,
    RETIRED: users.filter((u) => u.manager_status === 'RETIRED').length,
  };

  const s = stats || {};
  const su = s.users || {};
  const sf = s.franchises || {};
  const ss = s.seasons || {};
  const sm = s.matches || {};
  const sp = s.players || {};
  const careerModeEntries = (s.careerModes || []).map((entry) => ({
    key: entry.career_mode,
    label: entry.career_mode === 'INTERNATIONAL' ? 'International' : 'Club',
    count: Number(entry.count || 0)
  }));

  return (
    <div className="admin-console">
      {/* ── Header ── */}
      <div className="admin-hero">
        <div className="admin-hero-copy">
          <h1>Admin Console</h1>
          <p className="admin-subtitle">Live system health, user governance, and world operations.</p>
          <div className="admin-hero-pills">
            <span className="admin-hero-pill">Users {num(su.total_users) || totalUsers}</span>
            <span className="admin-hero-pill">World Matches {num(sm.total_matches)}</span>
            <span className="admin-hero-pill">Franchises {num(sf.total_franchises) || withFranchise}</span>
          </div>
        </div>
        <div className="admin-hero-actions">
          <button
            className="admin-action-btn admin-action-primary"
            disabled={!!actionBusy}
            onClick={() => runAction('Bootstrap', () => api.admin.bootstrap(token))}
          >
            {Icons.bolt}
            {actionBusy === 'Bootstrap' ? 'Running…' : 'Bootstrap'}
          </button>
          <button
            className="admin-action-btn admin-action-secondary"
            disabled={!!actionBusy}
            onClick={() => runAction('CPU Market Cycle', () => api.admin.cpuCycle(token))}
          >
            {Icons.cpu}
            {actionBusy === 'CPU Market Cycle' ? 'Running…' : 'CPU Cycle'}
          </button>
        </div>
      </div>

      {/* ── Summary cards (from live stats) ── */}
      <div className="admin-summary">
        <div className="admin-summary-card admin-card-accent">
          <div className="admin-card-icon">{Icons.users}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{num(su.total_users) || totalUsers}</span>
            <span className="admin-summary-label">Total Users</span>
            {num(su.signups_24h) > 0 && <span className="admin-card-delta">+{su.signups_24h} today</span>}
          </div>
        </div>
        <div className="admin-summary-card admin-card-success">
          <div className="admin-card-icon">{Icons.active}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{num(su.active_managers) || activeManagers}</span>
            <span className="admin-summary-label">Active Managers</span>
            {num(su.active_24h) > 0 && <span className="admin-card-delta">{su.active_24h} online today</span>}
          </div>
        </div>
        <div className="admin-summary-card admin-card-info">
          <div className="admin-card-icon">{Icons.franchise}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{num(sf.total_franchises) || withFranchise}</span>
            <span className="admin-summary-label">Franchises</span>
            {num(sf.user_owned) > 0 && <span className="admin-card-delta">{sf.user_owned} user-owned</span>}
          </div>
        </div>
        <div className="admin-summary-card admin-card-warning">
          <div className="admin-card-icon">{Icons.matches}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{num(sm.total_matches)}</span>
            <span className="admin-summary-label">Total Matches</span>
            {num(sm.live_matches) > 0 && <span className="admin-card-delta">{sm.live_matches} live</span>}
          </div>
        </div>
      </div>

      {/* ── Main tabs ── */}
      <div className="admin-main-tabs">
        <button className={`admin-main-tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
          {Icons.chart} Overview
        </button>
        <button className={`admin-main-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          {Icons.users} Users
        </button>
        <button className={`admin-main-tab ${activeTab === 'actions' ? 'active' : ''}`} onClick={() => setActiveTab('actions')}>
          {Icons.bolt} Actions
        </button>
      </div>

      {/* ════════════════ OVERVIEW TAB ════════════════ */}
      {activeTab === 'overview' && stats && (
        <div className="admin-overview">
          {/* ── Stats grid ── */}
          <div className="admin-stats-grid">
            <div className="admin-stats-section">
              <h4 className="admin-section-label">{Icons.player} Users &amp; Managers</h4>
              <div className="admin-kpi-grid">
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(su.total_users)}</span><span className="admin-kpi-label">Total Users</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(su.active_managers)}</span><span className="admin-kpi-label">Active Managers</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{pct(su.total_user_wins, su.total_user_losses)}</span><span className="admin-kpi-label">Manager Win Rate</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(su.total_user_titles)}</span><span className="admin-kpi-label">Titles Won</span></div>
              </div>
              <div className="admin-metric-list">
                <div className="admin-metric-row"><span>Unemployed</span><strong>{num(su.unemployed)}</strong></div>
                <div className="admin-metric-row"><span>Retired</span><strong>{num(su.retired)}</strong></div>
                <div className="admin-metric-row"><span>Online 24h</span><strong>{num(su.active_24h)}</strong></div>
                <div className="admin-metric-row"><span>Online 7d</span><strong>{num(su.active_7d)}</strong></div>
                <div className="admin-metric-row"><span>New 24h</span><strong>{num(su.signups_24h)}</strong></div>
                <div className="admin-metric-row"><span>New 7d</span><strong>{num(su.signups_7d)}</strong></div>
                <div className="admin-metric-row"><span>User Matches</span><strong>{num(su.total_user_matches)}</strong></div>
              </div>
              <div className="admin-chip-row">
                {careerModeEntries.length ? careerModeEntries.map((mode) => (
                  <span key={mode.key} className="admin-mode-chip">
                    {mode.label}
                    <strong>{mode.count}</strong>
                  </span>
                )) : <span className="admin-mode-chip">No career data</span>}
              </div>
            </div>

            <div className="admin-stats-section">
              <h4 className="admin-section-label">{Icons.franchise} Franchises</h4>
              <div className="admin-kpi-grid">
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sf.total_franchises)}</span><span className="admin-kpi-label">Total Clubs</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sf.user_owned)}</span><span className="admin-kpi-label">User-Owned</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sf.cpu_controlled)}</span><span className="admin-kpi-label">CPU-Run</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{pct(sf.total_franchise_wins, sf.total_franchise_losses)}</span><span className="admin-kpi-label">Overall Win%</span></div>
              </div>
              <div className="admin-metric-list">
                <div className="admin-metric-row"><span>Available</span><strong>{num(sf.available)}</strong></div>
                <div className="admin-metric-row"><span>Avg Value</span><strong>{money(sf.avg_valuation)}</strong></div>
                <div className="admin-metric-row"><span>Max Value</span><strong>{money(sf.max_valuation)}</strong></div>
                <div className="admin-metric-row"><span>Championships</span><strong>{num(sf.total_championships)}</strong></div>
              </div>
            </div>

            <div className="admin-stats-section">
              <h4 className="admin-section-label">{Icons.globe} Seasons &amp; Matches</h4>
              <div className="admin-kpi-grid">
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(ss.total_seasons)}</span><span className="admin-kpi-label">Seasons</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(ss.active_seasons)}</span><span className="admin-kpi-label">Active</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sm.total_matches)}</span><span className="admin-kpi-label">Matches</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sm.completed_matches)}</span><span className="admin-kpi-label">Played</span></div>
              </div>
              <div className="admin-metric-list">
                <div className="admin-metric-row"><span>Completed Seasons</span><strong>{num(ss.completed_seasons)}</strong></div>
                <div className="admin-metric-row"><span>Scheduled Matches</span><strong>{num(sm.scheduled_matches)}</strong></div>
                <div className="admin-metric-row"><span>Live Matches</span><strong>{num(sm.live_matches)}</strong></div>
              </div>
            </div>

            <div className="admin-stats-section">
              <h4 className="admin-section-label">{Icons.player} Players</h4>
              <div className="admin-kpi-grid">
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sp.total_players)}</span><span className="admin-kpi-label">Total Players</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sp.main_squad)}</span><span className="admin-kpi-label">Main Squad</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sp.youth)}</span><span className="admin-kpi-label">Youth</span></div>
                <div className="admin-kpi-card"><span className="admin-kpi-value">{num(sp.retired_players)}</span><span className="admin-kpi-label">Retired</span></div>
              </div>
              <div className="admin-metric-list">
                <div className="admin-metric-row"><span>Avg Age</span><strong>{Number(sp.avg_age || 0).toFixed(1)}</strong></div>
                <div className="admin-metric-row"><span>Avg Value</span><strong>{money(sp.avg_market_value)}</strong></div>
                <div className="admin-metric-row"><span>Avg Batting</span><strong>{Number(sp.avg_batting || 0).toFixed(1)}</strong></div>
                <div className="admin-metric-row"><span>Avg Bowling</span><strong>{Number(sp.avg_bowling || 0).toFixed(1)}</strong></div>
              </div>
            </div>
          </div>

          {/* ── Top franchises ── */}
          <div className="admin-overview-panels">
            {(s.topFranchises || []).length > 0 && (
              <section className="admin-overview-panel">
                <div className="admin-overview-panel-head">
                  <h4 className="admin-section-label">{Icons.trophy} Top Franchises by Value</h4>
                  <span className="admin-panel-meta">{s.topFranchises.length} entries</span>
                </div>
                <div className="admin-ranking-list">
                  {s.topFranchises.map((f, i) => (
                    <div key={i} className="admin-ranking-row">
                      <div className="admin-ranking-pos">{i + 1}</div>
                      <div className="admin-ranking-main">
                        <strong>{f.franchise_name}</strong>
                        <span>{f.city_name}, {f.country}</span>
                      </div>
                      <div className="admin-ranking-side">
                        <span>{f.owner_name || 'CPU'}</span>
                        <strong>{money(f.total_valuation)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(s.recentSignups || []).length > 0 && (
              <section className="admin-overview-panel">
                <div className="admin-overview-panel-head">
                  <h4 className="admin-section-label">{Icons.users} Recent Signups</h4>
                  <span className="admin-panel-meta">{s.recentSignups.length} recent</span>
                </div>
                <div className="admin-signup-list">
                  {s.recentSignups.map((u) => (
                    <div key={u.id} className="admin-signup-row">
                      <div className="admin-signup-main">
                        <strong>{u.display_name}</strong>
                        <span>{u.email}</span>
                      </div>
                      <div className="admin-signup-side">
                        <span className={`admin-badge ${u.career_mode === 'INTERNATIONAL' ? 'badge-intl' : 'badge-club'}`}>
                          {u.career_mode === 'INTERNATIONAL' ? 'International' : 'Club'}
                        </span>
                        <span>{fmtDate(u.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {activeTab === 'overview' && !stats && !loading && (
        <div className="admin-loading"><span>No stats available yet.</span></div>
      )}

      {/* ════════════════ USERS TAB ════════════════ */}
      {activeTab === 'users' && (
        <div className="admin-users-section">
          {/* ── Status filter tabs ── */}
          <div className="admin-filter-tabs">
            {Object.entries(statusCounts).map(([key, count]) => (
              <button
                key={key}
                className={`admin-tab ${statusFilter === key ? 'active' : ''}`}
                onClick={() => setStatusFilter(key)}
              >
                {key === 'ALL' ? 'All' : key.charAt(0) + key.slice(1).toLowerCase()}
                <span className="admin-tab-count">{count}</span>
              </button>
            ))}
          </div>

          {/* ── Toolbar: search + sort ── */}
          <div className="admin-toolbar">
            <div className="admin-search-wrap">
              <span className="admin-search-icon">{Icons.search}</span>
              <input
                type="text"
                className="admin-search"
                placeholder="Search by name, email, city, or franchise…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="admin-search-clear" onClick={() => setSearch('')}>×</button>
              )}
            </div>
            <div className="admin-toolbar-right">
              <select
                className="admin-sort-select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>Sort: {opt.label}</option>
                ))}
              </select>
              <span className="admin-count">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {loading && (
            <div className="admin-loading">
              <div className="sq-spinner" />
              <span>Loading users…</span>
            </div>
          )}
          {error && <p className="admin-error">{error}</p>}

          {!loading && !error && (
            filtered.length > 0 ? (
              <div className="admin-user-grid">
                {filtered.map((u) => {
                  const isExpanded = expandedRow === u.id;
                  return (
                    <article key={u.id} className={`admin-user-card ${isExpanded ? 'admin-user-card--expanded' : ''}`}>
                      <button
                        type="button"
                        className="admin-user-card-head"
                        onClick={() => setExpandedRow(isExpanded ? null : u.id)}
                      >
                        <div className="admin-user-cell">
                          <div className="admin-avatar">
                            {(u.display_name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="admin-user-info">
                            <span className="admin-user-name">{u.display_name}</span>
                            <span className="admin-user-email">{u.email}</span>
                          </div>
                        </div>
                        <div className="admin-user-card-head-right">
                          <span className={`admin-badge ${u.career_mode === 'INTERNATIONAL' ? 'badge-intl' : 'badge-club'}`}>
                            {u.career_mode === 'INTERNATIONAL' ? 'International' : 'Club'}
                          </span>
                          <span className={`admin-status-badge ${u.manager_status === 'ACTIVE' ? 'status-active' : u.manager_status === 'RETIRED' ? 'status-retired' : 'status-unemployed'}`}>
                            <span className="admin-status-dot" />
                            {u.manager_status}
                          </span>
                        </div>
                      </button>

                      <div className="admin-user-card-body">
                        <div className="admin-user-card-summary">
                          <div className="admin-user-summary-block">
                            <span className="admin-user-summary-label">Team</span>
                            <strong>{u.franchise_name || 'Unemployed'}</strong>
                            <span>{u.franchise_name ? `${u.city_name || '—'}${u.country ? `, ${u.country}` : ''}` : 'No active team'}</span>
                          </div>
                          <div className="admin-user-summary-block">
                            <span className="admin-user-summary-label">Activity</span>
                            <strong>{timeAgo(u.last_active_at)}</strong>
                            <span>Joined {fmtDate(u.created_at)}</span>
                          </div>
                          <div className="admin-user-summary-block">
                            <span className="admin-user-summary-label">Career</span>
                            <strong>{u.manager_points || 0} pts</strong>
                            <span>{u.manager_titles || 0} titles • {u.manager_firings || 0} firings</span>
                          </div>
                        </div>

                        <div className="admin-user-card-stats">
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{u.manager_matches_managed || 0}</span>
                            <span className="admin-user-stat-label">Managed</span>
                          </div>
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{u.manager_wins_managed || 0}W</span>
                            <span className="admin-user-stat-label">Wins</span>
                          </div>
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{u.manager_losses_managed || 0}L</span>
                            <span className="admin-user-stat-label">Losses</span>
                          </div>
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{pct(u.manager_wins_managed, u.manager_losses_managed)}</span>
                            <span className="admin-user-stat-label">Win Rate</span>
                          </div>
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{u.current_league_tier ? `T${u.current_league_tier}` : '—'}</span>
                            <span className="admin-user-stat-label">Tier</span>
                          </div>
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{u.squad_size || 0}</span>
                            <span className="admin-user-stat-label">Squad</span>
                          </div>
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{u.total_valuation ? `$${Number(u.total_valuation).toFixed(0)}` : '—'}</span>
                            <span className="admin-user-stat-label">Value</span>
                          </div>
                          <div className="admin-user-stat">
                            <span className="admin-user-stat-value">{u.main_xi || 0}</span>
                            <span className="admin-user-stat-label">XI</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="admin-user-expand"
                          onClick={() => setExpandedRow(isExpanded ? null : u.id)}
                        >
                          {isExpanded ? 'Hide Details' : 'Open Details'}
                        </button>

                        {isExpanded && (
                          <div className="admin-user-detail-panels">
                            <section className="admin-user-detail-panel">
                              <h5>Manager Profile</h5>
                              <div className="admin-detail-items">
                                <span>Points: <strong>{u.manager_points}</strong></span>
                                <span>Firings: <strong>{u.manager_firings}</strong></span>
                                <span>Titles: <strong>{u.manager_titles}</strong></span>
                                <span>Matches: <strong>{u.manager_matches_managed}</strong></span>
                                <span>Wins: <strong>{u.manager_wins_managed}</strong></span>
                                <span>Losses: <strong>{u.manager_losses_managed}</strong></span>
                                <span>Win Rate: <strong>{pct(u.manager_wins_managed, u.manager_losses_managed)}</strong></span>
                              </div>
                            </section>

                            {u.franchise_id && (
                              <section className="admin-user-detail-panel">
                                <h5>Franchise</h5>
                                <div className="admin-detail-items">
                                  <span>Name: <strong>{u.franchise_name}</strong></span>
                                  <span>City: <strong>{u.city_name}, {u.country}</strong></span>
                                  <span>Tier: <strong>{u.current_league_tier}</strong></span>
                                  <span>Record: <strong>{u.f_wins}W · {u.f_losses}L</strong></span>
                                  <span>Value: <strong>${Number(u.total_valuation || 0).toFixed(2)}</strong></span>
                                  <span>Balance: <strong>${Number(u.financial_balance || 0).toFixed(2)}</strong></span>
                                  <span>Fan Rating: <strong>{Number(u.fan_rating || 0).toFixed(1)}</strong></span>
                                  <span>Academy Lvl: <strong>{u.academy_level}</strong></span>
                                  <span>Prospect Pts: <strong>{u.prospect_points}</strong></span>
                                  <span>Growth Pts: <strong>{u.growth_points}</strong></span>
                                </div>
                              </section>
                            )}

                            {u.franchise_id && (
                              <section className="admin-user-detail-panel">
                                <h5>Squad</h5>
                                <div className="admin-detail-items">
                                  <span>Total Players: <strong>{u.squad_size}</strong></span>
                                  <span>Main Squad: <strong>{u.main_xi}</strong></span>
                                  <span>Youth: <strong>{u.youth_count}</strong></span>
                                  <span>Avg OVR: <strong>{u.avg_ovr}</strong></span>
                                </div>
                              </section>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="admin-empty-state admin-empty-state--panel">
                {Icons.users}
                <p>{search ? 'No users match your search.' : 'No users yet.'}</p>
              </div>
            )
          )}
        </div>
      )}

      {/* ════════════════ ACTIONS TAB ════════════════ */}
      {activeTab === 'actions' && (
        <div className="admin-actions-panel">
          <h3 className="admin-section-label">Quick Actions</h3>
          <div className="admin-actions-grid">
            <button
              className="admin-action-tile"
              disabled={!!actionBusy}
              onClick={() => runAction('Inactivity Sweep', () => api.admin.inactivityRun(token))}
            >
              {Icons.clock}
              <span>{actionBusy === 'Inactivity Sweep' ? 'Running…' : 'Inactivity Sweep'}</span>
            </button>
            <button
              className="admin-action-tile"
              disabled={!!actionBusy}
              onClick={() => runAction('CPU Market Cycle', () => api.admin.cpuCycle(token))}
            >
              {Icons.cpu}
              <span>{actionBusy === 'CPU Market Cycle' ? 'Running…' : 'CPU Market Cycle'}</span>
            </button>
            <button
              className="admin-action-tile"
              disabled={!!actionBusy}
              onClick={() => runAction('Rebalance Season', () => api.admin.rebalanceSeason(token, {}))}
            >
              {Icons.refresh}
              <span>{actionBusy === 'Rebalance Season' ? 'Running…' : 'Rebalance Season'}</span>
            </button>
            <button
              className="admin-action-tile"
              disabled={!!actionBusy}
              onClick={() => runAction('Run Retirements', () => api.admin.retirements(token))}
            >
              {Icons.retire}
              <span>{actionBusy === 'Run Retirements' ? 'Running…' : 'Run Retirements'}</span>
            </button>
            <button
              className="admin-action-tile admin-action-danger"
              disabled={!!actionBusy}
              onClick={() => setShowWipeConfirm(true)}
            >
              {Icons.retire}
              <span>Wipe All Data</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Wipe confirmation modal ── */}
      {showWipeConfirm && (
        <div className="sq-modal-backdrop" role="presentation" onClick={() => { setShowWipeConfirm(false); setWipeTyped(''); }}>
          <div className="admin-wipe-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Wipe All Game Data</h3>
            <p className="admin-wipe-warn">
              This will <strong>permanently delete</strong> all worlds, franchises, players, seasons, matches, and stats.
              User accounts will be kept but reset to unemployed.
            </p>
            <label className="admin-wipe-label">
              Type <code>WIPE</code> to confirm:
              <input
                type="text"
                className="admin-wipe-input"
                value={wipeTyped}
                onChange={(e) => setWipeTyped(e.target.value)}
                placeholder="WIPE"
                autoFocus
              />
            </label>
            <div className="admin-wipe-actions">
              <button
                className="admin-action-btn"
                onClick={() => { setShowWipeConfirm(false); setWipeTyped(''); }}
              >
                Cancel
              </button>
              <button
                className="admin-action-btn admin-action-danger-btn"
                disabled={wipeTyped.trim() !== 'WIPE' || !!actionBusy}
                onClick={async () => {
                  setShowWipeConfirm(false);
                  setWipeTyped('');
                  await runAction('Wipe All Data', () => api.admin.wipeAll(token));
                }}
              >
                {actionBusy === 'Wipe All Data' ? 'Wiping…' : 'Wipe Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="admin-loading">
          <div className="sq-spinner" />
          <span>Loading…</span>
        </div>
      )}
    </div>
  );
}
