import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import CountryLabel from '../components/CountryLabel';
import TeamNameButton from '../components/TeamNameButton';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { scoreLabel, setPageTitle } from '../utils/format';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function statusLabel(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'COMPLETED') return 'Completed';
  if (value === 'LIVE') return 'Live';
  return 'Scheduled';
}

function battingOrder(row) {
  const homeId = Number(row.home_franchise_id || 0);
  const awayId = Number(row.away_franchise_id || 0);
  const tossWinnerId = Number(row.toss_winner_franchise_id || 0);
  const tossDecision = String(row.toss_decision || '').toUpperCase();
  if (!tossWinnerId || !tossDecision) return null;
  const first = tossDecision === 'BAT' ? tossWinnerId : (tossWinnerId === homeId ? awayId : homeId);
  return {
    firstBattingId: first,
    homeBattedFirst: first === homeId
  };
}

function teamSnap(row, side) {
  const isHome = side === 'home';
  return {
    id: Number(isHome ? row.home_franchise_id : row.away_franchise_id) || 0,
    name: (isHome ? row.home_franchise_name : row.away_franchise_name) || (isHome ? 'Home' : 'Away'),
    country: (isHome ? row.home_country : row.away_country) || '',
    score: isHome ? row.home_score : row.away_score,
    wickets: isHome ? row.home_wickets : row.away_wickets,
    balls: isHome ? row.home_balls : row.away_balls
  };
}

function createSimulationOperationId(prefix = 'sim') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseIsoDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isoDate(value) {
  const parsed = parseIsoDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

function addDays(value, days) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return isoDate(parsed);
}

function addMonths(value, months) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + Number(months || 0));
  return isoDate(parsed);
}

function diffDays(fromValue, toValue) {
  const from = parseIsoDate(fromValue);
  const to = parseIsoDate(toValue);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function startOfMonth(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  parsed.setUTCDate(1);
  return isoDate(parsed);
}

function endOfMonth(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  parsed.setUTCMonth(parsed.getUTCMonth() + 1, 0);
  return isoDate(parsed);
}

function startOfGrid(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const dayIndex = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - dayIndex);
  return isoDate(parsed);
}

function endOfGrid(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const dayIndex = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() + (6 - dayIndex));
  return isoDate(parsed);
}

function monthLabel(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return '-';
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function dayLabel(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return '-';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
}

function buildCalendarWeeks(monthStartValue, dayMap, selectedDate, currentDate) {
  const monthStart = startOfMonth(monthStartValue);
  if (!monthStart) return [];
  const gridStart = startOfGrid(monthStart);
  const gridEnd = endOfGrid(endOfMonth(monthStart));
  const weeks = [];
  let cursor = gridStart;

  while (cursor && cursor <= gridEnd) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      const matches = dayMap.get(cursor) || [];
      const liveCount = matches.filter((match) => String(match.status || '').toUpperCase() === 'LIVE').length;
      const managedCount = matches.filter((match) => match.managedTeamInvolved).length;
      const worldCupCount = matches.filter((match) => String(match.stage || '').startsWith('WORLD_CUP')).length;
      week.push({
        date: cursor,
        inMonth: cursor.slice(0, 7) === monthStart.slice(0, 7),
        isSelected: cursor === selectedDate,
        isToday: cursor === currentDate,
        matches,
        liveCount,
        managedCount,
        worldCupCount
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }

  return weeks;
}

export default function FixturesResultsPage() {
  const { token, franchise } = useAuth();
  const { subscribe } = useSocket();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(Number(searchParams.get('season') || 0) || null);
  const [selectedRound, setSelectedRound] = useState(Number(searchParams.get('round') || 0) || null);
  const [selectedLeagueTier, setSelectedLeagueTier] = useState(Number(searchParams.get('league') || 0) || 0);
  const [rounds, setRounds] = useState([]);
  const [allFixtures, setAllFixtures] = useState([]);
  const [calendarData, setCalendarData] = useState(null);
  const [calendarMonthStart, setCalendarMonthStart] = useState(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeSimulation, setActiveSimulation] = useState(null);
  const [tab, setTab] = useState('regular');

  useEffect(() => { setPageTitle('Fixtures & Results'); }, []);

  const seasonMeta = useMemo(
    () => seasons.find((season) => Number(season.id) === Number(selectedSeasonId)) || null,
    [seasons, selectedSeasonId]
  );
  const isInternationalSeason = String(seasonMeta?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';

  const regularFixtures = useMemo(
    () => (allFixtures || []).filter((fixture) => String(fixture.stage || '').toUpperCase() === 'REGULAR'),
    [allFixtures]
  );
  const filteredClubFixtures = useMemo(
    () => regularFixtures.filter((fixture) =>
      Number(fixture.round_no || 0) === Number(selectedRound || 0) &&
      (!selectedLeagueTier || Number(fixture.league_tier || 0) === Number(selectedLeagueTier))
    ),
    [regularFixtures, selectedRound, selectedLeagueTier]
  );
  const playoffFixtures = useMemo(
    () => (allFixtures || []).filter((fixture) => ['PLAYOFF', 'FINAL'].includes(String(fixture.stage || '').toUpperCase())),
    [allFixtures]
  );
  const clubLeagueFilters = useMemo(
    () => [0, ...new Set(regularFixtures.map((fixture) => Number(fixture.league_tier || 0)).filter((tier) => tier > 0))].sort((a, b) => a - b),
    [regularFixtures]
  );
  const rankingRows = useMemo(() => {
    if (calendarData?.rankings?.length) return calendarData.rankings;
    return summary?.table || [];
  }, [calendarData, summary]);
  const dayGroups = useMemo(() => calendarData?.dayGroups || [], [calendarData]);
  const dayMap = useMemo(() => new Map(dayGroups.map((day) => [day.date, day.matches || []])), [dayGroups]);
  const upcomingSeries = useMemo(() => calendarData?.upcomingSeries || [], [calendarData]);
  const worldCupGroups = useMemo(() => calendarData?.worldCupGroups || [], [calendarData]);
  const currentCalendarDate = calendarData?.season?.currentDate || null;
  const isFollowingCurrentMonth = useMemo(() => {
    const visibleMonth = startOfMonth(calendarMonthStart || currentCalendarDate);
    const currentMonth = startOfMonth(currentCalendarDate);
    return Boolean(visibleMonth && currentMonth && visibleMonth === currentMonth);
  }, [calendarMonthStart, currentCalendarDate]);
  const calendarWeeks = useMemo(
    () => buildCalendarWeeks(calendarMonthStart || currentCalendarDate, dayMap, selectedCalendarDate, currentCalendarDate),
    [calendarMonthStart, currentCalendarDate, dayMap, selectedCalendarDate]
  );
  const selectedDayMatches = useMemo(() => dayMap.get(selectedCalendarDate) || [], [dayMap, selectedCalendarDate]);
  const selectedDayManagedMatches = useMemo(
    () => selectedDayMatches.filter((match) => match.managedTeamInvolved),
    [selectedDayMatches]
  );

  function syncQuery(nextSeasonId, nextRound = null, nextLeague = 0) {
    const next = {};
    if (nextSeasonId) next.season = String(nextSeasonId);
    if (nextRound) next.round = String(nextRound);
    if (nextLeague) next.league = String(nextLeague);
    setSearchParams(next, { replace: true });
  }

  async function loadSeason({ seasonId = null, monthStart = null } = {}) {
    setError('');
    const seasonResponse = await api.league.seasons(token);
    const seasonRows = seasonResponse.seasons || [];
    setSeasons(seasonRows);
    const requestedSeasonId = seasonId || selectedSeasonId || Number(searchParams.get('season') || 0) || seasonRows[0]?.id || null;
    const resolvedSeason = seasonRows.find((season) => Number(season.id) === Number(requestedSeasonId)) || seasonRows[0] || null;

    if (!resolvedSeason) {
      setSelectedSeasonId(null);
      setRounds([]);
      setAllFixtures([]);
      setCalendarData(null);
      setCalendarMonthStart(null);
      setSelectedCalendarDate(null);
      setSummary(null);
      return;
    }

    const sId = Number(resolvedSeason.id);
    const mode = String(resolvedSeason.competition_mode || '').toUpperCase();
    setSelectedSeasonId(sId);

    if (mode === 'INTERNATIONAL') {
      const summaryResp = await api.league.seasonSummary(token, sId);
      const anchorDate = summaryResp?.season?.calendar_date || summaryResp?.season?.cycle_start_date || summaryResp?.season?.start_date || isoDate(new Date());
      const resolvedMonthStart = startOfMonth(monthStart || anchorDate) || startOfMonth(anchorDate);
      const gridStart = startOfGrid(resolvedMonthStart);
      const gridEnd = endOfGrid(endOfMonth(resolvedMonthStart));
      const offsetDays = diffDays(anchorDate, gridStart);
      const spanDays = diffDays(gridStart, gridEnd) + 1;
      const calendarResp = await api.league.calendar(token, sId, { offsetDays, spanDays });
      setCalendarData(calendarResp);
      setSummary(summaryResp || null);
      setRounds([]);
      setAllFixtures([]);
      setCalendarMonthStart(resolvedMonthStart);
      setSelectedCalendarDate((previous) => {
        if (previous && previous >= gridStart && previous <= gridEnd) {
          return previous;
        }
        const currentKey = calendarResp?.season?.currentDate || anchorDate;
        if (currentKey >= gridStart && currentKey <= gridEnd) {
          return currentKey;
        }
        return resolvedMonthStart;
      });
      setTab('calendar');
      syncQuery(sId, null, 0);
      return;
    }

    const [roundsResp, fixturesResp, summaryResp] = await Promise.all([
      api.league.rounds(token, sId),
      api.league.fixtures(token, sId),
      api.league.seasonSummary(token, sId)
    ]);

    const roundRows = roundsResp.rounds || [];
    const fixtureRows = fixturesResp.fixtures || [];
    const requestedRound = Number(searchParams.get('round') || 0) || selectedRound;
    const firstPending = roundRows.find((round) => Number(round.completed_matches) < Number(round.total_matches))?.round_no;
    const fallbackRound = firstPending || roundRows[0]?.round_no || null;
    const resolvedRound = roundRows.some((round) => Number(round.round_no) === Number(requestedRound))
      ? Number(requestedRound)
      : fallbackRound;

    setRounds(roundRows);
    setAllFixtures(fixtureRows);
    setSummary(summaryResp || null);
    setCalendarData(null);
    setCalendarMonthStart(null);
    setSelectedCalendarDate(null);
    setSelectedRound(resolvedRound);
    setTab('regular');
    syncQuery(sId, resolvedRound, selectedLeagueTier);
  }

  async function initialLoad() {
    setLoading(true);
    try {
      await loadSeason();
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    initialLoad();
  }, [token]);

  useEffect(() => {
    const offLeague = subscribe('league:update', async (message) => {
      const seasonId = Number(message.payload?.seasonId || 0);
      if (!seasonId || seasonId !== Number(selectedSeasonId || 0)) {
        return;
      }
      try {
        await loadSeason({ seasonId, monthStart: isFollowingCurrentMonth ? null : calendarMonthStart });
      } catch {
        // best effort refresh
      }
    });

    const offProgress = subscribe('league:simulation_progress', (message) => {
      const payload = message.payload || {};
      const operationId = String(payload.operationId || '').trim();
      if (!operationId) {
        return;
      }
      setActiveSimulation((current) => {
        if (!current || String(current.operationId) !== operationId) {
          return current;
        }
        return {
          ...current,
          phase: payload.phase || current.phase,
          completed: Number(payload.completed ?? current.completed ?? 0),
          total: Number(payload.total ?? current.total ?? 0)
        };
      });
    });

    return () => {
      offLeague();
      offProgress();
    };
  }, [subscribe, selectedSeasonId, token, calendarMonthStart, isFollowingCurrentMonth]);

  useEffect(() => {
    if (!activeSimulation || activeSimulation.phase !== 'complete') {
      return undefined;
    }
    const timer = window.setTimeout(() => setActiveSimulation((current) => (current?.phase === 'complete' ? null : current)), 2200);
    return () => window.clearTimeout(timer);
  }, [activeSimulation]);

  useEffect(() => {
    if (isInternationalSeason && tab !== 'calendar') {
      setTab('calendar');
    }
    if (!isInternationalSeason && tab === 'calendar') {
      setTab('regular');
    }
  }, [isInternationalSeason, tab]);

  async function changeSeason(nextSeasonId) {
    if (!nextSeasonId) return;
    try {
      setLoading(true);
      setSelectedLeagueTier(0);
      await loadSeason({ seasonId: nextSeasonId });
    } catch (seasonError) {
      setError(seasonError.message);
    } finally {
      setLoading(false);
    }
  }

  async function changeRound(nextRound) {
    setSelectedRound(nextRound);
    syncQuery(selectedSeasonId, nextRound, selectedLeagueTier);
  }

  function changeLeagueFilter(nextLeagueTier) {
    setSelectedLeagueTier(nextLeagueTier);
    syncQuery(selectedSeasonId, selectedRound, nextLeagueTier);
  }

  async function changeCalendarMonth(step) {
    const nextMonth = addMonths(calendarMonthStart || currentCalendarDate, step);
    if (!nextMonth) return;
    try {
      setLoading(true);
      await loadSeason({ seasonId: selectedSeasonId, monthStart: nextMonth });
    } catch (calendarError) {
      setError(calendarError.message);
    } finally {
      setLoading(false);
    }
  }

  async function jumpToCurrentMonth() {
    const currentMonth = startOfMonth(currentCalendarDate);
    if (!currentMonth) return;
    try {
      setLoading(true);
      await loadSeason({ seasonId: selectedSeasonId, monthStart: currentMonth });
    } catch (calendarError) {
      setError(calendarError.message);
    } finally {
      setLoading(false);
    }
  }

  async function simulateNextDayNow() {
    const operationId = createSimulationOperationId('next-day');
    try {
      setError('');
      setBusy(true);
      setActiveSimulation({
        operationId,
        label: 'Simulating Next Day',
        phase: 'start',
        completed: 0,
        total: 0
      });
      const result = await api.league.simulateNextDay(token, { operationId });
      setActiveSimulation((current) => (
        current?.operationId === operationId
          ? { ...current, phase: 'complete', completed: Number(result.totalSimulated || 0), total: Number(result.totalMatches || result.totalSimulated || 0) }
          : current
      ));
      await loadSeason({ seasonId: selectedSeasonId, monthStart: isFollowingCurrentMonth ? null : calendarMonthStart });
    } catch (simulationError) {
      setError(simulationError.message);
      setActiveSimulation((current) => (current?.operationId === operationId ? null : current));
    } finally {
      setBusy(false);
    }
  }

  async function simulateMyLeagueRoundNow() {
    const operationId = createSimulationOperationId('my-league');
    try {
      setError('');
      setBusy(true);
      setActiveSimulation({
        operationId,
        label: 'Simulating My League Round',
        phase: 'start',
        completed: 0,
        total: 0
      });
      const result = await api.league.simulateMyLeagueRound(token, { operationId });
      setActiveSimulation((current) => (
        current?.operationId === operationId
          ? { ...current, phase: 'complete', completed: Number(result.simulated || 0), total: Number(result.totalMatches || result.simulated || 0) }
          : current
      ));
      await loadSeason({ seasonId: selectedSeasonId });
    } catch (simulationError) {
      setError(simulationError.message);
      setActiveSimulation((current) => (current?.operationId === operationId ? null : current));
    } finally {
      setBusy(false);
    }
  }

  async function simulateFixtureWithoutOpening(fixture) {
    const operationId = createSimulationOperationId('fixture');
    try {
      setError('');
      setBusy(true);
      setActiveSimulation({
        operationId,
        label: 'Simulating Match',
        phase: 'start',
        completed: 0,
        total: 1
      });
      if (String(fixture.stage || '').toUpperCase() === 'REGULAR') {
        await api.league.simulateLeagueRound(token, {
          seasonId: selectedSeasonId,
          roundNo: fixture.round_no,
          leagueTier: fixture.league_tier,
          operationId
        });
      } else {
        await api.league.simulateInstant(token, fixture.id, { operationId, useExternalFullMatchApi: true });
      }
      setActiveSimulation((current) => (
        current?.operationId === operationId ? { ...current, phase: 'complete', completed: 1, total: 1 } : current
      ));
      await loadSeason({ seasonId: selectedSeasonId });
    } catch (simulationError) {
      setError(simulationError.message);
      setActiveSimulation((current) => (current?.operationId === operationId ? null : current));
    } finally {
      setBusy(false);
    }
  }

  function renderFixtureCard(fixture, opts = {}) {
    const status = String(fixture.status || '').toUpperCase();
    const completed = status === 'COMPLETED';
    const live = status === 'LIVE';
    const winnerId = Number(fixture.winner_franchise_id || 0);
    const order = battingOrder(fixture);
    const home = teamSnap(fixture, 'home');
    const away = teamSnap(fixture, 'away');
    const homeWon = winnerId === home.id;
    const awayWon = winnerId === away.id;
    const managedId = Number(franchise?.id || 0);
    const managed = managedId > 0 && (managedId === home.id || managedId === away.id);

    return (
      <div
        key={fixture.id}
        className={`fxr ${completed ? 'fxr--done' : ''} ${live ? 'fxr--live' : ''} ${managed ? 'fxr--mine' : ''}`}
        onClick={() => navigate(`/matches/${fixture.id}?season=${selectedSeasonId || ''}`)}
      >
        <div className={`fxr-team fxr-team--home ${homeWon ? 'fxr-team--won' : ''}`}>
          <TeamNameButton franchiseId={home.id} name={home.name} country={home.country} className="fxr-team-name">
            {home.name}
          </TeamNameButton>
          <CountryLabel country={home.country} className="fxr-team-flag" />
          {(completed || live) && <span className={`fxr-mob-score ${homeWon ? 'fxr-score--won' : ''}`}>{scoreLabel(home.score, home.wickets, home.balls)}</span>}
        </div>

        <div className="fxr-center">
          {completed || live ? (
            <div className="fxr-scores">
              <span className={`fxr-score ${homeWon ? 'fxr-score--won' : ''}`}>{scoreLabel(home.score, home.wickets, home.balls)}</span>
              <span className="fxr-score-sep">-</span>
              <span className={`fxr-score ${awayWon ? 'fxr-score--won' : ''}`}>{scoreLabel(away.score, away.wickets, away.balls)}</span>
            </div>
          ) : (
            <span className="fxr-vs">vs</span>
          )}
          <div className="fxr-meta">
            <span className={`fxr-badge fxr-badge--${live ? 'live' : completed ? 'done' : 'scheduled'}`}>{statusLabel(status)}</span>
            {fixture.group_name && <span className="fxr-toss">Group {fixture.group_name}</span>}
            {order && completed && (
              <span className="fxr-toss">
                {(order.homeBattedFirst ? home.name : away.name)} batted first
              </span>
            )}
          </div>
          {completed && <span className="fxr-result">{fixture.result_summary || (homeWon ? `${home.name} won` : awayWon ? `${away.name} won` : 'Tied')}</span>}
          {!completed && fixture.matchday_label && <span className="fxr-result fxr-result--tie">{fixture.matchday_label}</span>}
        </div>

        <div className={`fxr-team fxr-team--away ${awayWon ? 'fxr-team--won' : ''}`}>
          <TeamNameButton franchiseId={away.id} name={away.name} country={away.country} className="fxr-team-name">
            {away.name}
          </TeamNameButton>
          <CountryLabel country={away.country} className="fxr-team-flag" />
          {(completed || live) && <span className={`fxr-mob-score ${awayWon ? 'fxr-score--won' : ''}`}>{scoreLabel(away.score, away.wickets, away.balls)}</span>}
        </div>

        <div className="fxr-actions" onClick={(event) => event.stopPropagation()}>
          {!completed && opts.simulatable !== false && (
            <button type="button" className="fxr-btn fxr-btn--sim" onClick={() => simulateFixtureWithoutOpening(fixture)} disabled={busy}>
              ▶
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="sq-loading"><div className="sq-spinner" /><span>Loading fixtures...</span></div>;
  }

  return (
    <div className="fx-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      <div className="fx-topbar">
        <div className="fx-season-row">
          {seasons.map((season) => (
            <button
              key={season.id}
              type="button"
              className={`fx-season-btn ${Number(season.id) === Number(selectedSeasonId) ? 'active' : ''}`}
              onClick={() => changeSeason(season.id)}
            >
              {season.name}
              <span className={`fx-season-status fx-season-status--${String(season.status || '').toLowerCase()}`}>{season.status}</span>
            </button>
          ))}
        </div>
        <div className="fx-tab-row">
          {!isInternationalSeason && (
            <>
              <button type="button" className={`fx-tab-btn ${tab === 'regular' ? 'active' : ''}`} onClick={() => setTab('regular')}>
                Regular Season
              </button>
              <button type="button" className={`fx-tab-btn ${tab === 'knockouts' ? 'active' : ''}`} onClick={() => setTab('knockouts')}>
                Knockouts
              </button>
            </>
          )}
          {isInternationalSeason && (
            <button type="button" className="fx-tab-btn active">
              International Calendar
            </button>
          )}
        </div>
      </div>

      {activeSimulation && (
        <div className="fx-global-sim">
          <div className="fx-global-sim-head">
            <span>{activeSimulation.label}</span>
            <span>{activeSimulation.total ? `${activeSimulation.completed}/${activeSimulation.total}` : activeSimulation.phase}</span>
          </div>
          <div className="fxr-sim-track">
            <div
              className="fxr-sim-fill"
              style={{ width: `${activeSimulation.total ? Math.round((Number(activeSimulation.completed || 0) / Math.max(1, Number(activeSimulation.total || 0))) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {isInternationalSeason ? (
        <>
          <section className="fx-cal-summary">
            <div className="fx-cal-summary-text">
              <div className="fx-cal-summary-title">{calendarData?.managedTeam?.franchiseName || franchise?.franchise_name || 'International Team'}</div>
              <div className="fx-cal-summary-subtitle">
                <CountryLabel country={calendarData?.managedTeam?.country || franchise?.country} /> • Rank #{calendarData?.managedTeam?.worldRank || '-'} • {calendarData?.season?.currentPhase || 'FTP'}
              </div>
            </div>
            <div className="fx-cal-summary-text fx-cal-summary-text--right">
              <div className="fx-cal-summary-title">{calendarData?.season?.currentDate || '-'}</div>
              <div className="fx-cal-summary-subtitle">Cycle Year {calendarData?.season?.cycleYear || 1} of {calendarData?.season?.cycleLengthYears || 4}</div>
            </div>
          </section>

          <section className="fx-cal-booker">
            <div className="fx-league-hdr">
              <span className="fx-league-title">FTP Calendar</span>
              <span className="fx-league-ct">{monthLabel(calendarMonthStart || currentCalendarDate)}</span>
            </div>

            <div className="fx-cal-toolbar">
              <div className="fx-cal-field">
                <span>Current Day</span>
                <strong>{currentCalendarDate || '-'}</strong>
              </div>
              <div className="fx-cal-field">
                <span>Today Matches</span>
                <strong>{calendarData?.todayMatches?.length || 0}</strong>
              </div>
              <div className="fx-cal-field">
                <span>Selected Day</span>
                <strong>{selectedCalendarDate ? dayLabel(selectedCalendarDate) : '-'}</strong>
              </div>
              <div className="fx-cal-actions">
                <button type="button" className="fx-sim-btn" onClick={() => changeCalendarMonth(-1)} disabled={busy}>Previous Month</button>
                <button type="button" className="fx-sim-btn" onClick={jumpToCurrentMonth} disabled={busy}>Current Month</button>
                <button type="button" className="fx-sim-btn" onClick={() => changeCalendarMonth(1)} disabled={busy}>Next Month</button>
                <button type="button" className="fx-sim-btn" onClick={simulateNextDayNow} disabled={busy}>
                  {busy ? 'Working...' : 'Simulate Next Day'}
                </button>
              </div>
            </div>
          </section>

          <section className="fx-league-section">
            <div className="fx-league-hdr">
              <span className="fx-league-title">Monthly Calendar</span>
              <span className="fx-league-ct">{dayGroups.reduce((sum, day) => sum + Number(day.matches?.length || 0), 0)} fixtures in view</span>
            </div>
            <div className="fx-cal-month">
              <div className="fx-cal-weekdays">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="fx-cal-weekday">{label}</div>
                ))}
              </div>
              <div className="fx-cal-month-grid">
                {calendarWeeks.flat().map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    className={`fx-cal-day ${day.inMonth ? '' : 'fx-cal-day--outside'} ${day.isToday ? 'fx-cal-day--today' : ''} ${day.isSelected ? 'fx-cal-day--selected' : ''} ${day.matches.length ? 'fx-cal-day--busy' : ''} ${day.managedCount ? 'fx-cal-day--mine' : ''}`}
                    onClick={() => setSelectedCalendarDate(day.date)}
                  >
                    <div className="fx-cal-day-head">
                      <span className="fx-cal-day-num">{Number(day.date.slice(8, 10))}</span>
                      {day.isToday && <span className="fx-cal-day-tag">Today</span>}
                    </div>
                    <div className="fx-cal-day-badges">
                      {day.managedCount > 0 && <span className="fx-cal-day-pill fx-cal-day-pill--mine">You Play</span>}
                      {day.worldCupCount > 0 && <span className="fx-cal-day-pill fx-cal-day-pill--cup">WC</span>}
                      {day.liveCount > 0 && <span className="fx-cal-day-pill fx-cal-day-pill--live">Live</span>}
                    </div>
                    <div className="fx-cal-day-meta">{day.matches.length ? `${day.matches.length} match${day.matches.length === 1 ? '' : 'es'}` : 'No matches'}</div>
                    <div className="fx-cal-day-preview">
                      {day.matches.slice(0, 2).map((match) => (
                        <span key={`preview-${day.date}-${match.id}`} className="fx-cal-day-line">
                          {match.home_franchise_name} vs {match.away_franchise_name}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="fx-cal-layout">
            <section className="fx-cal-window fx-cal-window--detail">
              <div className="fx-cal-window-head">
                <div>
                  <div className="fx-cal-window-title">{selectedCalendarDate ? dayLabel(selectedCalendarDate) : 'Select a day'}</div>
                  <div className="fx-cal-window-subtitle">
                    {selectedDayMatches.length} match{selectedDayMatches.length === 1 ? '' : 'es'}
                    {selectedDayManagedMatches.length ? ` • ${selectedDayManagedMatches.length} involving your team` : ''}
                  </div>
                </div>
              </div>
              {selectedCalendarDate && selectedDayMatches.length === 0 ? (
                <div className="sq-empty">No fixtures scheduled on this day.</div>
              ) : (
                <div className="fx-fixture-list">
                  {selectedDayMatches.map((match) => renderFixtureCard(match, { simulatable: false }))}
                </div>
              )}
            </section>

            <section className="fx-cal-window fx-cal-window--sidebar">
              <div className="fx-cal-window-head">
                <div>
                  <div className="fx-cal-window-title">My Upcoming Series</div>
                  <div className="fx-cal-window-subtitle">{upcomingSeries.length} in the visible calendar window</div>
                </div>
              </div>
              <div className="fx-cal-series-stack">
                {upcomingSeries.length === 0 ? (
                  <div className="sq-empty">No upcoming series in this month.</div>
                ) : (
                  upcomingSeries.map((series) => (
                    <div key={series.id} className="fx-cal-series-card fx-cal-series-card--compact">
                      <div className="fx-cal-series-card-head">
                        <div className="fx-cal-series-card-title">
                          <TeamNameButton franchiseId={series.homeTeam.franchiseId} name={series.homeTeam.franchiseName} country={series.homeTeam.country}>
                            {series.homeTeam.franchiseName}
                          </TeamNameButton>
                          <span className="fx-cal-series-card-vs">vs</span>
                          <TeamNameButton franchiseId={series.awayTeam.franchiseId} name={series.awayTeam.franchiseName} country={series.awayTeam.country}>
                            {series.awayTeam.franchiseName}
                          </TeamNameButton>
                        </div>
                        <span className={`fx-cal-status fx-cal-status--${String(series.status || 'scheduled').toLowerCase()}`}>{series.status}</span>
                      </div>
                      <div className="fx-cal-series-line">
                        {series.startDate} to {series.endDate} • {series.result}
                      </div>
                      <div className="fx-cal-mini-list">
                        {series.matches.map((match) => (
                          <button
                            key={`mini-${series.id}-${match.id}`}
                            type="button"
                            className="fx-cal-mini-match"
                            onClick={() => navigate(`/matches/${match.id}?season=${selectedSeasonId || ''}`)}
                          >
                            Match {match.series_match_no}: {String(match.status || '').toUpperCase() === 'COMPLETED'
                              ? `${scoreLabel(match.home_score, match.home_wickets, match.home_balls)} / ${scoreLabel(match.away_score, match.away_wickets, match.away_balls)}`
                              : statusLabel(match.status)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="fx-league-section">
            <div className="fx-league-hdr">
              <span className="fx-league-title">Global Rankings</span>
              <span className="fx-league-ct">{rankingRows.length}</span>
            </div>
            <div className="lg-table-wrap">
              <table className="lg-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>P</th>
                    <th>W</th>
                    <th>L</th>
                    <th>T</th>
                    <th>Pts</th>
                    <th>NRR</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingRows.map((row) => (
                    <tr key={row.franchise_id}>
                      <td>{row.rank || row.position || row.league_position}</td>
                      <td>
                        <div className="fx-ranking-team">
                          <CountryLabel country={row.country} showName={false} />
                          <TeamNameButton franchiseId={row.franchise_id} name={row.franchise_name} country={row.country}>
                            {row.franchise_name}
                          </TeamNameButton>
                        </div>
                      </td>
                      <td>{row.played}</td>
                      <td>{row.won}</td>
                      <td>{row.lost}</td>
                      <td>{row.tied}</td>
                      <td>{row.points}</td>
                      <td>{Number(row.net_run_rate || 0).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {worldCupGroups.length > 0 && (
            <section className="fx-league-section">
              <div className="fx-league-hdr">
                <span className="fx-league-title">World Cup Groups</span>
                <span className="fx-league-ct">{worldCupGroups.length}</span>
              </div>
              <div className="fx-cal-grid fx-cal-grid--overview">
                {worldCupGroups.map((group) => (
                  <section key={group.groupName} className="fx-cal-window">
                    <div className="fx-cal-window-head">
                      <div>
                        <div className="fx-cal-window-title">Group {group.groupName}</div>
                        <div className="fx-cal-window-subtitle">Top 2 qualify</div>
                      </div>
                    </div>
                    <div className="lg-table-wrap">
                      <table className="lg-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Team</th>
                            <th>P</th>
                            <th>W</th>
                            <th>L</th>
                            <th>Pts</th>
                            <th>NRR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, index) => (
                            <tr key={`${group.groupName}-${row.franchise_id}`}>
                              <td>{index + 1}</td>
                              <td>
                                <TeamNameButton franchiseId={row.franchise_id} name={row.franchise_name} country={row.country}>
                                  {row.franchise_name}
                                </TeamNameButton>
                              </td>
                              <td>{row.played}</td>
                              <td>{row.won}</td>
                              <td>{row.lost}</td>
                              <td>{row.points}</td>
                              <td>{Number(row.net_run_rate || 0).toFixed(3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          {tab === 'regular' && (
            <>
              <div className="fx-round-strip">
                <button type="button" className="fx-round-arr" disabled={!selectedRound || selectedRound <= 1} onClick={() => changeRound(Number(selectedRound) - 1)}>‹</button>
                <div className="fx-round-scroll">
                  {rounds.map((round) => (
                    <button
                      key={round.round_no}
                      type="button"
                      className={`fx-rchip ${Number(round.round_no) === Number(selectedRound) ? 'fx-rchip--active' : ''}`}
                      onClick={() => changeRound(round.round_no)}
                    >
                      R{round.round_no}
                    </button>
                  ))}
                </div>
                <button type="button" className="fx-round-arr" disabled={!selectedRound || selectedRound >= rounds.length} onClick={() => changeRound(Number(selectedRound) + 1)}>›</button>
              </div>

              <div className="fx-toolbar">
                <div className="fx-league-pills">
                  {clubLeagueFilters.map((tier) => (
                    <button key={tier} type="button" className={`fx-lpill ${tier === selectedLeagueTier ? 'fx-lpill--active' : ''}`} onClick={() => changeLeagueFilter(tier)}>
                      {tier === 0 ? 'All' : `L${tier}`}
                    </button>
                  ))}
                </div>
                <div className="fx-toolbar-info">
                  <span className="fx-toolbar-round">Round {selectedRound || '-'}</span>
                </div>
                <div className="fx-toolbar-actions">
                  <button type="button" className="fx-sim-btn" onClick={simulateMyLeagueRoundNow} disabled={busy}>
                    {busy ? 'Simulating...' : 'Simulate Round'}
                  </button>
                </div>
              </div>

              <div className="fx-fixture-list">
                {filteredClubFixtures.length === 0 ? <div className="sq-empty">No fixtures in this round.</div> : filteredClubFixtures.map((fixture) => renderFixtureCard(fixture))}
              </div>
            </>
          )}

          {tab === 'knockouts' && (
            <div className="fx-fixture-list">
              {playoffFixtures.length === 0 ? <div className="sq-empty">No knockout fixtures yet.</div> : playoffFixtures.map((fixture) => renderFixtureCard(fixture))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
