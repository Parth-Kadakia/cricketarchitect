import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

/* ── Helpers ── */

function oversFromBalls(balls) {
  const complete = Math.floor(Number(balls || 0) / 6);
  const rem = Number(balls || 0) % 6;
  return `${complete}.${rem}`;
}

function scoreLabel(runs, wickets, balls) {
  if (runs == null) return '';
  return `${runs}/${wickets} (${oversFromBalls(balls)})`;
}

function roundStatus(round) {
  if (Number(round.completed_matches) === Number(round.total_matches)) return 'completed';
  if (Number(round.completed_matches) > 0) return 'in-progress';
  return 'pending';
}

function createSimulationOperationId(prefix = 'sim') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function teamSnap(row, side) {
  const isHome = side === 'home';
  return {
    id: Number(isHome ? row.home_franchise_id : row.away_franchise_id) || 0,
    name: (isHome ? row.home_franchise_name : row.away_franchise_name) || (isHome ? 'Home' : 'Away'),
    country: (isHome ? row.home_country : row.away_country) || '',
    ovr: Number(isHome ? row.home_avg_overall : row.away_avg_overall) || 0,
    score: isHome ? row.home_score : row.away_score,
    wickets: isHome ? row.home_wickets : row.away_wickets,
    balls: isHome ? row.home_balls : row.away_balls,
  };
}

/* ── Main component ── */

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

  /* ── Data helpers ── */

  function filterRoundFixtures(allRows, roundNo, leagueTier = 0) {
    return (allRows || []).filter(
      (fixture) =>
        fixture.stage === 'REGULAR' &&
        Number(fixture.round_no) === Number(roundNo) &&
        (!leagueTier || Number(fixture.league_tier) === Number(leagueTier))
    );
  }

  function syncQueryParams(sId, roundNo, leagueTier) {
    const next = {};
    if (sId) next.season = String(sId);
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
      setActiveSimulation({ operationId, rowId: Number(row.id), label: isRegularRound ? `Simulating L${Number(row.league_tier)} R${Number(row.round_no)}` : 'Simulating Match', phase: 'start', completed: 0, total: Math.max(1, pendingInRound) });
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
  const isInternationalSeason = String(seasonMeta?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';
  const playoffFixtures = useMemo(() => (allFixtures || []).filter((f) => f.stage === 'PLAYOFF'), [allFixtures]);
  const finalFixtures = useMemo(() => (allFixtures || []).filter((f) => f.stage === 'FINAL'), [allFixtures]);
  const roundFixturesByLeague = useMemo(
    () =>
      [...new Set((fixtures || []).map((f) => Number(f.league_tier || 0)).filter((tier) => tier > 0))]
        .sort((a, b) => a - b)
        .map((tier) => ({ tier, rows: (fixtures || []).filter((f) => Number(f.league_tier) === tier) })),
    [fixtures]
  );
  const leagueTierFilters = useMemo(
    () => [0, ...new Set((allFixtures || []).map((f) => Number(f.league_tier || 0)).filter((tier) => tier > 0))].sort((a, b) => a - b),
    [allFixtures]
  );

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

  const completedRounds = useMemo(() => rounds.filter((r) => Number(r.completed_matches) === Number(r.total_matches)).length, [rounds]);
  const currentRoundMeta = useMemo(() => rounds.find((r) => Number(r.round_no) === Number(selectedRound)) || null, [rounds, selectedRound]);
  const previousRound = selectedRoundIndex > 0 ? rounds[selectedRoundIndex - 1]?.round_no : null;
  const nextRound = selectedRoundIndex >= 0 && selectedRoundIndex < rounds.length - 1 ? rounds[selectedRoundIndex + 1]?.round_no : null;

  function changeLeagueFilter(nextTier) {
    setSelectedLeagueTier(nextTier);
    setFixtures(filterRoundFixtures(allFixtures, selectedRound, nextTier));
    syncQueryParams(selectedSeasonId, selectedRound, nextTier);
  }

  useEffect(() => {
    if (isInternationalSeason && tab === 'knockouts') {
      setTab('regular');
    }
  }, [isInternationalSeason, tab]);

  if (loading) return <div className="sq-loading"><div className="sq-spinner" /><span>Loading fixtures...</span></div>;

  /* ── Render a single fixture row ── */
  function renderFixtureRow(row) {
    const status = String(row.status || '').toUpperCase();
    const completed = status === 'COMPLETED';
    const live = status === 'LIVE';
    const pending = !completed && !live;
    const blocked = isFutureRoundBlocked(row);
    const rowIsActive = activeSimulation && Number(activeSimulation.rowId || 0) === Number(row.id || 0);
    const managed = isManagedFixture(row);
    const winnerId = Number(row.winner_franchise_id || 0);

    const home = teamSnap(row, 'home');
    const away = teamSnap(row, 'away');
    const order = battingOrder(row);

    const homeWon = winnerId === home.id;
    const awayWon = winnerId === away.id;

    return (
      <div
        key={row.id}
        className={`fxr ${managed ? 'fxr--mine' : ''} ${completed ? 'fxr--done' : ''} ${live ? 'fxr--live' : ''}`}
        onClick={() => navigate(`/matches/${row.id}?season=${seasonId || ''}&round=${selectedRound || row.round_no}`)}
      >
        {/* Left: home team */}
        <div className={`fxr-team fxr-team--home ${homeWon ? 'fxr-team--won' : ''}`}>
          <TeamNameButton franchiseId={home.id} name={home.name} country={home.country} className="fxr-team-name">
            {home.name}
          </TeamNameButton>
          {home.country && <span className="fxr-team-flag">{home.country}</span>}
          {(completed || live) && (
            <span className={`fxr-mob-score ${homeWon ? 'fxr-score--won' : ''}`}>
              {scoreLabel(home.score, home.wickets, home.balls)}
            </span>
          )}
        </div>

        {/* Center: score block (desktop only) */}
        <div className="fxr-center">
          {completed || live ? (
            <div className="fxr-scores">
              <span className={`fxr-score ${homeWon ? 'fxr-score--won' : ''}`}>
                {scoreLabel(home.score, home.wickets, home.balls)}
              </span>
              <span className="fxr-score-sep">–</span>
              <span className={`fxr-score ${awayWon ? 'fxr-score--won' : ''}`}>
                {scoreLabel(away.score, away.wickets, away.balls)}
              </span>
            </div>
          ) : (
            <span className="fxr-vs">vs</span>
          )}
          {/* Result / status line */}
          <div className="fxr-meta">
            {live && <span className="fxr-badge fxr-badge--live">LIVE</span>}
            {pending && <span className="fxr-scheduled">Scheduled</span>}
            {order && completed && (
              <span className="fxr-toss">
                {order.homeBattedFirst ? home.name : away.name} batted first
              </span>
            )}
          </div>
          {completed && winnerId > 0 && (
            <span className="fxr-result">
              {homeWon ? home.name : away.name} won
            </span>
          )}
          {completed && !winnerId && <span className="fxr-result fxr-result--tie">Tied</span>}
          {/* Sim progress */}
          {rowIsActive && (
            <div className="fxr-sim">
              <div className="fxr-sim-track"><div className="fxr-sim-fill" style={{ width: `${activeSimulationPercent}%` }} /></div>
            </div>
          )}
        </div>

        {/* Right: away team */}
        <div className={`fxr-team fxr-team--away ${awayWon ? 'fxr-team--won' : ''}`}>
          <TeamNameButton franchiseId={away.id} name={away.name} country={away.country} className="fxr-team-name">
            {away.name}
          </TeamNameButton>
          {away.country && <span className="fxr-team-flag">{away.country}</span>}
          {(completed || live) && (
            <span className={`fxr-mob-score ${awayWon ? 'fxr-score--won' : ''}`}>
              {scoreLabel(away.score, away.wickets, away.balls)}
            </span>
          )}
        </div>

        {/* Far right: actions */}
        <div className="fxr-actions" onClick={(e) => e.stopPropagation()}>
          {pending && (
            <button
              type="button"
              className="fxr-btn fxr-btn--sim"
              onClick={() => simulateFixtureWithoutOpening(row)}
              disabled={blocked || simulatingAction}
              title={blocked ? `Complete earlier rounds first` : managed ? 'Play Round' : 'Simulate'}
            >
              {rowIsActive && simulatingAction ? '...' : '▶'}
            </button>
          )}
          {live && (
            <button type="button" className="fxr-btn fxr-btn--reset" onClick={() => resetStuckMatch(row.id)} disabled={simulatingAction}>
              ↺
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fx-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Top bar: season + tabs ── */}
      <div className="fx-topbar">
        <div className="fx-season-row">
          {seasons.map((s) => (
            <button key={s.id} type="button" className={`fx-season-btn ${Number(s.id) === Number(selectedSeasonId) ? 'active' : ''}`} onClick={() => changeSeason(s.id)}>
              {s.name}
              <span className={`fx-season-status fx-season-status--${(s.status || '').toLowerCase()}`}>{s.status}</span>
            </button>
          ))}
        </div>
        <div className="fx-tab-row">
          <button type="button" className={`fx-tab-btn ${tab === 'regular' ? 'active' : ''}`} onClick={() => setTab('regular')}>
            Regular Season
          </button>
          {!isInternationalSeason && (
            <button type="button" className={`fx-tab-btn ${tab === 'knockouts' ? 'active' : ''}`} onClick={() => setTab('knockouts')}>
              Knockouts
            </button>
          )}
        </div>
      </div>

      {/* ═══ REGULAR SEASON TAB ═══ */}
      {tab === 'regular' && (
        <>
          {!seasonMeta ? (
            <div className="sq-empty">Select a season to view fixtures.</div>
          ) : (
            <>
              {/* Round strip: prev | chips | next */}
              <div className="fx-round-strip">
                <button type="button" className="fx-round-arr" disabled={!previousRound} onClick={() => changeRound(previousRound)}>‹</button>
                <div className="fx-round-scroll">
                  {rounds.map((round) => {
                    const st = roundStatus(round);
                    const active = Number(selectedRound) === Number(round.round_no);
                    return (
                      <button key={round.round_no} type="button" className={`fx-rchip ${active ? 'fx-rchip--active' : ''} fx-rchip--${st}`} onClick={() => changeRound(round.round_no)}>
                        {round.round_no}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="fx-round-arr" disabled={!nextRound} onClick={() => changeRound(nextRound)}>›</button>
              </div>

              {/* Toolbar: league filters + round info + simulate */}
              <div className="fx-toolbar">
                <div className="fx-league-pills">
                  {leagueTierFilters.map((tier) => (
                    <button key={tier} type="button" className={`fx-lpill ${Number(selectedLeagueTier) === tier ? 'fx-lpill--active' : ''}`} onClick={() => changeLeagueFilter(tier)}>
                      {tier === 0 ? 'All' : `L${tier}`}
                    </button>
                  ))}
                </div>
                <div className="fx-toolbar-info">
                  <span className="fx-toolbar-round">Round {selectedRound || '-'}</span>
                  <span className="fx-toolbar-progress">{currentRoundMeta ? `${currentRoundMeta.completed_matches}/${currentRoundMeta.total_matches}` : ''}</span>
                  <span className="fx-toolbar-season-progress">{completedRounds}/{rounds.length} rounds</span>
                </div>
                {franchise && (
                  <button type="button" className="fx-sim-btn" onClick={simulateMyLeagueRoundNow} disabled={simulatingAction}>
                    {simulatingAction && !activeSimulation?.rowId ? 'Simulating...' : '▶ Simulate Round'}
                  </button>
                )}
              </div>

              {/* Global simulation progress */}
              {activeSimulation && !activeSimulation.rowId && (
                <div className="fx-global-sim">
                  <div className="fx-global-sim-head">
                    <span>{activeSimulation.label}</span>
                    <span>{activeSimulation.total ? `${activeSimulation.completed}/${activeSimulation.total}` : activeSimulation.phase === 'complete' ? 'Done' : '...'}</span>
                  </div>
                  <div className="fxr-sim-track"><div className="fxr-sim-fill" style={{ width: `${activeSimulationPercent}%` }} /></div>
                </div>
              )}

              {/* Fixture rows */}
              {selectedLeagueTier ? (
                <div className="fx-fixture-list">
                  {fixtures.length === 0 ? <div className="sq-empty">No fixtures this round.</div> : fixtures.map(renderFixtureRow)}
                </div>
              ) : (
                roundFixturesByLeague.map((group) => (
                  <section key={group.tier} className="fx-league-section">
                    <div className="fx-league-hdr">
                      <span className={`lg-tier-badge lg-tier-badge--${group.tier}`} style={{ width: 20, height: 20, fontSize: '0.65rem' }}>{group.tier}</span>
                      <span className="fx-league-title">League {group.tier}</span>
                      <span className="fx-league-ct">{group.rows.length}</span>
                    </div>
                    <div className="fx-fixture-list">
                      {group.rows.length === 0
                        ? <div className="sq-empty">No fixtures.</div>
                        : group.rows.map(renderFixtureRow)}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </>
      )}

      {/* ═══ KNOCKOUTS TAB ═══ */}
      {tab === 'knockouts' && (
        <>
          <section className="fx-league-section">
            <div className="fx-league-hdr">
              <span className="fx-league-title">Semifinals</span>
              <span className="fx-league-ct">{playoffFixtures.length}</span>
            </div>
            <div className="fx-fixture-list">
              {playoffFixtures.length === 0
                ? <div className="sq-empty">No semifinal fixtures.</div>
                : playoffFixtures.map(renderFixtureRow)}
            </div>
          </section>
          <section className="fx-league-section">
            <div className="fx-league-hdr">
              <span className="fx-league-title">🏆 Final</span>
            </div>
            <div className="fx-fixture-list">
              {finalFixtures.length === 0
                ? <div className="sq-empty">No final fixture yet.</div>
                : finalFixtures.map(renderFixtureRow)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
