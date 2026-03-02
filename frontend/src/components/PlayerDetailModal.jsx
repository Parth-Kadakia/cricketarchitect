import { useEffect } from 'react';

export default function PlayerDetailModal({ open, playerDetail, selectedPlayer, onClose, StatBar, OverallRing, RolePill }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;

  const player = playerDetail?.player || selectedPlayer;
  const title = player ? `${player.first_name} ${player.last_name}` : 'Player Detail';

  return (
    <div className="sq-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="sq-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sq-modal-header">
          <h3>{title}</h3>
          <button type="button" className="sq-modal-close" onClick={onClose}>×</button>
        </header>

        {!playerDetail?.player ? (
          <div className="sq-loading" style={{ padding: '2rem' }}>
            <div className="sq-spinner" /><span>Loading player detail...</span>
          </div>
        ) : (
          <div className="sq-modal-body">
            {/* Top profile section */}
            <div className="sq-modal-profile">
              <OverallRing value={playerDetail.player.overall} />
              <div className="sq-modal-profile-info">
                <h2 className="sq-modal-player-name">{playerDetail.player.first_name} {playerDetail.player.last_name}</h2>
                <div className="sq-modal-profile-tags">
                  <RolePill role={playerDetail.player.role} />
                  <span className="sq-modal-tag">{playerDetail.player.squad_status?.replace('_', ' ')}</span>
                  {playerDetail.player.starting_xi && <span className="sq-modal-tag sq-modal-tag--xi">XI #{playerDetail.player.lineup_slot || '-'}</span>}
                </div>
              </div>
            </div>

            {/* Career stats cards */}
            <div className="sq-modal-career-grid">
              <div className="sq-modal-career-card">
                <span className="sq-modal-career-val">{playerDetail.player.career_matches}</span>
                <span className="sq-modal-career-label">Matches</span>
              </div>
              <div className="sq-modal-career-card">
                <span className="sq-modal-career-val">{playerDetail.player.career_runs}</span>
                <span className="sq-modal-career-label">Runs</span>
              </div>
              <div className="sq-modal-career-card">
                <span className="sq-modal-career-val">{playerDetail.player.career_wickets}</span>
                <span className="sq-modal-career-label">Wickets</span>
              </div>
              <div className="sq-modal-career-card">
                <span className="sq-modal-career-val">{playerDetail.player.career_player_of_match}</span>
                <span className="sq-modal-career-label">POTM</span>
              </div>
            </div>

            {/* Skill bars */}
            <div className="sq-modal-skills">
              <h4>Skills Breakdown</h4>
              <div className="sq-modal-skills-grid">
                <StatBar label="Batting" value={playerDetail.player.batting} />
                <StatBar label="Bowling" value={playerDetail.player.bowling} />
                <StatBar label="Fielding" value={playerDetail.player.fielding} />
                <StatBar label="Fitness" value={playerDetail.player.fitness} />
              </div>
            </div>

            {/* Recent matches */}
            <div className="sq-modal-matches">
              <h4>Recent Matches</h4>
              {(!playerDetail.recentMatches || playerDetail.recentMatches.length === 0) ? (
                <div className="sq-empty">No match stats yet.</div>
              ) : (
                <div className="sq-modal-match-list">
                  {playerDetail.recentMatches.map((m, i) => (
                    <div key={i} className="sq-modal-match-row">
                      <div className="sq-modal-match-info">
                        <span className="sq-modal-match-season">S{m.season_id}</span>
                        <span className="sq-modal-match-round">R{m.round_no}</span>
                        <span className="sq-modal-match-stage">{m.stage}</span>
                      </div>
                      <div className="sq-modal-match-stats">
                        <span className="sq-modal-match-stat">{m.batting_runs}<small> runs ({m.batting_balls}b)</small></span>
                        <span className="sq-modal-match-stat">{m.bowling_wickets}<small> wkts</small></span>
                        <span className="sq-modal-match-rating" style={{ color: Number(m.player_rating) >= 7 ? 'var(--leaf)' : Number(m.player_rating) >= 5 ? 'var(--accent)' : 'var(--danger)' }}>
                          {Number(m.player_rating).toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

