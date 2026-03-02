import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

/* ── Helpers ── */
const money = (v) => `$${Number(v || 0).toFixed(2)}`;
const timeAgo = (ts) => {
  if (!ts) return '';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};
function opId(prefix = 'sim') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function DashboardPage() {
  const { token, franchise, refreshProfile } = useAuth();
  const { subscribe } = useSocket();

  const [franchiseData, setFranchiseData] = useState(null);
  const [squadSummary, setSquadSummary] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  const [availableCities, setAvailableCities] = useState([]);
  const [seasonSummary, setSeasonSummary] = useState(null);
  const [valuations, setValuations] = useState([]);
  const [transferFeed, setTransferFeed] = useState([]);
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [newCityName, setNewCityName] = useState('');
  const [newCityCountry, setNewCityCountry] = useState('');
  const [addingCity, setAddingCity] = useState(false);
  const [addCityNote, setAddCityNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [simulatingRound, setSimulatingRound] = useState(false);
  const [simulatingMyLeagueRound, setSimulatingMyLeagueRound] = useState(false);
  const [simulatingHalfSeason, setSimulatingHalfSeason] = useState(false);
  const [simulatingSeason, setSimulatingSeason] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState(null);
  const [error, setError] = useState('');

  async function loadData() {
    setError('');
    try {
      const [franchiseResponse, marketCities, activeSeason, feedResponse] = await Promise.all([
        api.franchise.me(token),
        api.marketplace.cities('', 1200),
        api.league.activeSeason(),
        api.marketplace.transferFeed(40)
      ]);
      setFranchiseData(franchiseResponse.franchise || null);
      setSquadSummary(franchiseResponse.squadSummary || null);
      setRecentResults(franchiseResponse.recentResults || []);
      setAvailableCities(marketCities.cities || []);
      setTransferFeed(feedResponse.feed || []);
      if (activeSeason.season?.id) {
        const summary = await api.league.seasonSummary(activeSeason.season.id);
        setSeasonSummary(summary);
      }
      if (franchiseResponse.franchise) {
        const valuationResponse = await api.financials.valuations(token);
        setValuations(valuationResponse.valuations || []);
      } else {
        setValuations([]);
      }
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      if (mounted) await loadData();
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [token]);

  useEffect(() => {
    const un1 = subscribe('*', (message) => {
      if (message.event === 'match:complete' || message.event === 'league:update' || message.event === 'market:update') {
        loadData();
        refreshProfile();
      }
    });
    return () => { un1(); };
  }, [subscribe]);

  useEffect(() => {
    const offProgress = subscribe('league:simulation_progress', (message) => {
      const payload = message.payload || {};
      const id = String(payload.operationId || '').trim();
      if (!id) return;
      setSimulationProgress((prev) => {
        if (!prev || String(prev.operationId) !== id) return prev;
        return {
          ...prev,
          phase: payload.phase || prev.phase,
          completed: Number(payload.completed ?? prev.completed ?? 0),
          total: Number(payload.total ?? prev.total ?? 0),
          roundNo: payload.roundNo ?? prev.roundNo ?? null,
          leagueTier: payload.leagueTier ?? prev.leagueTier ?? null
        };
      });
    });
    return () => { offProgress(); };
  }, [subscribe]);

  useEffect(() => {
    if (!simulationProgress || simulationProgress.phase !== 'complete') return undefined;
    const timer = window.setTimeout(() => {
      setSimulationProgress((prev) => (prev?.phase === 'complete' ? null : prev));
    }, 2400);
    return () => { window.clearTimeout(timer); };
  }, [simulationProgress]);

  /* ── City claim ── */
  async function claimCity(cityId, cityName) {
    try {
      setError('');
      await api.franchise.claim(token, { cityId, franchiseName: `${cityName} Rise` });
      await refreshProfile();
      await loadData();
    } catch (e) { setError(e.message); }
  }

  async function addMissingCity(event) {
    event.preventDefault();
    const name = String(newCityName || '').trim();
    const country = String(newCityCountry || selectedCountry || '').trim();
    if (!name || !country) { setError('Please enter both city and country to verify and add.'); return; }
    try {
      setError(''); setAddCityNote(''); setAddingCity(true);
      const result = await api.cities.add(token, { name, country, verify: true });
      await loadData();
      const addedCity = result.city;
      setSelectedCountry(addedCity.country);
      setCountrySearch('');
      setCitySearch(addedCity.name);
      setNewCityName('');
      setNewCityCountry(addedCity.country);
      setAddCityNote(result.created
        ? `${addedCity.name}, ${addedCity.country} was verified and added.`
        : `${addedCity.name}, ${addedCity.country} already exists and is available to pick.`
      );
    } catch (e) { setError(e.message); }
    finally { setAddingCity(false); }
  }

  /* ── Simulation helpers ── */
  function makeSim(label, apiFn, setFlag, resultExtract) {
    return async () => {
      const operationId = opId('dashboard');
      try {
        setError(''); setFlag(true);
        setSimulationProgress({ operationId, label, phase: 'start', completed: 0, total: 0, roundNo: null, leagueTier: null });
        const result = await apiFn(token, { operationId });
        const extracted = resultExtract(result);
        setSimulationProgress((prev) =>
          prev?.operationId === operationId ? { ...prev, phase: 'complete', ...extracted } : prev
        );
        await loadData();
      } catch (e) {
        setError(e.message);
        setSimulationProgress((prev) => (prev?.operationId === operationId ? null : prev));
      } finally { setFlag(false); }
    };
  }

  const simulateNextRound = makeSim('Simulating Next Round', api.league.simulateNextRound, setSimulatingRound, (r) => ({
    completed: Number(r.simulated || 0), total: Number(r.totalMatches || r.simulated || 0), roundNo: r.roundNo, leagueTier: r.leagueTier
  }));
  const simulateMyLeagueRound = makeSim('Simulating My League Round', api.league.simulateMyLeagueRound, setSimulatingMyLeagueRound, (r) => ({
    completed: Number(r.simulated || 0), total: Number(r.totalMatches || r.simulated || 0), roundNo: r.roundNo, leagueTier: r.leagueTier
  }));
  const simulateHalfSeason = makeSim('Simulating Half Season', api.league.simulateHalfSeason, setSimulatingHalfSeason, (r) => ({
    completed: Number(r.totalSimulated || 0), total: Number(r.totalMatches || r.totalSimulated || 0)
  }));
  const simulateFullSeason = makeSim('Simulating Full Season', api.league.simulateSeason, setSimulatingSeason, (r) => ({
    completed: Number(r.totalSimulated || 0), total: Number(r.totalSimulated || 0)
  }));

  /* ── Memos ── */
  const valuationSeries = useMemo(() => {
    if (!franchiseData?.id || !valuations.length) return [];
    return valuations.map((e, i) => ({ label: `V${i + 1}`, value: Number(e.total_value) }));
  }, [franchiseData, valuations]);

  const countries = useMemo(() => {
    const m = new Map();
    for (const c of availableCities) m.set(c.country, (m.get(c.country) || 0) + 1);
    return [...m.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => a.country.localeCompare(b.country));
  }, [availableCities]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    return q ? countries.filter((i) => i.country.toLowerCase().includes(q)) : countries;
  }, [countries, countrySearch]);

  const countryCities = useMemo(() => selectedCountry ? availableCities.filter((c) => c.country === selectedCountry) : [], [availableCities, selectedCountry]);

  const filteredCities = useMemo(() => {
    if (!selectedCountry) return [];
    const q = citySearch.trim().toLowerCase();
    return q ? countryCities.filter((c) => c.name.toLowerCase().includes(q)) : countryCities;
  }, [countryCities, citySearch, selectedCountry]);

  useEffect(() => { if (selectedCountry) setNewCityCountry(selectedCountry); }, [selectedCountry]);

  const simPct = useMemo(() => {
    const done = Number(simulationProgress?.completed || 0);
    const total = Number(simulationProgress?.total || 0);
    return total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  }, [simulationProgress]);

  const isBusy = simulatingRound || simulatingSeason || simulatingHalfSeason || simulatingMyLeagueRound;

  /* ── Valuation sparkline ── */
  function ValSparkline({ data }) {
    if (!data || data.length < 2) return null;
    const vals = data.map((d) => d.value);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const range = max - min || 1;
    const w = 120; const h = 32;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
    const trending = vals[vals.length - 1] >= vals[0];
    return (
      <svg width={w} height={h} className="db-sparkline">
        <polyline points={pts} fill="none" stroke={trending ? 'var(--leaf)' : 'var(--danger)'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  /* ════════════════════════════════════════════════════════════════
     RENDER — NO FRANCHISE (City Picker)
     ════════════════════════════════════════════════════════════════ */
  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading career dashboard...</span></div>;

  if (!franchise) {
    return (
      <div className="db-page">
        {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

        <div className="db-header">
          <h2 className="db-title">🏏 Pick Your Franchise Home</h2>
          <span className="db-subtitle">Start from the bottom and build a global powerhouse. Every new club starts at <strong>$100.00</strong>.</span>
        </div>

        <div className="db-picker-stats">
          <div className="db-picker-stat"><span className="db-picker-stat-val">{countries.length}</span><span className="db-picker-stat-lbl">Countries</span></div>
          <div className="db-picker-stat"><span className="db-picker-stat-val">{availableCities.length}</span><span className="db-picker-stat-lbl">Cities</span></div>
          <div className="db-picker-stat db-picker-stat--active"><span className="db-picker-stat-val">{selectedCountry || '—'}</span><span className="db-picker-stat-lbl">Selected</span></div>
        </div>

        <div className="db-picker-grid">
          {/* Step 1: Country */}
          <div className="db-picker-step">
            <div className="db-picker-step-head">
              <div>
                <h3 className="db-step-title">1. Select Country</h3>
                <span className="db-step-sub">Filter the global market and pick your base nation.</span>
              </div>
              {selectedCountry && <button type="button" className="db-step-clear" onClick={() => { setSelectedCountry(''); setCitySearch(''); }}>Clear</button>}
            </div>
            <input type="search" className="sq-search" value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)} placeholder="Search country..." />
            <div className="db-country-list">
              {filteredCountries.map((item) => (
                <button key={item.country} type="button"
                  className={`db-country-pill ${selectedCountry === item.country ? 'db-country-pill--active' : ''}`}
                  onClick={() => { setSelectedCountry(item.country); setCitySearch(''); }}>
                  <strong>{item.country}</strong><span>{item.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: City */}
          <div className="db-picker-step">
            <div className="db-picker-step-head">
              <div>
                <h3 className="db-step-title">2. Select City</h3>
                <span className="db-step-sub">{selectedCountry ? `${countryCities.length} cities in ${selectedCountry}` : 'Choose a country first.'}</span>
              </div>
            </div>
            <input type="search" className="sq-search" value={citySearch} disabled={!selectedCountry}
              onChange={(e) => setCitySearch(e.target.value)}
              placeholder={selectedCountry ? `Search in ${selectedCountry}...` : 'Select a country first'} />

            {!selectedCountry ? (
              <div className="sq-empty">Choose a country first, then pick your franchise city.</div>
            ) : filteredCities.length === 0 ? (
              <div className="sq-empty">No matching cities in {selectedCountry}.</div>
            ) : (
              <div className="db-city-grid">
                {filteredCities.map((city) => (
                  <button key={city.id} type="button" className="db-city-card" onClick={() => claimCity(city.id, city.name)}>
                    <strong>{city.name}</strong>
                    <span>{city.country}</span>
                    <span className="db-city-price">$100.00</span>
                  </button>
                ))}
              </div>
            )}

            {/* Add missing city */}
            <div className="db-add-city">
              <div className="db-add-city-head">
                <strong>Can&apos;t find your city?</strong>
                <span>We verify and add it instantly.</span>
              </div>
              <form className="db-add-city-form" onSubmit={addMissingCity}>
                <input type="text" value={newCityName} onChange={(e) => setNewCityName(e.target.value)} placeholder="City name" required />
                <input type="text" value={newCityCountry} onChange={(e) => setNewCityCountry(e.target.value)} placeholder="Country" required />
                <button type="submit" className="sq-btn" disabled={addingCity}>{addingCity ? 'Verifying...' : 'Verify & Add'}</button>
              </form>
              {addCityNote && <span className="db-add-city-note">{addCityNote}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════
     RENDER — HAS FRANCHISE (Main Dashboard)
     ════════════════════════════════════════════════════════════════ */
  const fd = franchiseData;
  const ss = seasonSummary;
  const fixturesTotal = Number(ss?.fixtures?.total_matches || 0);
  const fixturesDone = Number(ss?.fixtures?.completed_matches || 0);
  const fixturesPct = fixturesTotal ? Math.round((fixturesDone / fixturesTotal) * 100) : 0;

  return (
    <div className="db-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Header ── */}
      <div className="db-header">
        <div>
          <h2 className="db-title">{fd?.franchise_name || 'Dashboard'}</h2>
          <span className="db-subtitle">{fd?.city_name}, {fd?.country} &middot; League {fd?.current_league_tier || 1}</span>
        </div>
      </div>

      {/* ── Hero stats ── */}
      <div className="db-hero-strip">
        <div className="db-hero-card">
          <span className="db-hero-label">Franchise Value</span>
          <span className="db-hero-value db-hero-value--green">{money(fd?.total_valuation)}</span>
          <ValSparkline data={valuationSeries} />
        </div>
        <div className="db-hero-card">
          <span className="db-hero-label">Record</span>
          <span className="db-hero-value">{fd?.wins || 0}<span className="db-hero-dim">W</span> – {fd?.losses || 0}<span className="db-hero-dim">L</span></span>
          <span className="db-hero-hint">🏆 {fd?.championships || 0} titles</span>
        </div>
        <div className="db-hero-card">
          <span className="db-hero-label">League Position</span>
          <span className="db-hero-value">{fd?.league_position || '—'}<span className="db-hero-dim">/ {ss?.season?.league_count ? Number(ss.season.league_count) * 12 : '?'}</span></span>
          <span className="db-hero-hint">Tier {fd?.current_league_tier || 1}</span>
        </div>
        <div className="db-hero-card">
          <span className="db-hero-label">Squad OVR</span>
          <span className="db-hero-value">{Number(squadSummary?.avg_team_rating || 0).toFixed(0)}</span>
          <span className="db-hero-hint">{squadSummary?.main_squad_count || 0} main &middot; {squadSummary?.youth_count || 0} youth</span>
        </div>
        <div className="db-hero-card">
          <span className="db-hero-label">Win Streak</span>
          <span className="db-hero-value">{fd?.win_streak || 0}</span>
          <span className="db-hero-hint">Best {fd?.best_win_streak || 0}</span>
        </div>
        <div className="db-hero-card db-hero-card--accent">
          <span className="db-hero-label">Prospect Pts</span>
          <span className="db-hero-value">{fd?.prospect_points || 0}</span>
          <span className="db-hero-hint">+5 win / +2 loss</span>
        </div>
        <div className="db-hero-card db-hero-card--accent">
          <span className="db-hero-label">Growth Pts</span>
          <span className="db-hero-value">{fd?.growth_points || 0}</span>
          <span className="db-hero-hint">+5 win / +2 loss</span>
        </div>
      </div>

      {/* ── Simulation controls ── */}
      <div className="db-sim-section">
        <h3 className="db-section-title">Season Controls</h3>
        <div className="db-sim-buttons">
          <button type="button" className="sq-btn sq-btn--primary" disabled={isBusy} onClick={simulateNextRound}>
            {simulatingRound ? '⏳ Simulating...' : '▶ Next Round'}
          </button>
          <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateMyLeagueRound}>
            {simulatingMyLeagueRound ? '⏳ My League...' : '🏟️ My League Round'}
          </button>
          <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateHalfSeason}>
            {simulatingHalfSeason ? '⏳ Half Season...' : '⏩ Half Season'}
          </button>
          <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateFullSeason}>
            {simulatingSeason ? '⏳ Full Season...' : '🔄 Full Season'}
          </button>
        </div>

        {simulationProgress && (
          <div className="db-sim-progress">
            <div className="db-sim-progress-head">
              <strong>{simulationProgress.label}</strong>
              <span>{simulationProgress.total ? `${simulationProgress.completed}/${simulationProgress.total} (${simPct}%)` : simulationProgress.phase === 'complete' ? 'Done ✓' : 'Preparing...'}</span>
            </div>
            <div className="db-sim-track"><div className="db-sim-fill" style={{ width: `${simPct}%` }} /></div>
            <span className="db-sim-note">External ball API rate limits can make large batches take a few minutes.</span>
          </div>
        )}
      </div>

      {/* ── Season + Recent Results row ── */}
      <div className="db-two-col">
        {/* Season overview */}
        <div className="db-card">
          <h3 className="db-section-title">Season Overview</h3>
          {ss ? (
            <>
              <div className="db-season-meta">
                <span><strong>{ss.season.name}</strong></span>
                <span>{ss.season.league_count || 4} leagues</span>
              </div>
              <div className="db-season-progress">
                <div className="db-season-bar"><div className="db-season-bar-fill" style={{ width: `${fixturesPct}%` }} /></div>
                <span className="db-season-pct">{fixturesDone}/{fixturesTotal} matches ({fixturesPct}%)</span>
              </div>
              {(ss.rounds || []).length > 0 && (
                <div className="db-round-list">
                  {ss.rounds.slice(0, 10).map((rnd) => {
                    const t = Number(rnd.total_matches || 0);
                    const d = Number(rnd.completed_matches || 0);
                    const p = t ? Math.round((d / t) * 100) : 0;
                    return (
                      <div key={rnd.round_no} className="db-round-row">
                        <span className="db-round-num">R{rnd.round_no}</span>
                        <div className="db-round-bar"><div className="db-round-bar-fill" style={{ width: `${p}%` }} /></div>
                        <span className="db-round-pct">{d}/{t}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : <div className="sq-empty">No season data loaded.</div>}
        </div>

        {/* Recent results */}
        <div className="db-card">
          <h3 className="db-section-title">Recent Results</h3>
          {recentResults.length === 0 ? (
            <div className="sq-empty">No matches played yet.</div>
          ) : (
            <div className="db-results-list">
              {recentResults.slice(0, 8).map((m) => {
                const isWin = Number(m.winner_franchise_id) === Number(fd?.id);
                const isDraw = !m.winner_franchise_id;
                return (
                  <div key={m.id} className="db-result-item">
                    <span className={`db-result-badge ${isWin ? 'db-result-badge--win' : isDraw ? 'db-result-badge--draw' : 'db-result-badge--loss'}`}>
                      {isWin ? 'W' : isDraw ? 'D' : 'L'}
                    </span>
                    <div className="db-result-body">
                      <span className="db-result-summary">{m.result_summary || `${m.stage} R${m.round_no}`}</span>
                      <span className="db-result-time">{timeAgo(m.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Transfer feed ── */}
      <div className="db-card">
        <h3 className="db-section-title">Transfer &amp; Loan Activity</h3>
        {transferFeed.length === 0 ? (
          <div className="sq-empty">No recent activity.</div>
        ) : (
          <div className="db-feed-list">
            {transferFeed.slice(0, 15).map((item) => (
              <div key={item.id} className="db-feed-item">
                <div className="db-feed-dot" />
                <span className="db-feed-msg">{item.message}</span>
                <span className="db-feed-time">{timeAgo(item.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
