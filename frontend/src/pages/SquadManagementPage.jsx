import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import Panel from '../components/Panel';
import PlayerCard from '../components/PlayerCard';
import PlayerDetailModal from '../components/PlayerDetailModal';
import SimpleTable from '../components/SimpleTable';
import { useAuth } from '../context/AuthContext';

export default function SquadManagementPage() {
  const { token } = useAuth();

  const [squadData, setSquadData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetail, setPlayerDetail] = useState(null);
  const [selectedLineup, setSelectedLineup] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setError('');

    try {
      const [squadResponse, lineupResponse] = await Promise.all([api.squad.get(token), api.squad.lineup(token)]);
      setSquadData(squadResponse);
      setSelectedLineup((lineupResponse.lineup || []).map((player) => Number(player.id)));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    async function loadPlayer() {
      if (!selectedPlayer?.id) {
        setPlayerDetail(null);
        return;
      }

      try {
        const detail = await api.squad.playerDetail(token, selectedPlayer.id);
        setPlayerDetail(detail);
      } catch (detailError) {
        setPlayerDetail(null);
      }
    }

    loadPlayer();
  }, [selectedPlayer, token]);

  async function saveLineup() {
    try {
      await api.squad.setLineup(token, selectedLineup.slice(0, 11));
      await load();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function promote(playerId) {
    try {
      await api.squad.promote(token, playerId);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function release(playerId) {
    try {
      await api.squad.release(token, playerId);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  function toggleLineup(playerId) {
    setSelectedLineup((current) => {
      const id = Number(playerId);
      if (current.includes(id)) {
        return current.filter((value) => value !== id);
      }

      if (current.length >= 11) {
        return current;
      }

      return [...current, id];
    });
  }

  const grouped = useMemo(() => {
    if (!squadData?.players) {
      return { main: [], youth: [], other: [] };
    }

    return {
      main: squadData.players.filter((player) => player.squad_status === 'MAIN_SQUAD'),
      youth: squadData.players.filter((player) => player.squad_status === 'YOUTH'),
      other: squadData.players.filter((player) => !['MAIN_SQUAD', 'YOUTH'].includes(player.squad_status))
    };
  }, [squadData]);

  if (loading) {
    return <div className="loading-state">Loading player cards...</div>;
  }

  return (
    <div className="page-grid">
      {error ? <p className="error-text full-width">{error}</p> : null}

      <Panel
        title="Lineup Builder"
        actions={
          <button className="button" type="button" onClick={saveLineup} disabled={selectedLineup.length !== 11}>
            Save XI ({selectedLineup.length}/11)
          </button>
        }
        className="full-width"
      >
        <p className="muted">You must select exactly 11 players. Best overall does not always mean best match form.</p>
        <div className="lineup-grid">
          {[...grouped.main, ...grouped.youth].map((player) => (
            <button
              key={player.id}
              type="button"
              className={`lineup-chip ${selectedLineup.includes(Number(player.id)) ? 'active' : ''}`}
              onClick={() => toggleLineup(player.id)}
            >
              {player.first_name} {player.last_name}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Main Squad Player Cards" className="full-width">
        <p className="muted">Click any player card to open full profile, recent matches, and growth history.</p>
        <div className="player-card-grid">
          {grouped.main.map((player) => (
            <PlayerCard key={player.id} player={player} onOpen={setSelectedPlayer} />
          ))}
        </div>
      </Panel>

      <Panel title="Youth Player Cards" className="full-width">
        <p className="muted">Click any player card to inspect detailed stats before promotion or release decisions.</p>
        <div className="player-card-grid">
          {grouped.youth.map((player) => (
            <PlayerCard key={player.id} player={player} onOpen={setSelectedPlayer} />
          ))}
        </div>
      </Panel>

      <Panel title="Player Actions">
        <SimpleTable
          columns={[
            { key: 'name', label: 'Player', render: (_, row) => `${row.first_name} ${row.last_name}` },
            { key: 'squad_status', label: 'Status' },
            {
              key: 'actions',
              label: 'Actions',
              render: (_, row) => (
                <div className="row-actions">
                  {row.squad_status === 'YOUTH' ? (
                    <button type="button" onClick={() => promote(row.id)}>
                      Promote
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setSelectedPlayer(row)}>
                    Open Card
                  </button>
                  <button type="button" onClick={() => release(row.id)}>
                    Release
                  </button>
                </div>
              )
            }
          ]}
          rows={[...grouped.youth, ...grouped.other].slice(0, 30)}
        />
      </Panel>

      <PlayerDetailModal
        open={Boolean(selectedPlayer)}
        selectedPlayer={selectedPlayer}
        playerDetail={playerDetail}
        onClose={() => {
          setSelectedPlayer(null);
          setPlayerDetail(null);
        }}
      />
    </div>
  );
}
