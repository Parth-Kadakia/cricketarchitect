const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

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
      })
  },
  cities: {
    list: (availableOnly = false, q = '', limit = 600) =>
      request(`/cities?available=${availableOnly}&q=${encodeURIComponent(q)}&limit=${limit}`)
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
    simulateLive: (token, matchId, ballDelayMs = 120) =>
      request(`/league/matches/${matchId}/simulate-live`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ ballDelayMs })
      }),
    simulateInstant: (token, matchId) =>
      request(`/league/matches/${matchId}/simulate-instant`, {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    simulateNextRound: (token) =>
      request('/league/simulate-next-round', {
        method: 'POST',
        headers: buildHeaders(token)
      }),
    simulateSeason: (token) =>
      request('/league/simulate-season', {
        method: 'POST',
        headers: buildHeaders(token)
      })
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
  financials: {
    summary: (token) => request('/financials/summary', { headers: buildHeaders(token, false) }),
    transactions: (token) => request('/financials/transactions', { headers: buildHeaders(token, false) }),
    valuations: (token) => request('/financials/valuations', { headers: buildHeaders(token, false) })
  }
};

export function getApiBaseUrl() {
  return API_BASE_URL;
}
