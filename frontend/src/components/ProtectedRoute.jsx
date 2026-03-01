import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { loading, token } = useAuth();

  if (loading) {
    return <div className="loading-state">Loading...</div>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
