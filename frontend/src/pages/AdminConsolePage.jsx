import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminConsolePage() {
  const { user, token } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Gate: only admin can see this
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  useEffect(() => {
    async function load() {
      try {
        const data = await api.admin.users(token);
        setUsers(data.users || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.display_name?.toLowerCase().includes(q) ||
      u.franchise_name?.toLowerCase().includes(q) ||
      u.city_name?.toLowerCase().includes(q)
    );
  });

  const totalUsers = users.length;
  const activeManagers = users.filter((u) => u.manager_status === 'ACTIVE').length;
  const withFranchise = users.filter((u) => u.franchise_id).length;
  const totalMatches = users.reduce((s, u) => s + Number(u.manager_matches_managed || 0), 0);

  return (
    <div className="admin-console">
      <div className="admin-header">
        <div>
          <h1>Admin Console</h1>
          <p className="admin-subtitle">All registered users and their game stats</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="admin-summary">
        <div className="admin-summary-card">
          <span className="admin-summary-value">{totalUsers}</span>
          <span className="admin-summary-label">Total Users</span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-value">{activeManagers}</span>
          <span className="admin-summary-label">Active Managers</span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-value">{withFranchise}</span>
          <span className="admin-summary-label">With Franchise</span>
        </div>
        <div className="admin-summary-card">
          <span className="admin-summary-value">{totalMatches}</span>
          <span className="admin-summary-label">Total Matches</span>
        </div>
      </div>

      {/* Search */}
      <div className="admin-toolbar">
        <input
          type="text"
          className="admin-search"
          placeholder="Search by name, email, city, or franchise…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="admin-count">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {loading && <p className="admin-loading">Loading users…</p>}
      {error && <p className="admin-error">{error}</p>}

      {!loading && !error && (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
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
                <tr key={u.id}>
                  <td>
                    <div className="admin-user-cell">
                      <span className="admin-user-name">{u.display_name}</span>
                      <span className="admin-user-email">{u.email}</span>
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
                        <span>{u.franchise_name}</span>
                        <span className="admin-user-email">{u.city_name}, {u.country}</span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>{u.current_league_tier ? `Tier ${u.current_league_tier}` : '—'}</td>
                  <td>
                    {u.manager_matches_managed > 0
                      ? `${u.manager_wins_managed}W ${u.manager_losses_managed}L (${u.manager_matches_managed})`
                      : '—'}
                  </td>
                  <td>{u.championships || u.manager_titles || 0}</td>
                  <td>{u.total_valuation ? `$${Number(u.total_valuation).toFixed(0)}` : '—'}</td>
                  <td>
                    <span className={`admin-badge ${u.manager_status === 'ACTIVE' ? 'badge-active' : u.manager_status === 'RETIRED' ? 'badge-retired' : 'badge-unemployed'}`}>
                      {u.manager_status}
                    </span>
                  </td>
                  <td title={u.last_active_at}>{timeAgo(u.last_active_at)}</td>
                  <td>{fmtDate(u.created_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    {search ? 'No users match your search.' : 'No users yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
