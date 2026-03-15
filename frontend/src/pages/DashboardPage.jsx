import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import CountryLabel, { normalizePlaceLabel } from '../components/CountryLabel';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { money, timeAgo, opId, setPageTitle } from '../utils/format';

/* ── Getting-Started onboarding card (dismissible via localStorage) ── */
const ONBOARDING_DISMISSED_KEY = 'onboarding_dismissed';

function useOnboardingCard({ franchise, squadSummary, recentResults }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'; } catch { return false; }
  });

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); } catch { /* noop */ }
  }, []);

  const steps = useMemo(() => {
    const hasSquad = Number(squadSummary?.main_squad_count || 0) >= 11;
    const hasPlayed = (recentResults?.length || 0) > 0;
    return [
      { key: 'claim', label: 'Claim a franchise', done: Boolean(franchise), hint: 'Pick a city or country to begin.' },
      { key: 'squad', label: 'Build your squad (11+ players)', done: hasSquad, hint: 'Visit Squad Management to sign or scout players.' },
      { key: 'match', label: 'Play your first match', done: hasPlayed, hint: 'Use Season Controls below to simulate a round.' },
    ];
  }, [franchise, squadSummary, recentResults]);

  const allDone = steps.every((s) => s.done);
  const visible = Boolean(franchise) && !dismissed && !allDone;

  return { visible, steps, dismiss };
}

export default function DashboardPage() {
  const { token, user, franchise, refreshProfile } = useAuth();
  const { subscribe } = useSocket();
  const toast = useToast();

  const [franchiseData, setFranchiseData] = useState(null);
  const [squadSummary, setSquadSummary] = useState(null);
  const [recentResults, setRecentResults] = useState([]);
  const [availableCities, setAvailableCities] = useState([]);
  const [internationalCountries, setInternationalCountries] = useState([]);
  const [seasonSummary, setSeasonSummary] = useState(null);
  const [valuations, setValuations] = useState([]);
  const [transferFeed, setTransferFeed] = useState([]);
  const [managerCareer, setManagerCareer] = useState(null);
  const [countrySearch, setCountrySearch] = useState('');
  const [careerMode, setCareerMode] = useState('CLUB');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [newCityName, setNewCityName] = useState('');
  const [newCityCountry, setNewCityCountry] = useState('');
  const [addingCity, setAddingCity] = useState(false);
  const [addCityNote, setAddCityNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [simulatingNextDay, setSimulatingNextDay] = useState(false);
  const [simulatingRound, setSimulatingRound] = useState(false);
  const [simulatingMyLeagueRound, setSimulatingMyLeagueRound] = useState(false);
  const [simulatingHalfSeason, setSimulatingHalfSeason] = useState(false);
  const [simulatingSeason, setSimulatingSeason] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState(null);
  const [managerActionBusy, setManagerActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetTyped, setResetTyped] = useState('');
  const [resetting, setResetting] = useState(false);
  const [pendingClaim, setPendingClaim] = useState(null); // { type: 'CLUB'|'INTERNATIONAL', cityId?, cityName?, country? }
  const [claiming, setClaiming] = useState(false);

  const onboarding = useOnboardingCard({ franchise, squadSummary, recentResults });

  useEffect(() => { setPageTitle('Dashboard'); }, []);

  async function loadData() {
    setError('');
    try {
      const [franchiseResponse, marketCities, intlCountriesResponse, activeSeason, feedResponse, managerResponse] = await Promise.all([
        api.franchise.me(token),
        api.marketplace.cities(token, '', 1200),
        api.cities.internationalCountries(token),
        api.league.activeSeason(token),
        api.marketplace.transferFeed(token, 40),
        api.manager.me(token)
      ]);
      setFranchiseData(franchiseResponse.franchise || null);
      setSquadSummary(franchiseResponse.squadSummary || null);
      setRecentResults(franchiseResponse.recentResults || []);
      setAvailableCities(marketCities.cities || []);
      setInternationalCountries(intlCountriesResponse.countries || []);
      setTransferFeed(feedResponse.feed || []);
      setManagerCareer(managerResponse || null);
      if (activeSeason.season?.id) {
        const summary = await api.league.seasonSummary(token, activeSeason.season.id);
        setSeasonSummary(summary);
      }
      if (franchiseResponse.franchise && String(franchiseResponse.franchise.competition_mode || '').toUpperCase() !== 'INTERNATIONAL') {
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
    if (!franchise) {
      const preferred = String(user?.career_mode || '').toUpperCase() === 'INTERNATIONAL' ? 'INTERNATIONAL' : 'CLUB';
      setCareerMode(preferred);
    }
  }, [franchise, user?.career_mode]);

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

  /* ── City / country claim ── */
  function requestClaimCity(cityId, cityName) {
    setPendingClaim({ type: 'CLUB', cityId, cityName });
  }

  function requestClaimCountry(country) {
    setPendingClaim({ type: 'INTERNATIONAL', country });
  }

  async function confirmClaim() {
    if (!pendingClaim || claiming) return;
    try {
      setError('');
      setClaiming(true);
      if (pendingClaim.type === 'INTERNATIONAL') {
        await api.franchise.claim(token, {
          mode: 'INTERNATIONAL',
          country: pendingClaim.country,
          franchiseName: pendingClaim.country
        });
      } else {
        await api.franchise.claim(token, {
          cityId: pendingClaim.cityId,
          mode: 'CLUB'
        });
      }
      setPendingClaim(null);
      await refreshProfile();
      await loadData();
      toast.success('Franchise claimed!');
    } catch (e) { setError(e.message); toast.error(e.message); }
    finally { setClaiming(false); }
  }

  async function acceptManagerOffer(offerId) {
    try {
      setError('');
      setManagerActionBusy(true);
      await api.manager.acceptOffer(token, offerId);
      await refreshProfile();
      await loadData();
      toast.success('Offer accepted!');
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function declineManagerOffer(offerId) {
    try {
      setError('');
      setManagerActionBusy(true);
      await api.manager.declineOffer(token, offerId);
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function applyForJob(franchiseId) {
    try {
      setError('');
      setManagerActionBusy(true);
      const result = await api.manager.apply(token, franchiseId);
      if (!result?.accepted && result?.message) {
        setError(result.message);
      }
      await refreshProfile();
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setManagerActionBusy(false);
    }
  }

  async function retireCareer() {
    const confirmed = window.confirm('Retire this manager permanently for the current save? This cannot be undone.');
    if (!confirmed) return;

    try {
      setError('');
      setManagerActionBusy(true);
      await api.manager.retire(token);
      await refreshProfile();
      await loadData();
      toast.success('Manager retired');
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setManagerActionBusy(false);
    }
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
  const simulateNextDay = makeSim('Simulating Next Day', api.league.simulateNextDay, setSimulatingNextDay, (r) => ({
    completed: Number(r.totalSimulated || 0), total: Number(r.totalMatches || r.totalSimulated || 0)
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

  const filteredInternationalCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    const list = (internationalCountries || []).map((entry) => ({
      country: entry.country,
      cityName: entry.cityName,
      available: Boolean(entry.available)
    }));
    return q ? list.filter((item) => item.country.toLowerCase().includes(q)) : list;
  }, [internationalCountries, countrySearch]);

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

  const isBusy = simulatingNextDay || simulatingRound || simulatingSeason || simulatingHalfSeason || simulatingMyLeagueRound;

  /* ── Reset game ── */
  async function resetGame() {
    try {
      setError('');
      setResetting(true);
      await api.admin.resetGame(token);
      setShowResetConfirm(false);
      setResetTyped('');
      await refreshProfile();
      await loadData();
      toast.success('Career reset complete');
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setResetting(false);
    }
  }

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
    const managerStatus = String(managerCareer?.manager?.status || user?.manager_status || 'UNEMPLOYED').toUpperCase();
    const hasWorld = Number(managerCareer?.worldFranchiseCount || 0) > 0;
    const unemployedState = managerCareer?.unemployed || {};
    const pendingOffers = Array.isArray(unemployedState.offers)
      ? unemployedState.offers.filter((offer) => String(offer.status || '').toUpperCase() === 'PENDING')
      : [];
    const applyMarket = Array.isArray(unemployedState.applyMarket) ? unemployedState.applyMarket : [];

    if (managerStatus === 'RETIRED') {
      return (
        <div className="db-page">
          {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
          <div className="db-card">
            <h3 className="db-section-title">Manager Career Closed</h3>
            <p className="db-danger-desc">
              This save is permanently retired. Start a new game to take another managerial role.
            </p>
            <div className="db-season-meta">
              <span><strong>Career Points:</strong> {managerCareer?.manager?.points || 0}</span>
              <span><strong>Titles:</strong> {managerCareer?.manager?.titles || 0}</span>
            </div>
          </div>
        </div>
      );
    }

    const hasEverManaged = Boolean(managerCareer?.hasEverManaged);

    if (hasWorld && managerStatus === 'UNEMPLOYED' && hasEverManaged) {
      return (
        <div className="db-page">
          {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}
          <div className="db-card">
            <h3 className="db-section-title">Manager Job Market</h3>
            <p className="db-danger-desc">
              You are currently unemployed. Review board offers first, then apply to open teams after the cooldown.
            </p>
            <div className="db-season-meta">
              <span><strong>Manager Points:</strong> {managerCareer?.manager?.points || 0}</span>
              <span><strong>Firings:</strong> {managerCareer?.manager?.firings || 0}</span>
              <span><strong>Career Mode:</strong> {managerCareer?.manager?.careerMode || 'CLUB'}</span>
            </div>
            <div className="db-sim-buttons db-sim-buttons--top">
              {unemployedCareerMode === 'INTERNATIONAL' ? (
                <>
                  <button type="button" className="sq-btn sq-btn--primary" disabled={isBusy} onClick={simulateNextDay}>
                    {simulatingNextDay ? '⏳ Simulating Day...' : '▶ Simulate Next Day'}
                  </button>
                  <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateFullSeason}>
                    {simulatingSeason ? '⏳ Full Cycle...' : '⏩ Simulate Full Cycle'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="sq-btn sq-btn--primary" disabled={isBusy} onClick={simulateNextRound}>
                    {simulatingRound ? '⏳ Simulating...' : '▶ Simulate Next Round'}
                  </button>
                  <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateHalfSeason}>
                    {simulatingHalfSeason ? '⏳ Half Season...' : '⏩ Simulate Half Season'}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="db-two-col">
            <div className="db-card">
              <h3 className="db-section-title">Board Offers</h3>
              {pendingOffers.length === 0 ? (
                <div className="sq-empty">No pending offers right now. Simulate another round or check apply market.</div>
              ) : (
                <div className="db-results-list">
                  {pendingOffers.map((offer) => (
                    <div key={offer.id} className="db-result-item" style={{ display: 'block' }}>
                      <div className="db-season-meta" style={{ marginBottom: 6 }}>
                        <span><strong>{offer.franchise_name}</strong></span>
                        <span>{offer.city_name}, {offer.country}</span>
                      </div>
                      <div className="db-season-meta" style={{ marginBottom: 8 }}>
                        <span>League {offer.current_league_tier}</span>
                        <span>{offer.won || 0}W-{offer.lost || 0}L</span>
                        <span>Score {Number(offer.offer_score || 0).toFixed(1)}</span>
                      </div>
                      <div className="db-sim-buttons">
                        <button
                          type="button"
                          className="sq-btn sq-btn--primary"
                          disabled={managerActionBusy}
                          onClick={() => acceptManagerOffer(offer.id)}
                        >
                          Accept Offer
                        </button>
                        <button
                          type="button"
                          className="sq-btn"
                          disabled={managerActionBusy}
                          onClick={() => declineManagerOffer(offer.id)}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="db-card">
              <h3 className="db-section-title">Apply Market</h3>
              {!unemployedState.unlocked ? (
                <div className="sq-empty">
                  Unlocks after {Number(unemployedState.roundsRemaining || 0)} more completed round(s).
                </div>
              ) : applyMarket.length === 0 ? (
                <div className="sq-empty">No teams are currently accepting applications.</div>
              ) : (
                <div className="db-results-list">
                  {applyMarket.map((team) => (
                    <div key={team.id} className="db-result-item" style={{ display: 'block' }}>
                      <div className="db-season-meta" style={{ marginBottom: 6 }}>
                        <span><strong>{team.franchise_name}</strong></span>
                        <span>{team.city_name}, {team.country}</span>
                      </div>
                      <div className="db-season-meta" style={{ marginBottom: 8 }}>
                        <span>League {team.current_league_tier}</span>
                        <span>{team.won || 0}W-{team.lost || 0}L</span>
                        <span>{money(team.total_valuation)}</span>
                      </div>
                      <button
                        type="button"
                        className="sq-btn"
                        disabled={managerActionBusy}
                        onClick={() => applyForJob(team.id)}
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const isInternationalCareer = careerMode === 'INTERNATIONAL';
    const unemployedCareerMode = String(managerCareer?.manager?.careerMode || careerMode || 'CLUB').toUpperCase();
    const pickerStep = selectedCountry ? 2 : 1;
    const internationalTeamCount = internationalCountries.length || 100;
    return (
      <div className="db-page fp-page">
        {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

        <div className="sq-tabs db-career-tabs">
          <button
            type="button"
            className={`sq-tab ${careerMode === 'CLUB' ? 'active' : ''}`}
            onClick={() => {
              setCareerMode('CLUB');
              setSelectedCountry('');
              setCountrySearch('');
              setCitySearch('');
            }}
          >
            Club T20 Career
          </button>
          <button
            type="button"
            className={`sq-tab ${careerMode === 'INTERNATIONAL' ? 'active' : ''}`}
            onClick={() => {
              setCareerMode('INTERNATIONAL');
              setSelectedCountry('');
              setCountrySearch('');
              setCitySearch('');
            }}
          >
            International Career
          </button>
        </div>

        {/* ── Hero banner ── */}
        <div className="fp-hero">
          <div className="fp-hero-icon">🏏</div>
          <h2 className="fp-hero-title">{isInternationalCareer ? 'Select Your National Team' : 'Claim Your City'}</h2>
          <p className="fp-hero-sub">
            {isInternationalCareer
              ? 'Choose one country and take charge of a fully scheduled four-year international FTP cycle.'
              : 'Choose a city, build a franchise, and rise through the global cricket pyramid.'}
            <br />
            {isInternationalCareer
              ? <>{internationalTeamCount} national teams, global rankings, bilateral T20 series, and a World Cup every four years.</>
              : <>Every club begins at <strong className="fp-price-tag">$100.00</strong>.</>}
          </p>
          <div className="fp-hero-stats">
            <div className="fp-stat">
              <span className="fp-stat-val">{isInternationalCareer ? internationalCountries.length : countries.length}</span>
              <span className="fp-stat-lbl">Countries</span>
            </div>
            <div className="fp-stat-divider" />
            <div className="fp-stat">
              <span className="fp-stat-val">{isInternationalCareer ? filteredInternationalCountries.filter((entry) => entry.available).length : availableCities.length}</span>
              <span className="fp-stat-lbl">{isInternationalCareer ? 'Open Teams' : 'Open Cities'}</span>
            </div>
            <div className="fp-stat-divider" />
            <div className="fp-stat fp-stat--active">
              <span className="fp-stat-val">{selectedCountry || '—'}</span>
              <span className="fp-stat-lbl">Selected</span>
            </div>
          </div>
        </div>

        {isInternationalCareer ? (
          <div className="fp-card fp-card--active">
            <div className="fp-card-head">
              <div className="fp-card-num">1</div>
              <div>
                <h3 className="fp-card-title">Choose Country</h3>
                <span className="fp-card-sub">One national team per country. All teams start at equal base strength.</span>
              </div>
            </div>

            <div className="fp-search-wrap">
              <span className="fp-search-icon">🔍</span>
              <input
                type="search"
                className="fp-search"
                value={countrySearch}
                onChange={(e) => setCountrySearch(e.target.value)}
                placeholder="Search countries…"
              />
              {countrySearch && (
                <span className="fp-search-count">{filteredInternationalCountries.length} found</span>
              )}
            </div>

            <div className="fp-country-list">
              {filteredInternationalCountries.map((item) => (
                <button
                  key={item.country}
                  type="button"
                  className={`fp-country-row ${selectedCountry === item.country ? 'fp-country-row--active' : ''}`}
                  onClick={() => {
                    setSelectedCountry(item.country);
                    if (item.available) {
                      requestClaimCountry(item.country);
                    }
                  }}
                  disabled={!item.available}
                  title={item.available ? `Claim ${item.country}` : `${item.country} is already assigned`}
                >
                  <CountryLabel country={item.country} className="fp-country-name" />
                  <span className={`fp-country-badge ${item.available ? '' : 'is-claimed'}`}>{item.available ? 'Available' : 'Taken'}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* ── Step indicator ── */}
            <div className="fp-steps-bar">
              <div className={`fp-steps-dot ${pickerStep >= 1 ? 'fp-steps-dot--done' : ''}`}>
                <span>1</span>
              </div>
              <div className={`fp-steps-line ${pickerStep >= 2 ? 'fp-steps-line--done' : ''}`} />
              <div className={`fp-steps-dot ${pickerStep >= 2 ? 'fp-steps-dot--done' : ''}`}>
                <span>2</span>
              </div>
            </div>

            <div className="fp-picker-grid">
              {/* ── Step 1: Country ── */}
              <div className={`fp-card ${pickerStep === 1 ? 'fp-card--active' : ''}`}>
                <div className="fp-card-head">
                  <div className="fp-card-num">1</div>
                  <div>
                    <h3 className="fp-card-title">Select Country</h3>
                    <span className="fp-card-sub">Pick the nation where your franchise will be based.</span>
                  </div>
                  {selectedCountry && (
                    <button type="button" className="fp-clear-btn" onClick={() => { setSelectedCountry(''); setCitySearch(''); }}>
                      ✕ Clear
                    </button>
                  )}
                </div>

                <div className="fp-search-wrap">
                  <span className="fp-search-icon">🔍</span>
                  <input
                    type="search"
                    className="fp-search"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    placeholder="Search countries…"
                  />
                  {countrySearch && (
                    <span className="fp-search-count">{filteredCountries.length} found</span>
                  )}
                </div>

                <div className="fp-country-list">
                  {filteredCountries.map((item) => (
                    <button
                      key={item.country}
                      type="button"
                      className={`fp-country-row ${selectedCountry === item.country ? 'fp-country-row--active' : ''}`}
                      onClick={() => { setSelectedCountry(item.country); setCitySearch(''); }}
                    >
                      <CountryLabel country={item.country} className="fp-country-name" />
                      <span className="fp-country-badge">{item.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Step 2: City ── */}
              <div className={`fp-card ${pickerStep === 2 ? 'fp-card--active' : ''} ${!selectedCountry ? 'fp-card--disabled' : ''}`}>
                <div className="fp-card-head">
                  <div className="fp-card-num">2</div>
                  <div>
                    <h3 className="fp-card-title">Select City</h3>
                    <span className="fp-card-sub">
                      {selectedCountry
                        ? <>{countryCities.length} {countryCities.length === 1 ? 'city' : 'cities'} available in <strong><CountryLabel country={selectedCountry} /></strong></>
                        : 'Select a country first to see available cities.'}
                    </span>
                  </div>
                </div>

                {selectedCountry && (
                  <div className="fp-search-wrap">
                    <span className="fp-search-icon">🔍</span>
                    <input
                      type="search"
                      className="fp-search"
                      value={citySearch}
                      onChange={(e) => setCitySearch(e.target.value)}
                      placeholder={`Search in ${selectedCountry}…`}
                    />
                  </div>
                )}

                {!selectedCountry ? (
                  <div className="fp-empty">
                    <div className="fp-empty-icon">🌍</div>
                    <span>Choose your country on the left to unlock city selection.</span>
                  </div>
                ) : filteredCities.length === 0 ? (
                  <div className="fp-empty">
                    <div className="fp-empty-icon">🔎</div>
                    <span>No matching cities in <CountryLabel country={selectedCountry} />.</span>
                  </div>
                ) : (
                  <div className="fp-city-grid">
                    {filteredCities.map((city) => (
                      <button
                        key={city.id}
                        type="button"
                        className="fp-city-card"
                        onClick={() => requestClaimCity(city.id, city.name)}
                      >
                        <span className="fp-city-name">{city.name}</span>
                        <span className="fp-city-country">{city.country}</span>
                        <span className="fp-city-price">$100</span>
                        <span className="fp-city-cta">Claim →</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* ── Add missing city ── */}
                <div className="fp-add-city">
                  <div className="fp-add-city-head">
                    <span className="fp-add-city-icon">📍</span>
                    <div>
                      <strong>Can&apos;t find your city?</strong>
                      <span>We&apos;ll verify and add it to the global database instantly.</span>
                    </div>
                  </div>
                  <form className="fp-add-city-form" onSubmit={addMissingCity}>
                    <input
                      type="text"
                      value={newCityName}
                      onChange={(e) => setNewCityName(e.target.value)}
                      placeholder="City name"
                      required
                    />
                    <input
                      type="text"
                      value={newCityCountry}
                      onChange={(e) => setNewCityCountry(e.target.value)}
                      placeholder="Country"
                      required
                    />
                    <button type="submit" className="fp-add-btn" disabled={addingCity}>
                      {addingCity ? '⏳ Verifying…' : '✓ Verify & Add'}
                    </button>
                  </form>
                  {addCityNote && <span className="fp-add-city-note">✅ {addCityNote}</span>}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Confirmation modal ── */}
        {pendingClaim && (
          <div className="sq-modal-backdrop" onClick={() => { if (!claiming) setPendingClaim(null); }}>
            <div className="fp-confirm-modal" onClick={(e) => e.stopPropagation()}>
              {claiming ? (
                <div className="sq-loading" style={{ padding: '2rem 0' }}>
                  <div className="sq-spinner" />
                  <span>Setting up your franchise…</span>
                </div>
              ) : (
                <>
                  <h3 className="fp-confirm-title">Confirm Selection</h3>
                  <p className="fp-confirm-text">
                    {pendingClaim.type === 'INTERNATIONAL' ? (
                      <>You are about to start an <strong>International Career</strong> managing <strong><CountryLabel country={pendingClaim.country} /></strong>.</>
                    ) : (
                      <>You are about to start a <strong>Club T20 Career</strong> in <strong>{pendingClaim.cityName}, {selectedCountry}</strong>.</>
                    )}
                  </p>
                  <p className="fp-confirm-sub">This cannot be undone without resetting your save.</p>
                  <div className="fp-confirm-actions">
                    <button type="button" className="sq-btn" onClick={() => setPendingClaim(null)}>← Go Back</button>
                    <button type="button" className="sq-btn sq-btn--primary" onClick={confirmClaim}>Confirm & Start →</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
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
  const isInternationalMode = String(fd?.competition_mode || '').toUpperCase() === 'INTERNATIONAL';
  const teamStrength = Number(fd?.strength_rating ?? squadSummary?.avg_team_rating ?? 0);
  const teamsPerLeague = Number(ss?.season?.teams_per_league || 0);
  const boardConfidence = Number(managerCareer?.board?.confidence || 0);
  const boardObjectives = Array.isArray(managerCareer?.board?.objectives) ? managerCareer.board.objectives : [];
  const hasDistinctInternationalBase = fd?.city_name
    && fd?.country
    && normalizePlaceLabel(fd.city_name) !== normalizePlaceLabel(fd.country);

  return (
    <div className="db-page">
      {error && <div className="sq-error">{error}<button type="button" onClick={() => setError('')}>×</button></div>}

      {/* ── Getting Started onboarding card ── */}
      {onboarding.visible && (
        <div className="db-card db-onboarding">
          <div className="db-onboarding-head">
            <h3 className="db-section-title">🚀 Getting Started</h3>
            <button type="button" className="db-onboarding-dismiss" onClick={onboarding.dismiss} title="Dismiss">✕</button>
          </div>
          <p className="db-onboarding-sub">Complete these steps to get your franchise up and running.</p>
          <ul className="db-onboarding-steps">
            {onboarding.steps.map((step) => (
              <li key={step.key} className={`db-onboarding-step ${step.done ? 'db-onboarding-step--done' : ''}`}>
                <span className="db-onboarding-check">{step.done ? '✅' : '⬜'}</span>
                <div>
                  <strong>{step.label}</strong>
                  {!step.done && <span className="db-onboarding-hint">{step.hint}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Header ── */}
      <div className="db-command">
        <div className="db-command-copy">
          <span className="db-command-kicker">{isInternationalMode ? 'International Command' : 'Club Command'}</span>
          <div className="db-header">
            <div>
              <h2 className="db-title">{fd?.franchise_name || 'Dashboard'}</h2>
              <span className="db-subtitle">
                {isInternationalMode
                  ? hasDistinctInternationalBase
                    ? <>{fd?.city_name} · <CountryLabel country={fd?.country} /></>
                    : <CountryLabel country={fd?.country || fd?.city_name} />
                  : <>{fd?.city_name}, {fd?.country}</>
                }
                {' '}&middot; {isInternationalMode ? 'International Career' : `League ${fd?.current_league_tier || 1}`}
              </span>
            </div>
          </div>
          <div className="db-command-tags">
            <span>{fd?.wins || 0}W-{fd?.losses || 0}L</span>
            <span>{isInternationalMode ? `World Rank ${fd?.league_position || '—'}` : `League Position ${fd?.league_position || '—'}/${teamsPerLeague || '?'}`}</span>
            <span>{squadSummary?.main_squad_count || 0} main squad</span>
            <span>{squadSummary?.youth_count || 0} youth</span>
          </div>
        </div>
        <div className="db-command-controls">
          <div className="db-card-head">
            <div>
              <h3 className="db-section-title">Season Controls</h3>
              <p className="db-card-note">
                {isInternationalMode
                  ? 'Advance the global calendar and auto-resolve scheduled international fixtures.'
                  : 'Push the domestic season forward without leaving the dashboard.'}
              </p>
            </div>
          </div>
          <div className="db-sim-buttons">
            {isInternationalMode ? (
              <button type="button" className="sq-btn sq-btn--primary" disabled={isBusy} onClick={simulateNextDay}>
                {simulatingNextDay ? '⏳ Simulating Day...' : '▶ Next Day'}
              </button>
            ) : (
              <>
                <button type="button" className="sq-btn sq-btn--primary" disabled={isBusy} onClick={simulateNextRound}>
                  {simulatingRound ? '⏳ Simulating...' : '▶ Next Round'}
                </button>
                <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateMyLeagueRound}>
                  {simulatingMyLeagueRound ? '⏳ My League...' : '🏟️ My League Round'}
                </button>
                <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateHalfSeason}>
                  {simulatingHalfSeason ? '⏳ Half Season...' : '⏩ Half Season'}
                </button>
              </>
            )}
            <button type="button" className="sq-btn" disabled={isBusy} onClick={simulateFullSeason}>
              {simulatingSeason ? (isInternationalMode ? '⏳ Full Cycle...' : '⏳ Full Season...') : (isInternationalMode ? '🔄 Full Cycle' : '🔄 Full Season')}
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
      </div>

      {/* ── Hero stats ── */}
      <div className="db-hero-strip">
        <div className="db-hero-card">
          <span className="db-hero-label">{isInternationalMode ? 'Team Strength' : 'Franchise Value'}</span>
          <span className="db-hero-value db-hero-value--green">{isInternationalMode ? teamStrength.toFixed(1) : money(fd?.total_valuation)}</span>
          {!isInternationalMode && <ValSparkline data={valuationSeries} />}
        </div>
        <div className="db-hero-card">
          <span className="db-hero-label">Record</span>
          <span className="db-hero-value">{fd?.wins || 0}<span className="db-hero-dim">W</span> – {fd?.losses || 0}<span className="db-hero-dim">L</span></span>
          <span className="db-hero-hint">🏆 {fd?.championships || 0} titles</span>
        </div>
        <div className="db-hero-card">
          <span className="db-hero-label">{isInternationalMode ? 'World Rank' : 'League Position'}</span>
          <span className="db-hero-value">{fd?.league_position || '—'}<span className="db-hero-dim">/ {teamsPerLeague || '?'}</span></span>
          <span className="db-hero-hint">{isInternationalMode ? 'Global standings' : `Tier ${fd?.current_league_tier || 1}`}</span>
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

      {/* ── Overview row ── */}
      <div className="db-overview-grid">
        <div className="db-card">
          <div className="db-card-head">
            <div>
              <h3 className="db-section-title">Manager Career</h3>
              <p className="db-card-note">Board confidence, reputation, and the objectives keeping your job secure.</p>
            </div>
            <button
              type="button"
              className="sq-btn sq-btn--danger"
              disabled={managerActionBusy}
              onClick={retireCareer}
            >
              Retire Manager
            </button>
          </div>
          <div className="db-kpi-grid">
            <div className="db-kpi">
              <span>Points</span>
              <strong>{managerCareer?.manager?.points || 0}</strong>
            </div>
            <div className="db-kpi">
              <span>Status</span>
              <strong>{managerCareer?.manager?.status || 'ACTIVE'}</strong>
            </div>
            <div className="db-kpi">
              <span>Career Record</span>
              <strong>{managerCareer?.manager?.winsManaged || 0}W-{managerCareer?.manager?.lossesManaged || 0}L</strong>
            </div>
            <div className="db-kpi">
              <span>Titles</span>
              <strong>{managerCareer?.manager?.titles || 0}</strong>
            </div>
          </div>
          <div className="db-sim-progress">
            <div className="db-sim-progress-head">
              <strong>Board Confidence</strong>
              <span>{boardConfidence.toFixed(0)} / 100</span>
            </div>
            <div className="db-sim-track">
              <div className="db-sim-fill" style={{ width: `${Math.max(0, Math.min(100, Math.round(boardConfidence)))}%` }} />
            </div>
          </div>
          {boardObjectives.length > 0 ? (
            <div className="db-objective-list">
              {boardObjectives.map((objective) => (
                <div key={objective.id || objective.objective_code} className="db-objective-item">
                  <span className={`db-objective-status ${
                    objective.status === 'COMPLETED'
                      ? 'db-result-badge--win'
                      : objective.status === 'FAILED'
                        ? 'db-result-badge--loss'
                        : 'db-result-badge--draw'
                  }`}
                  >
                    {objective.status === 'COMPLETED' ? 'Completed' : objective.status === 'FAILED' ? 'Failed' : 'In Progress'}
                  </span>
                  <div className="db-objective-copy">
                    <strong>{String(objective.objective_code || '').replace(/_/g, ' ')}</strong>
                    <span>Target {Number(objective.target_value || 0).toFixed(1)} • Progress {Number(objective.progress_value || 0).toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sq-empty">Board objectives will appear after your current season context is initialized.</div>
          )}
        </div>

        {/* Season overview */}
        <div className="db-card">
          <div className="db-card-head">
            <div>
              <h3 className="db-section-title">Season Overview</h3>
              <p className="db-card-note">{isInternationalMode ? 'Track the current FTP cycle, date, and tournament path.' : 'See how far the domestic season has progressed.'}</p>
            </div>
          </div>
          {ss ? (
            <>
              <div className="db-season-meta">
                <span><strong>{ss.season.name}</strong></span>
                <span>
                  {isInternationalMode
                    ? `Cycle Year ${ss.season.current_cycle_year || 1} of ${ss.season.cycle_length_years || 4} • ${ss.season.current_phase || 'FTP'}`
                    : `${ss.season.league_count || 4} leagues`}
                </span>
              </div>
              <div className="db-season-progress">
                <div className="db-season-bar"><div className="db-season-bar-fill" style={{ width: `${fixturesPct}%` }} /></div>
                <span className="db-season-pct">{fixturesDone}/{fixturesTotal} matches ({fixturesPct}%)</span>
              </div>
              {isInternationalMode ? (
                <div className="db-results-list">
                  <div className="db-result-item">
                    <span className="db-result-badge db-result-badge--draw">📅</span>
                    <div className="db-result-body">
                      <span className="db-result-summary">Current date</span>
                      <span className="db-result-time">{ss.season.calendar_date || '—'}</span>
                    </div>
                  </div>
                  <div className="db-result-item">
                    <span className="db-result-badge db-result-badge--draw">🤝</span>
                    <div className="db-result-body">
                      <span className="db-result-summary">FTP series</span>
                      <span className="db-result-time">
                        {Number(ss.seriesOverview?.completed_series || 0)} / {Number(ss.seriesOverview?.total_series || 0)} completed
                      </span>
                    </div>
                  </div>
                  <div className="db-result-item">
                    <span className="db-result-badge db-result-badge--draw">🏆</span>
                    <div className="db-result-body">
                      <span className="db-result-summary">World Cup</span>
                      <span className="db-result-time">
                        {(ss.worldCupOverview || []).length
                          ? (ss.worldCupOverview || []).map((entry) => `${String(entry.stage || '').replace('WORLD_CUP_', '')}: ${entry.completed_matches}/${entry.total_matches}`).join(' • ')
                          : 'Qualification in progress'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (ss.rounds || []).length > 0 && (
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
          <div className="db-card-head">
            <div>
              <h3 className="db-section-title">Recent Results</h3>
              <p className="db-card-note">The latest outcomes shaping morale, form, and board sentiment.</p>
            </div>
          </div>
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

      {!isInternationalMode && (
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
      )}

      {/* ── Danger Zone ── */}
      <div className="db-card db-card--danger">
        <h3 className="db-section-title db-section-title--danger">Danger Zone</h3>
        <p className="db-danger-desc">
          Reset your career and start fresh. This releases your franchise back to CPU control and clears your manager history. Other players are not affected.
        </p>
        <button type="button" className="sq-btn sq-btn--danger" onClick={() => { setShowResetConfirm(true); setResetTyped(''); }}>
          🔄 Reset My Career
        </button>
      </div>

      {/* ── Reset confirmation modal ── */}
      {showResetConfirm && (
        <div className="sq-modal-backdrop" role="presentation" onClick={() => setShowResetConfirm(false)}>
          <div className="db-reset-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="db-reset-modal-title">⚠️ Reset Your Career?</h3>
            <p className="db-reset-modal-body">
              This will <strong>permanently reset</strong> your career:
            </p>
            <ul className="db-reset-modal-list">
              <li>Your franchise returns to CPU control</li>
              <li>Manager history, trophies &amp; stats cleared</li>
              <li>You'll pick a new city or country to start again</li>
            </ul>
            <p className="db-reset-modal-body">
              Type <strong>RESET</strong> below to confirm:
            </p>
            <input
              type="text"
              className="db-reset-input"
              value={resetTyped}
              onChange={(e) => setResetTyped(e.target.value.toUpperCase())}
              placeholder="Type RESET"
              autoFocus
            />
            <div className="db-reset-modal-actions">
              <button type="button" className="sq-btn" onClick={() => setShowResetConfirm(false)}>Cancel</button>
              <button
                type="button"
                className="sq-btn sq-btn--danger"
                disabled={resetTyped !== 'RESET' || resetting}
                onClick={resetGame}
              >
                {resetting ? 'Resetting…' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
