import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import DashboardPage from './pages/DashboardPage';
import FinancialsPage from './pages/FinancialsPage';
import FixturesResultsPage from './pages/FixturesResultsPage';
import FranchiseMarketplacePage from './pages/FranchiseMarketplacePage';
import LeagueTablePage from './pages/LeagueTablePage';
import LoginPage from './pages/LoginPage';
import ManagersPage from './pages/ManagersPage';
import MatchCenterPage from './pages/MatchCenterPage';
import StatbookPage from './pages/StatbookPage';
import SquadManagementPage from './pages/SquadManagementPage';
import TransferMarketPage from './pages/TransferMarketPage';
import StatsPage from './pages/StatsPage';
import TrophyRoomPage from './pages/TrophyRoomPage';
import YouthAcademyPage from './pages/YouthAcademyPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="squad" element={<SquadManagementPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="managers" element={<ManagersPage />} />
        <Route path="statbook" element={<StatbookPage />} />
        <Route path="youth" element={<YouthAcademyPage />} />
        <Route path="league" element={<LeagueTablePage />} />
        <Route path="fixtures" element={<FixturesResultsPage />} />
        <Route path="matches/:matchId" element={<MatchCenterPage />} />
        <Route path="transfer-market" element={<TransferMarketPage />} />
        <Route path="marketplace" element={<FranchiseMarketplacePage />} />
        <Route path="financials" element={<FinancialsPage />} />
        <Route path="trophies" element={<TrophyRoomPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
