import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function oversFromBalls(balls) {
  const complete = Math.floor(Number(balls || 0) / 6);
  const rem = Number(balls || 0) % 6;
  return `${complete}.${rem}`;
}

function scoreLabel(runs, wickets, balls) {
  if (runs == null) return '-';
  return `${runs}/${wickets} (${oversFromBalls(balls)})`;
}

function teamNameById(row, franchiseId) {
  const id = Number(franchiseId || 0);
  if (id === Number(row.home_franchise_id || 0)) return row.home_franchise_name || 'Home';
  if (id === Number(row.away_franchise_id || 0)) return row.away_franchise_name || 'Away';
  return `Franchise ${id || '?'}`;
}

function teamCountryById(row, franchiseId) {
  const id = Number(franchiseId || 0);
  if (id === Number(row.home_franchise_id || 0)) return row.home_country || '-';
  if (id === Number(row.away_franchise_id || 0)) return row.away_country || '-';
  return '-';
}

function venueTagById(row, franchiseId) {
  const id = Number(franchiseId || 0);
  if (id === Number(row.home_franchise_id || 0)) return 'H';
  if (id === Number(row.away_franchise_id || 0)) return 'A';
  return '?';
}

function roundStatus(round) {
  if (Number(round.completed_matches) === Number(round.total_matches)) return 'completed';
  if (Number(round.completed_matches) > 0) return 'in-progress';
  return 'pending';
}

function createSimulationOperationId(prefix = 'sim') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Inline sub-components ── */

function FixtureStatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  const cls = s === 'completed' ? 'done' : s === 'live' ? 'live' : 'pending';
  const label = s === 'completed' ? 'Completed' : s === 'live' ? 'Live' : s || 'Scheduled';
  return <span className={`fx-status fx-status--${cls}`}>{label}</span>;
}

function WinnerBadge({ row }) {
  const winnerId = Number(row.winner_franchise_id || 0);
  if (!winnerId) return null;
  const name = teamNameById(row, winnerId);
  const isHome = winnerId === Number(row.home_franchise_id || 0);
  return <span className={`fx-winner-badge ${isHome ? 'fx-winner--home' : 'fx-winner--away'}`}>🏆 {name} wins</span>;
}

function battingOrder(row) {
  const homeId = Number(row.home_franchise_id || 0);
  const awayId = Number(row.away_franchise_id || 0);
  const tossWinnerId = Number(row.toss_winner_franchise_id || 0);
  const tossDecision = String(row.toss_decision || '').toUpperCase();
  if (!tossWinnerId || !tossDecision) return null;
  const first = tossDecision === 'BAT' ? tossWinnerId : (tossWinnerId === homeId ? awayId : homeId);
  return { homeBattedFirst: first === homeId };
}

function teamSnapshotById(row, franchiseId) {
  const id = Number(franchiseId || 0);
  if (id === Number(row.home_franchise_id || 0)) {
    return {
      id,
      name: row.home_franchise_name || 'Home',
      country: row.home_country || '',
      ovr: Number(row.home_avg_overall || 0),
      score: row.home_score,
      wickets: row.home_wickets,
      balls: row.home_balls,
      venue: 'H',
    };
  }
  if (id === Number(row.away_franchise_id || 0)) {
    return {
      id,
      name: row.away_franchise_name || 'Away',
      country: row.away_country || '',
      ovr: Number(row.away_avg_overall || 0),
      score: row.away_score,
      wickets: row.away_wickets,
      balls: row.away_balls,
      venue: 'A',
    };
  }
  return {
    id,
    name: teamNameById(row, id),
    country: teamCountryById(row, id),
    ovr: 0,
    score: null,
    wickets: null,
    balls: null,
    venue: venueTagById(row, id),
  };
}

function TossLine({ row }) {
  const tossWinnerId = Number(row.toss_winner_franchise_id || 0);
  if (!tossWinnerId) return null;
  const name = teamNameById(row, tossWinnerId);
  const decision = String(row.toss_decision || '').toLowerCase();
  if (!decision) return null;
  return <span className="fx-toss-line">🪙 {name} won toss &amp; chose to {decision} first</span>;
}

export default function FixturesResultsPage() {
  const { token, franchise } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { subscribe } = useSocket();

  const [tab, setTab] = useState('regular');
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(Number(searchParams.get('season') || 0) || null);
  const [rounds, setRounds] = useState([]);
  const [selectedRound, setSelectedRound] = useState(Number(searchParams.get('round') || 0) || null);
  const [selectedLeagueTier, setSelectedLeagueTier] = useState(Number(searchParams.get('league') || 0) || 0);
  const [fixtures, setFixtures] = useState([]);
  const [allFixtures, setAllFixtures] = useState([]);
  const [simulatingAction, setSimulatingAction] = useState(false);
  const [activeSimulation, setActiveSimulation] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  /* ── Helpers (unchanged logic) ── */

  function filterRoundFixtures(allRows, roundNo, leagueTier = 0) {
    return (allRows || []).filter(
      (fixture) =>
        fixture.stage === 'REGULAR' &&
        Number(fixture.round_no) === Number(roundNo) &&
        (!leagueTier || Number(fixture.league_tier) === Number(leagueTier))
    );
  }

  function syncQueryParams(seasonId, roundNo, leagueTier) {
    const next = {};
    if (seasonId) next.season = String(seasonId);
    if (roundNo) next.round = String(roundNo);
    if (leagueTier) next.league = String(leagueTier);
    setSearchParams(next, { replace: true });
  }

  async function loadSeason(nextSeasonId = null, nextRound = null) {
    setError('');
    setLoading(true);
    try {
      const seasonResponse = await api.league.seasons();
      const seasonRows = seasonResponse.seasons || [];
      setSeasons(seasonRows);
      const querySeason = Number(searchParams.get('season') || 0) || null;
      const requestedSeason = nextSeasonId || selectedSeasonId || querySeason;
      const resolvedSeason = (requestedSeason && seasonRows.find((s) => Number(s.id) === Number(requestedSeason))) || seasonRows[0] || null;
      if (!resolvedSeason?.id) {
        setSelectedSeasonId(null); setRounds([]); setFixtures([]); setAllFixtures([]); setSelectedRound(null);
        syncQueryParams(null, null, null); return;
      }
      const sId = Number(resolvedSeason.id);
      setSelectedSeasonId(sId);
      const [roundsResp, allFixResp] = await Promise.all([api.league.rounds(sId), api.league.fixtures(sId)]);
      const roundRows = roundsResp.rounds || [];
      const fixtureRows = allFixResp.fixtures || [];
      setRounds(roundRows);
      setAllFixtures(fixtureRows);
      const queryRound = Number(searchParams.get('round') || 0);
      const firstPending = roundRows.find((r) => Number(r.completed_matches) < Number(r.total_matches))?.round_no;
      const fallbackRound = firstPending || roundRows[0]?.round_no || null;
      const resolvedRoundCandidate = nextRound || selectedRound || queryRound || fallbackRound;
      const resolvedRound = resolvedRoundCandidate && roundRows.some((r) => Number(r.round_no) === Number(resolvedRoundCandidate))
        ? Number(resolvedRoundCandidate) : fallbackRound || null;
      setSelectedRound(resolvedRound);
      setFixtures(filterRoundFixtures(fixtureRows, resolvedRound, selectedLeagueTier));
      syncQueryParams(sId, resolvedRound, selectedLeagueTier);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function changeRound(roundNo) {
    if (!roundNo || !seasonId) return;
    setError('');
    setSelectedRound(roundNo);
    setFixtures(filterRoundFixtures(allFixtures, roundNo, selectedLeagueTier));
    syncQueryParams(selectedSeasonId, roundNo, selectedLeagueTier);
  }

  async function changeSeason(sId) {
    if (!sId) return;
    setSelectedSeasonId(sId);
    await loadSeason(sId, null);
  }

  function isManagedFixture(row) {
    const managedId = Number(franchise?.id || 0);
    if (!managedId) return false;
    return managedId === Number(row.home_franchise_id || 0) || managedId === Number(row.away_franchise_id || 0);
  }

  async function refreshCurrentSeasonData() {
    const currentSId = Number(selectedSeasonId || 0);
    if (!currentSId) return;
    const [roundsResp, allFixResp] = await Promise.all([api.league.rounds(currentSId), api.league.fixtures(currentSId)]);
    const roundRows = roundsResp.rounds || [];
    const fixtureRows = allFixResp.fixtures || [];
    setRounds(roundRows);
    setAllFixtures(fixtureRows);
    setFixtures(filterRoundFixtures(fixtureRows, selectedRound, selectedLeagueTier));
  }

  async function simulateFixtureWithoutOpening(row) {
    if (!token) { setError('Please log in to simulate fixtures.'); return; }
    const operationId = createSimulationOperationId('fixture');
    const isRegularRound = String(row.stage || '').toUpperCase() === 'REGULAR';
    const pendingInRound = isRegularRound
      ? (allFixtures || []).filter((f) => String(f.stage || '').toUpperCase() === 'REGULAR' && Number(f.round_no) === Number(row.round_no) && Number(f.league_tier) === Number(row.league_tier) && String(f.status || '').toUpperCase() !== 'COMPLETED').length
      : 1;
    try {
      setError(''); setSimulatingAction(true);
      setActiveSimulation({ operationId, rowId: Number(row.id), label: isRegularRound ? `Simulating League ${Number(row.league_tier)} Round ${Number(row.round_no)}` : 'Simulating Match', phase: 'start', completed: 0, total: Math.max(1, pendingInRound) });
      if (isRegularRound) {
        const result = await api.league.simulateLeagueRound(token, { seasonId: selectedSeasonId, roundNo: row.round_no, leagueTier: row.league_tier, operationId });
        setActiveSimulation((prev) => prev?.operationId === operationId ? { ...prev, phase: 'complete', completed: Number(result.simulated || prev.completed || 0), total: Number(prev.total || result.totalMatches || result.simulated || 0) } : prev);
      } else {
        await api.league.simulateInstant(token, row.id, { operationId, useExternalFullMatchApi: true });
        setActiveSimulation((prev) => prev?.operationId === operationId ? { ...prev, phase: 'complete', completed: 1, total: 1 } : prev);
      }
      await refreshCurrentSeasonData();
    } catch (e) { setError(e.message); setActiveSimulation((prev) => (prev?.operationId === operationId ? null : prev)); }
    finally { setSimulatingAction(false); }
  }

  async function resetStuckMatch(matchId) {
    if (!token || !matchId) return;
    try {
      setError('');
      await api.league.resetMatch(token, matchId);
      await refreshCurrentSeasonData();
    } catch (e) { setError(e.message); }
  }

  async function simulateMyLeagueRoundNow() {
    if (!token) { setError('Please log in to simulate your league round.'); return; }
    const operationId = createSimulationOperationId('my-league');
    try {
      setError(''); setSimulatingAction(true);
      setActiveSimulation({ operationId, rowId: null, label: 'Simulating My League Round', phase: 'start', completed: 0, total: 0 });
      const result = await api.league.simulateMyLeagueRound(token, { operationId });
      setActiveSimulation((prev) => prev?.operationId === operationId ? { ...prev, phase: 'complete', completed: Number(result.simulated || prev.completed || 0), total: Number(prev.total || result.totalMatches || result.simulated || 0) } : prev);
      await refreshCurrentSeasonData();
    } catch (e) { setError(e.message); setActiveSimulation((prev) => (prev?.operationId === operationId ? null : prev)); }
    finally { setSimulatingAction(false); }
  }

  useEffect(() => { loadSeason(); }, []);

  useEffect(() => {
    const offLeagueUpdate = subscribe('league:update', async (msg) => {
      const sSeason = Number(msg.payload?.seasonId || 0);
      const cur = Number(selectedSeasonId || 0);
      if (!sSeason || !cur || sSeason !== cur) return;
      try {
        const [rResp, fResp] = await Promise.all([api.league.rounds(cur), api.league.fixtures(cur)]);
        setRounds(rResp.rounds || []);
        const fix = fResp.fixtures || [];
        setAllFixtures(fix);
        setFixtures(filterRoundFixtures(fix, selectedRound, selectedLeagueTier));
      } catch { /* ignore */ }
    });

    const offProgress = subscribe('league:simulation_progress', (msg) => {
      const payload = msg.payload || {};
      const opId = String(payload.operationId || '').trim();
      if (!opId) return;
      setActiveSimulation((prev) => {
        if (!prev || String(prev.operationId) !== opId) return prev;
        return { ...prev, phase: payload.phase || prev.phase, completed: Number(payload.completed ?? prev.completed ?? 0), total: Number(payload.total ?? prev.total ?? 0) };
      });
    });

    return () => { offLeagueUpdate(); offProgress(); };
  }, [subscribe, selectedSeasonId, selectedRound, selectedLeagueTier]);

  useEffect(() => {
    if (!activeSimulation || activeSimulation.phase !== 'complete') return undefined;
    const timer = window.setTimeout(() => { setActiveSimulation((prev) => (prev?.phase === 'complete' ? null : prev)); }, 2200);
    return () => window.clearTimeout(timer);
  }, [activeSimulation]);

  /* ── Derived data ── */

  const seasonMeta = useMemo(() => seasons.find((s) => Number(s.id) === Number(selectedSeasonId)) || null, [seasons, selectedSeasonId]);
  const seasonId = selectedSeasonId;
  const playoffFixtures = useMemo(() => (allFixtures || []).filter((f) => f.stage === 'PLAYOFF'), [allFixtures]);
  const finalFixtures = useMemo(() => (allFixtures || []).filter((f) => f.stage === 'FINAL'), [allFixtures]);
  const roundFixturesByLeague = useMemo(() => [1, 2, 3, 4].map((tier) => ({ tier, rows: (fixtures || []).filter((f) => Number(f.league_tier) === tier) })), [fixtures]);

  const earliestIncompleteRoundByLeague = useMemo(() => {
    const map = new Map();
    for (const f of allFixtures || []) {
      if (String(f.stage || '').toUpperCase() !== 'REGULAR') continue;
      if (String(f.status || '').toUpperCase() === 'COMPLETED') continue;
      const tier = Number(f.league_tier || 0);
      const round = Number(f.round_no || 0);
      if (!tier || !round) continue;
      const current = Number(map.get(tier) || 0);
      if (!current || round < current) map.set(tier, round);
    }
    return map;
  }, [allFixtures]);

  function isFutureRoundBlocked(row) {
    if (String(row.stage || '').toUpperCase() !== 'REGULAR') return false;
    const firstOpenRound = Number(earliestIncompleteRoundByLeague.get(Number(row.league_tier || 0)) || 0);
    if (!firstOpenRound) return false;
    return Number(row.round_no || 0) > firstOpenRound;
  }

  const activeSimulationPercent = useMemo(() => {
    const done = Number(activeSimulation?.completed || 0);
    const total = Number(activeSimulation?.total || 0);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }, [activeSimulation]);

  const selectedRoundIndex = useMemo(() => rounds.findIndex((r) => Number(r.round_no) === Number(selectedRound)), [rounds, selectedRound]);

  const visibleRounds = useMemo(() => {
    if (!rounds.length) return [];
    const anchor = selectedRoundIndex >= 0 ? selectedRoundIndex : 0;
    let start = Math.max(0, anchor - 5);
    let end = Math.min(rounds.length, start + 12);
    if (end - start < 12) start = Math.max(0, end - 12);
    return rounds.slice(start, end);
  }, [rounds, selectedRoundIndex]);

  const completedRounds = useMemo(() => rounds.filter((r) => Number(r.completed_matches) === Number(r.total_matches)).length, [rounds]);
  const currentRoundMeta = useMemo(() => rounds.find((r) => Number(r.round_no) === Number(selectedRound)) || null, [rounds, selectedRound]);
  const previousRound = selectedRoundIndex > 0 ? rounds[selectedRoundIndex - 1]?.round_no : null;
  const nextRound = selectedRoundIndex >= 0 && selectedRoundIndex < rounds.length - 1 ? rounds[selectedRoundIndex + 1]?.round_no : null;

  function changeLeagueFilter(nextTier) {
    setSelectedLeagueTier(nextTier);
    setFixtures(filterRoundFixtures(allFixtures, selectedRound, nextTier));
    syncQueryParams(selectedSeasonId, selectedRound, nextTier);
  }

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading fixtures...</span></div>;

  /* ── Render a single fixture card ── */
  function renderFixtureCard(row) {
    const pending = String(row.status || '').toUpperCase() !== 'COMPLETED';
    const blocked = isFutureRoundBlocked(row);
    const rowIsActive = activeSimulation && Number(activeSimulation.rowId || 0) === Number(row.id || 0);
    const managed = isManagedFixture(row);
    const homeId = Number(row.home_franchise_id || 0);
    const awayId = Number(row.away_franchise_id || 0);
    const order = battingOrder(row);
    const inningsOneId = order ? (order.homeBattedFirst ? homeId : awayId) : homeId;
    const inningsTwoId = order ? (order.homeBattedFirst ? awayId : homeId) : awayId;
    const inningsOne = teamSnapshotById(row, inningsOneId);
    const inningsTwo = teamSnapshotById(row, inningsTwoId);

    return (
      <div key={row.id} className={`fx-card ${managed ? 'fx-card--mine' : ''} ${pending ? '' : 'fx-card--done'}`}>
        {/* Card header */}
        <div className="fx-card-header">
          <div className="fx-card-header-left">
            {row.league_tier && <span className={`lg-tier-badge lg-tier-badge--${row.league_tier}`} style={{ width: 22, height: 22, fontSize: '0.7rem', borderRadius: '0.35rem' }}>{row.league_tier}</span>}
            {row.matchday_label && <span className="fx-card-matchday">{row.matchday_label}</span>}
          </div>
          <FixtureStatusBadge status={row.status} />
        </div>

        {/* Teams */}
        <div className="fx-card-teams">
          <div className="fx-card-team">
            <strong className="fx-team-name">{inningsOne.name}</strong>
            <span className="fx-team-country">{inningsOne.country}</span>
            <span className="fx-team-ovr">{inningsOne.ovr.toFixed(0)} OVR</span>
            <span className="fx-team-score">{scoreLabel(inningsOne.score, inningsOne.wickets, inningsOne.balls)}</span>
            {inningsOne.score != null && order && (
              <span className="fx-bat-order fx-bat-order--1st">
                Batted 1st
              </span>
            )}
          </div>
          <div className="fx-vs-block">
            <span className="fx-ovr-matchup">{inningsOne.ovr.toFixed(0)} <span className="fx-ovr-v">v</span> {inningsTwo.ovr.toFixed(0)}</span>
            <span className="fx-vs">vs</span>
          </div>
          <div className="fx-card-team fx-card-team--away">
            <strong className="fx-team-name">{inningsTwo.name}</strong>
            <span className="fx-team-country">{inningsTwo.country}</span>
            <span className="fx-team-ovr">{inningsTwo.ovr.toFixed(0)} OVR</span>
            <span className="fx-team-score">{scoreLabel(inningsTwo.score, inningsTwo.wickets, inningsTwo.balls)}</span>
            {inningsTwo.score != null && order && (
              <span className="fx-bat-order">
                Batted 2nd
              </span>
            )}
          </div>
        </div>

        {/* Toss + Result */}
        {row.home_score != null && <TossLine row={row} />}

        {/* Winner */}
        <WinnerBadge row={row} />

        {/* Simulation progress */}
        {rowIsActive && (
          <div className="fx-sim-progress">
            <div className="fx-sim-track"><div className="fx-sim-fill" style={{ width: `${activeSimulationPercent}%` }} /></div>
            <span className="fx-sim-label">
              {activeSimulation.total ? `${activeSimulation.completed}/${activeSimulation.total}` : activeSimulation.phase === 'complete' ? 'Done' : 'Starting...'}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="fx-card-actions">
          {pending && String(row.status || '').toUpperCase() !== 'LIVE' && (
            <button type="button" className="sq-btn sq-btn--sm sq-btn--promote" onClick={() => simulateFixtureWithoutOpening(row)} disabled={blocked || simulatingAction}
              title={blocked ? `Complete earlier rounds first in League ${row.league_tier}.` : undefined}>
              {rowIsActive && simulatingAction ? 'Simulating...' : managed ? '▶ Play Round' : '▶ Simulate'}
            </button>
          )}
          {String(row.status || '').toUpperCase() === 'LIVE' && (
            <button type="button" className="sq-btn sq-btn--sm" style={{ background: 'rgba(200,50,50,0.12)', color: '#c33' }} onClick={() => resetStuckMatch(row.id)} disabled={simulatingAction}>
              ↺ Reset
            </button>
          )}
          <button type="button" className="sq-btn sq-btn--sm" style={{ background: 'rgba(65,123,196,0.12)', color: '#3b7bca' }}
            onClick={() => navigate(`/matches/${row.id}?season=${seasonId || ''}&round=${selectedRound || row.round_no}`)}>
            Match Center →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fx-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Season Selector ── */}
      <div className="lg-season-bar">
        <div className="lg-season-pills">
          {seasons.map((s) => (
            <button key={s.id} type="button" className={`lg-season-pill ${Number(s.id) === Number(selectedSeasonId) ? 'active' : ''}`} onClick={() => changeSeason(s.id)}>
              <span className="lg-season-pill-name">{s.name}</span>
              <span className={`lg-season-pill-status lg-season-pill-status--${(s.status || '').toLowerCase()}`}>{s.status}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab nav ── */}
      <nav className="sq-tabs">
        <button type="button" className={`sq-tab ${tab === 'regular' ? 'active' : ''}`} onClick={() => setTab('regular')}>
          <span className="sq-tab-icon">📅</span>Regular Season
        </button>
        <button type="button" className={`sq-tab ${tab === 'knockouts' ? 'active' : ''}`} onClick={() => setTab('knockouts')}>
          <span className="sq-tab-icon">⚡</span>Knockouts
        </button>
      </nav>

      {/* ═══ REGULAR SEASON TAB ═══ */}
      {tab === 'regular' && (
        <div className="sq-tab-content">
          {!seasonMeta ? (
            <div className="sq-empty">Select a season to view fixtures.</div>
          ) : (
            <>
              {/* Round browser */}
              <div className="fx-round-browser">
                <button type="button" className="fx-round-nav" disabled={!previousRound} onClick={() => changeRound(previousRound)}>‹ Prev</button>
                <div className="fx-round-browser-center">
                  <span className="fx-round-current">Round <strong>{selectedRound || '-'}</strong> of {rounds.length}</span>
                  <span className="fx-round-progress-text">{completedRounds} of {rounds.length} rounds completed</span>
                </div>
                <button type="button" className="fx-round-nav" disabled={!nextRound} onClick={() => changeRound(nextRound)}>Next ›</button>
              </div>

              {/* Round chips */}
              <div className="fx-round-chips">
                {visibleRounds.map((round) => {
                  const completion = Number(round.total_matches) ? (Number(round.completed_matches) / Number(round.total_matches)) * 100 : 0;
                  const status = roundStatus(round);
                  const active = Number(selectedRound) === Number(round.round_no);
                  return (
                    <button key={round.round_no} type="button" className={`fx-round-chip ${active ? 'active' : ''} fx-round-chip--${status}`} onClick={() => changeRound(round.round_no)}>
                      <span className="fx-chip-label">R{round.round_no}</span>
                      <div className="fx-chip-progress"><div className="fx-chip-fill" style={{ width: `${completion}%` }} /></div>
                      <span className="fx-chip-count">{round.completed_matches}/{round.total_matches}</span>
                    </button>
                  );
                })}
              </div>

              {/* League filter + "Simulate My Round" button */}
              <div className="fx-controls">
                <div className="fx-league-filters">
                  {[0, 1, 2, 3, 4].map((tier) => (
                    <button key={tier} type="button" className={`sq-filter-btn ${Number(selectedLeagueTier) === tier ? 'active' : ''}`} onClick={() => changeLeagueFilter(tier)}>
                      {tier === 0 ? 'All Leagues' : `League ${tier}`}
                    </button>
                  ))}
                </div>
                {franchise && (
                  <button type="button" className="sq-btn sq-btn--primary" onClick={simulateMyLeagueRoundNow} disabled={simulatingAction}>
                    {simulatingAction && !activeSimulation?.rowId ? 'Simulating...' : '▶ Simulate My League Round'}
                  </button>
                )}
              </div>

              {/* Global simulation progress */}
              {activeSimulation && !activeSimulation.rowId && (
                <div className="fx-global-sim">
                  <div className="fx-global-sim-head">
                    <strong>{activeSimulation.label}</strong>
                    <span>{activeSimulation.total ? `${activeSimulation.completed}/${activeSimulation.total} (${activeSimulationPercent}%)` : activeSimulation.phase === 'complete' ? 'Completed' : 'Preparing...'}</span>
                  </div>
                  <div className="fx-sim-track"><div className="fx-sim-fill" style={{ width: `${activeSimulationPercent}%` }} /></div>
                </div>
              )}

              {/* Round meta */}
              {currentRoundMeta && (
                <div className="fx-round-meta">
                  <span>Round {currentRoundMeta.round_no}: {currentRoundMeta.completed_matches} of {currentRoundMeta.total_matches} matches completed</span>
                </div>
              )}

              {/* Fixture cards by league */}
              {selectedLeagueTier ? (
                <div className="fx-card-grid">
                  {fixtures.length === 0 ? <div className="sq-empty">No fixtures in this round.</div> : fixtures.map(renderFixtureCard)}
                </div>
              ) : (
                roundFixturesByLeague.map((group) => (
                  <section key={group.tier} className="fx-league-group">
                    <div className="fx-league-group-header">
                      <span className={`lg-tier-badge lg-tier-badge--${group.tier}`}>{group.tier}</span>
                      <h4>League {group.tier}</h4>
                      <span className="fx-league-group-count">{group.rows.length} matches</span>
                    </div>
                    {group.rows.length === 0 ? (
                      <div className="sq-empty" style={{ marginTop: '0.3rem' }}>No League {group.tier} fixtures this round.</div>
                    ) : (
                      <div className="fx-card-grid">{group.rows.map(renderFixtureCard)}</div>
                    )}
                  </section>
                ))
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ KNOCKOUTS TAB ═══ */}
      {tab === 'knockouts' && (
        <div className="sq-tab-content">
          <section className="lg-ko-section">
            <div className="lg-ko-header"><h3>Semifinals</h3><span className="lg-ko-count">{playoffFixtures.length} match{playoffFixtures.length !== 1 ? 'es' : ''}</span></div>
            {playoffFixtures.length === 0 ? (
              <div className="sq-empty">No semifinal fixtures in this season.</div>
            ) : (
              <div className="fx-card-grid">{playoffFixtures.map(renderFixtureCard)}</div>
            )}
          </section>
          <section className="lg-ko-section">
            <div className="lg-ko-header"><h3>🏆 Final</h3></div>
            {finalFixtures.length === 0 ? (
              <div className="sq-empty">No final fixture in this season yet.</div>
            ) : (
              <div className="fx-card-grid">{finalFixtures.map(renderFixtureCard)}</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
