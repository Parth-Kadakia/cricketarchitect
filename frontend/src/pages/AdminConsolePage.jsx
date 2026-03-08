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
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [actionBusy, setActionBusy] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);

  useEffect(() => { setPageTitle('Admin Console'); }, []);

  // Gate: only admin can see this
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  const loadUsers = useCallback(async () => {
    try {
      const data = await api.admin.users(token);
      setUsers(data.users || []);
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

  return (
    <div className="admin-console">
      {/* ── Header ── */}
      <div className="admin-header">
        <div className="admin-header-text">
          <h1>Admin Console</h1>
          <p className="admin-subtitle">System overview and user management</p>
        </div>
        <div className="admin-header-actions">
          <button
            className="admin-action-btn admin-action-primary"
            disabled={!!actionBusy}
            onClick={() => runAction('Bootstrap', () => api.admin.bootstrap(token))}
          >
            {Icons.bolt}
            {actionBusy === 'Bootstrap' ? 'Running…' : 'Bootstrap'}
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="admin-summary">
        <div className="admin-summary-card admin-card-accent">
          <div className="admin-card-icon">{Icons.users}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{totalUsers}</span>
            <span className="admin-summary-label">Total Users</span>
          </div>
        </div>
        <div className="admin-summary-card admin-card-success">
          <div className="admin-card-icon">{Icons.active}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{activeManagers}</span>
            <span className="admin-summary-label">Active Managers</span>
          </div>
        </div>
        <div className="admin-summary-card admin-card-info">
          <div className="admin-card-icon">{Icons.franchise}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{withFranchise}</span>
            <span className="admin-summary-label">With Franchise</span>
          </div>
        </div>
        <div className="admin-summary-card admin-card-warning">
          <div className="admin-card-icon">{Icons.matches}</div>
          <div className="admin-card-content">
            <span className="admin-summary-value">{totalMatches}</span>
            <span className="admin-summary-label">Total Matches</span>
          </div>
        </div>
      </div>

      {/* ── Quick actions panel ── */}
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
        </div>
      </div>

      {/* ── Users section ── */}
      <div className="admin-users-section">
        <h3 className="admin-section-label">Users</h3>

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
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="admin-th-user">User</th>
                  <th>Career</th>
                  <th>Franchise</th>
                  <th>League</th>
                  <th>Record</th>
                  <th>Titles</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Last Active</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr
                    key={u.id}
                    className={expandedRow === u.id ? 'admin-row-expanded' : ''}
                    onClick={() => setExpandedRow(expandedRow === u.id ? null : u.id)}
                  >
                    <td>
                      <div className="admin-user-cell">
                        <div className="admin-avatar">
                          {(u.display_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="admin-user-info">
                          <span className="admin-user-name">{u.display_name}</span>
                          <span className="admin-user-email">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`admin-badge ${u.career_mode === 'INTERNATIONAL' ? 'badge-intl' : 'badge-club'}`}>
                        {u.career_mode === 'INTERNATIONAL' ? 'Intl' : 'Club'}
                      </span>
                    </td>
                    <td>
                      {u.franchise_name ? (
                        <div className="admin-franchise-cell">
                          <span className="admin-franchise-name">{u.franchise_name}</span>
                          <span className="admin-user-email">{u.city_name}{u.country ? `, ${u.country}` : ''}</span>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {u.current_league_tier ? (
                        <span className="admin-tier-badge">T{u.current_league_tier}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {u.manager_matches_managed > 0 ? (
                        <div className="admin-record-cell">
                          <span className="admin-record-wins">{u.manager_wins_managed}W</span>
                          <span className="admin-record-sep">·</span>
                          <span className="admin-record-losses">{u.manager_losses_managed}L</span>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={Number(u.championships || u.manager_titles || 0) > 0 ? 'admin-titles-highlight' : ''}>
                        {u.championships || u.manager_titles || 0}
                      </span>
                    </td>
                    <td>
                      {u.total_valuation ? (
                        <span className="admin-value-cell">${Number(u.total_valuation).toFixed(0)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`admin-status-badge ${u.manager_status === 'ACTIVE' ? 'status-active' : u.manager_status === 'RETIRED' ? 'status-retired' : 'status-unemployed'}`}>
                        <span className="admin-status-dot" />
                        {u.manager_status}
                      </span>
                    </td>
                    <td>
                      <span className="admin-time-cell" title={u.last_active_at}>
                        {timeAgo(u.last_active_at)}
                      </span>
                    </td>
                    <td>
                      <span className="admin-date-cell">{fmtDate(u.created_at)}</span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan="10" className="admin-empty-row">
                      <div className="admin-empty-state">
                        {Icons.users}
                        <p>{search ? 'No users match your search.' : 'No users yet.'}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
