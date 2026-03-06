import { useTeamModal } from '../context/TeamModalContext';

export default function TeamNameButton({
  franchiseId,
  name,
  city,
  country,
  className = '',
  disabled = false,
  children
}) {
  const { openTeamModal } = useTeamModal();
  const label = children || name || 'Team';
  const id = Number(franchiseId || 0);

  if (!id || disabled) {
    return <span className={className}>{label}</span>;
  }

  return (
    <button
      type="button"
      className={`team-link-button ${className}`.trim()}
      title={`Open ${name || 'team'} squad`}
      onClick={(event) => {
        event.stopPropagation();
        openTeamModal({ franchiseId: id, name, city, country });
      }}
    >
      {label}
    </button>
  );
}
