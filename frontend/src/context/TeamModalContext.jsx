import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import TeamSquadModal from '../components/TeamSquadModal';

const TeamModalContext = createContext({
  openTeamModal: () => {},
  closeTeamModal: () => {},
  currentTeam: null
});

export function TeamModalProvider({ children }) {
  const [currentTeam, setCurrentTeam] = useState(null);

  const openTeamModal = useCallback((team) => {
    const franchiseId = Number(team?.franchiseId || team?.id || 0);
    if (!franchiseId) {
      return;
    }

    setCurrentTeam({
      franchiseId,
      name: team?.name || '',
      city: team?.city || '',
      country: team?.country || ''
    });
  }, []);

  const closeTeamModal = useCallback(() => {
    setCurrentTeam(null);
  }, []);

  const value = useMemo(
    () => ({
      openTeamModal,
      closeTeamModal,
      currentTeam
    }),
    [openTeamModal, closeTeamModal, currentTeam]
  );

  return (
    <TeamModalContext.Provider value={value}>
      {children}
      <TeamSquadModal
        open={Boolean(currentTeam?.franchiseId)}
        franchiseId={Number(currentTeam?.franchiseId || 0)}
        seed={currentTeam}
        onClose={closeTeamModal}
      />
    </TeamModalContext.Provider>
  );
}

export function useTeamModal() {
  return useContext(TeamModalContext);
}
