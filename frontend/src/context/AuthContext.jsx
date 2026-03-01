import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);
const TOKEN_KEY = 'global_t20_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [franchise, setFranchise] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const me = await api.auth.me(token);
        setUser(me.user);
        setFranchise(me.franchise);
      } catch (error) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setFranchise(null);
      } finally {
        setLoading(false);
      }
    }

    bootstrap();
  }, [token]);

  async function login(email, password) {
    const response = await api.auth.login({ email, password });
    localStorage.setItem(TOKEN_KEY, response.token);
    setToken(response.token);
    setUser(response.user);

    const me = await api.auth.me(response.token);
    setFranchise(me.franchise);

    return response.user;
  }

  async function register(payload) {
    const response = await api.auth.register(payload);
    localStorage.setItem(TOKEN_KEY, response.token);
    setToken(response.token);
    setUser(response.user);
    setFranchise(null);
    return response.user;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setFranchise(null);
  }

  async function refreshProfile() {
    if (!token) {
      return;
    }

    const me = await api.auth.me(token);
    setUser(me.user);
    setFranchise(me.franchise);
  }

  const value = useMemo(
    () => ({
      token,
      user,
      franchise,
      loading,
      login,
      register,
      logout,
      refreshProfile,
      setFranchise
    }),
    [token, user, franchise, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
