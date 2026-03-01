export default function PlayerCard({ player, onOpen }) {
  return (
    <button className="player-card" type="button" onClick={() => onOpen(player)}>
      <header>
        <h4>
          {player.first_name} {player.last_name}
        </h4>
        <span>{player.role}</span>
      </header>
      <p>
        Overall <strong>{Number(player.overall || 0).toFixed(1)}</strong>
      </p>
      <div className="player-attr-grid">
        <span>Bat {player.batting}</span>
        <span>Bowl {player.bowling}</span>
        <span>Field {player.fielding}</span>
        <span>Fit {player.fitness}</span>
      </div>
      <footer>
        <small>{player.squad_status.replace('_', ' ')}</small>
        <small>Potential {player.potential}</small>
      </footer>
    </button>
  );
}
