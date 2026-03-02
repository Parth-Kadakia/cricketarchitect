export default function PlayerCard({ player, onOpen, StatBar, OverallRing, RolePill }) {
  return (
    <button className="sq-card" type="button" onClick={() => onOpen(player)}>
      <div className="sq-card-top">
        <OverallRing value={player.overall} />
        <div className="sq-card-identity">
          <h4 className="sq-card-name">{player.first_name} {player.last_name}</h4>
          <RolePill role={player.role} />
          {player.starting_xi && <span className="sq-card-xi">XI #{player.lineup_slot || '-'}</span>}
        </div>
      </div>
      <div className="sq-card-bars">
        <StatBar label="Batting" value={player.batting} />
        <StatBar label="Bowling" value={player.bowling} />
        <StatBar label="Fielding" value={player.fielding} />
        <StatBar label="Fitness" value={player.fitness} />
      </div>
      <div className="sq-card-footer">
        <span className="sq-card-status">{player.squad_status.replace('_', ' ')}</span>
        <span className="sq-card-potential">Potential {player.potential}</span>
      </div>
    </button>
  );
}
