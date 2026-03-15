export default function PlayerCard({ player, onOpen, StatBar, OverallRing, RolePill }) {
  return (
    <button className="sq-card sq-player-card" type="button" onClick={() => onOpen(player)}>
      <div className="sq-player-card-head">
        <OverallRing value={player.overall} />
        <div className="sq-player-card-main">
          <div className="sq-player-card-topline">
            <RolePill role={player.role} />
            {player.starting_xi && <span className="sq-card-xi">XI #{player.lineup_slot || '-'}</span>}
          </div>
          <h4 className="sq-card-name">{player.first_name} {player.last_name}</h4>
          <div className="sq-player-card-subline">
            <span>{player.country_origin || player.country || 'Unknown Origin'}</span>
            <span>Age {player.age ?? '-'}</span>
          </div>
        </div>
      </div>
      <div className="sq-player-card-keystats">
        <div className="sq-player-card-kpi">
          <span>Form</span>
          <strong>{Number(player.form || 0).toFixed(0)}</strong>
        </div>
        <div className="sq-player-card-kpi">
          <span>Morale</span>
          <strong>{Number(player.morale || 0).toFixed(0)}</strong>
        </div>
        <div className="sq-player-card-kpi">
          <span>Potential</span>
          <strong>{Number(player.potential || 0).toFixed(0)}</strong>
        </div>
      </div>
      <div className="sq-card-bars">
        <StatBar label="Batting" value={player.batting} />
        <StatBar label="Bowling" value={player.bowling} />
        <StatBar label="Fielding" value={player.fielding} />
        <StatBar label="Fitness" value={player.fitness} />
      </div>
      <div className="sq-card-meta">
        <span>{player.batsman_hand || '-'}</span>
        <span>{player.batsman_type || '-'}</span>
        <span>{player.bowler_style || 'No bowling style'}</span>
      </div>
      <div className="sq-card-footer">
        <span className="sq-card-status">{player.squad_status.replace('_', ' ')}</span>
        <span className="sq-card-potential">Open Full Card</span>
      </div>
    </button>
  );
}
