import { useEffect } from 'react';
import SimpleTable from './SimpleTable';

export default function PlayerDetailModal({ open, playerDetail, selectedPlayer, onClose }) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const player = playerDetail?.player || selectedPlayer;
  const title = player ? `${player.first_name} ${player.last_name}` : 'Player Detail';

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="button ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {!playerDetail?.player ? (
          <div className="loading-state">Loading player detail...</div>
        ) : (
          <>
            <div className="inline-metrics">
              <p>
                Overall: <strong>{Number(playerDetail.player.overall).toFixed(1)}</strong>
              </p>
              <p>
                Career: <strong>{playerDetail.player.career_matches} matches</strong>
              </p>
              <p>
                Runs/Wkts: <strong>{playerDetail.player.career_runs}/{playerDetail.player.career_wickets}</strong>
              </p>
              <p>
                POTM: <strong>{playerDetail.player.career_player_of_match}</strong>
              </p>
            </div>

            <SimpleTable
              columns={[
                { key: 'season_id', label: 'Season' },
                { key: 'round_no', label: 'Round' },
                { key: 'stage', label: 'Stage' },
                { key: 'batting_runs', label: 'Runs' },
                { key: 'batting_balls', label: 'Balls' },
                { key: 'bowling_wickets', label: 'Wkts' },
                { key: 'player_rating', label: 'Rating', render: (value) => Number(value).toFixed(2) }
              ]}
              rows={playerDetail.recentMatches || []}
              emptyMessage="No match stats yet."
            />
          </>
        )}
      </section>
    </div>
  );
}

