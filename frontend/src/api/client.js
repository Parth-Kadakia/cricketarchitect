// In production (served from same origin), use relative /api path.
// In development, use the explicit env var or default to localhost:4000.
const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api');

function buildHeaders(token, hasJson = true) {
  const headers = {};

  if (hasJson) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;

    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch (error) {
      // Keep fallback message.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export const api = {
  auth: {
    register: (payload) =>
      request('/auth/register', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload)
      }),
    login: (payload) =>
      request('/auth/login', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload)
      }),
    me: (token) =>
      request('/auth/me', {
        method: 'GET',
        headers: buildHeaders(token, false)
      }),
    updateProfile: (token, payload) =>
      request('/auth/profile', {
        method: 'PATCH',
        headers: buildHeaders(token),
        body: JSON.stringify(payload)
      })
  },
  cities: {
    list: (availableOnly = false, q = '', limit = 600) =>
      request(`/cities?available=${availableOnly}&q=${encodeURIComponent(q)}&limit=${limit}`),
    internationalCountries: () =>
      request('/cities/international-countries'),
    add: (token, payload) =>
      request('/cities', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload)
      })
  },
  franchise: {
    me: (token) => request('/franchises/me', { headers: buildHeaders(token, false) }),
    claim: (token, payload) =>
      request('/franchises/claim', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload)
      }),
    purchase: (token, franchiseId, payload = {}) =>
      request(`/franchises/${franchiseId}/purchase`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload)
      }),
    listForSale: (token, franchiseId) =>
      request(`/franchises/${franchiseId}/list-for-sale`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    sellNow: (token, franchiseId) =>
      request(`/franchises/${franchiseId}/sell-now`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    academyUpgrade: (token, franchiseId, mode) =>
      request(`/franchises/${franchiseId}/academy-upgrade`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ mode })
      }),
    trophies: (franchiseId) => request(`/franchises/${franchiseId}/trophies`)
  },
  squad: {
    get: (token) => request('/squad', { headers: buildHeaders(token, false) }),
    franchise: (token, franchiseId) =>
      request(`/squad/franchise/${franchiseId}`, {
        headers: buildHeaders(token, false)
      }),
    playerDetail: (token, playerId) => request(`/squad/player/${playerId}`, { headers: buildHeaders(token, false) }),
    lineup: (token) => request('/squad/lineup', { headers: buildHeaders(token, false) }),
    setLineup: (token, playerIds) =>
      request('/squad/lineup', {
        method: 'PUT',
        headers: buildHeaders(token),
        body: JSON.stringify({ playerIds })
      }),
    promote: (token, playerId) =>
      request(`/squad/promote/${playerId}`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    loan: (token, playerId, targetFranchiseId) =>
      request(`/squad/loan/${playerId}`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ targetFranchiseId })
      }),
    release: (token, playerId) =>
      request(`/squad/release/${playerId}`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    demote: (token, playerId) =>
      request(`/squad/demote/${playerId}`, {
        method: 'POST',
        headers: buildHeaders(token)
      })
  },
  youth: {
    academy: (token) => request('/youth/academy', { headers: buildHeaders(token, false) }),
    regions: (token) => request('/youth/regions', { headers: buildHeaders(token, false) }),
    prospects: (token) => request('/youth/prospects', { headers: buildHeaders(token, false) }),
    generate: (token) =>
      request('/youth/generate', {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    grow: (token) =>
      request('/youth/grow', {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    upgrade: (token, mode) =>
      request('/youth/upgrade', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ mode })
      }),
    growthHistory: (token, playerId) => request(`/youth/growth-history/${playerId}`, { headers: buildHeaders(token, false) })
  },
  league: {
    seasons: () => request('/league/seasons'),
    activeSeason: () => request('/league/seasons/active'),
    seasonSummary: (seasonId) => request(`/league/seasons/${seasonId}/summary`),
    seasonStats: (seasonId) => request(`/league/seasons/${seasonId}/stats`),
    table: (seasonId) => request(`/league/table${seasonId ? `?seasonId=${seasonId}` : ''}`),
    rounds: (seasonId) => request(`/league/rounds${seasonId ? `?seasonId=${seasonId}` : ''}`),
    fixtures: (seasonId, roundNo = null) =>
      request(`/league/fixtures${seasonId || roundNo ? `?${[seasonId ? `seasonId=${seasonId}` : null, roundNo ? `roundNo=${roundNo}` : null].filter(Boolean).join('&')}` : ''}`),
    events: (matchId) => request(`/league/matches/${matchId}/events`),
    scorecard: (matchId) => request(`/league/matches/${matchId}/scorecard`),
    simulateLive: (token, matchId, ballDelayMs = 120, operationId = null) =>
      request(`/league/matches/${matchId}/simulate-live`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ ballDelayMs, ...(operationId ? { operationId } : {}) })
      }),
    simulateInstant: (token, matchId, payload = {}) =>
      request(`/league/matches/${matchId}/simulate-instant`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload || {})
      }),
    resetMatch: (token, matchId) =>
      request(`/league/matches/${matchId}/reset`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    simulateNextRound: (token, payload = {}) =>
      request('/league/simulate-next-round', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload || {})
      }),
    simulateLeagueRound: (token, payload) =>
      request('/league/simulate-league-round', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload)
      }),
    simulateMyLeagueRound: (token, payload = {}) =>
      request('/league/simulate-my-league-round', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload || {})
      }),
    simulateSeason: (token, payload = {}) =>
      request('/league/simulate-season', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload || {})
      }),
    simulateHalfSeason: (token, payload = {}) =>
      request('/league/simulate-half-season', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(payload || {})
      }),
    allStats: (seasonId = null) =>
      request(`/league/all-stats${seasonId ? `?seasonId=${seasonId}` : ''}`)
  },
  statbook: {
    overview: (seasonId = null) =>
      request(`/statbook/overview${seasonId ? `?seasonId=${seasonId}` : ''}`),
    playerRecords: (seasonId = null, limit = 20) =>
      request(`/statbook/player-records?${[seasonId ? `seasonId=${seasonId}` : null, `limit=${limit}`].filter(Boolean).join('&')}`),
    teamRecords: (seasonId = null, limit = 20) =>
      request(`/statbook/team-records?${[seasonId ? `seasonId=${seasonId}` : null, `limit=${limit}`].filter(Boolean).join('&')}`),
    headToHead: (teamAId, teamBId, seasonId = null, limit = 20) =>
      request(`/statbook/head-to-head?${[
        `teamAId=${teamAId}`,
        `teamBId=${teamBId}`,
        seasonId ? `seasonId=${seasonId}` : null,
        `limit=${limit}`
      ].filter(Boolean).join('&')}`),
    matchArchive: ({ seasonId = null, teamId = null, limit = 30, offset = 0 } = {}) =>
      request(`/statbook/match-archive?${[
        seasonId ? `seasonId=${seasonId}` : null,
        teamId ? `teamId=${teamId}` : null,
        `limit=${limit}`,
        `offset=${offset}`
      ].filter(Boolean).join('&')}`),
    matchDetail: (matchId) => request(`/statbook/match-archive/${matchId}`)
  },
  marketplace: {
    overview: () => request('/marketplace'),
    cities: (q = '', limit = 600) => request(`/marketplace/cities?q=${encodeURIComponent(q)}&limit=${limit}`),
    franchises: () => request('/marketplace/franchises'),
    auctionPool: () => request('/marketplace/auction-pool'),
    buyAuctionPlayer: (token, playerId) =>
      request(`/marketplace/auction-pool/${playerId}/buy`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    transferFeed: (limit = 100) => request(`/marketplace/transfer-feed?limit=${limit}`)
  },
  manager: {
    me: (token) => request('/manager/me', { headers: buildHeaders(token, false) }),
    directory: (token, { seasonId = null, mode = null, limit = 220 } = {}) =>
      request(
        `/manager/directory?${[
          seasonId ? `seasonId=${seasonId}` : null,
          mode ? `mode=${encodeURIComponent(mode)}` : null,
          `limit=${limit}`
        ].filter(Boolean).join('&')}`,
        { headers: buildHeaders(token, false) }
      ),
    profile: (token, managerId) =>
      request(`/manager/profile/${managerId}`, { headers: buildHeaders(token, false) }),
    offers: (token) => request('/manager/offers', { headers: buildHeaders(token, false) }),
    acceptOffer: (token, offerId) =>
      request(`/manager/offers/${offerId}/accept`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    declineOffer: (token, offerId) =>
      request(`/manager/offers/${offerId}/decline`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    apply: (token, franchiseId) =>
      request('/manager/apply', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ franchiseId })
      }),
    retire: (token) =>
      request('/manager/retire', {
        method: 'POST',
        headers: buildHeaders(token)
      })
  },
  admin: {
    users: (token) =>
      request('/admin/users', { headers: buildHeaders(token, false) }),
    resetGame: (token) =>
      request('/admin/reset-game', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ confirm: 'RESET' })
      }),
    rebalanceSeason: (token, { seasonId, dryRun } = {}) =>
      request('/admin/rebalance-season', {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ seasonId: seasonId || undefined, dryRun: !!dryRun })
      })
  },
  financials: {
    summary: (token) => request('/financials/summary', { headers: buildHeaders(token, false) }),
    transactions: (token) => request('/financials/transactions', { headers: buildHeaders(token, false) }),
    valuations: (token) => request('/financials/valuations', { headers: buildHeaders(token, false) })
  }
};

export function getApiBaseUrl() {
  return API_BASE_URL;
}
