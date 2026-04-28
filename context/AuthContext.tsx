import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi, User } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setupUser: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'vsinger_auth_token_v2';
const USER_KEY = 'vsinger_auth_user_v2';

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  const persistSession = useCallback((userData: User, newToken: string): void => {
    setUser(userData);
    setToken(newToken);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  }, []);

  useEffect(() => {
    async function initAuth(): Promise<void> {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);

      if (!storedToken) {
        localStorage.removeItem('acestep_token');
        localStorage.removeItem('acestep_user');
        setIsLoading(false);
        return;
      }

      try {
        if (storedUser) {
          setUser(JSON.parse(storedUser));
          setToken(storedToken);
        }
        const { user: userData } = await authApi.me(storedToken);
        setUser(userData);
        setToken(storedToken);
        localStorage.setItem(USER_KEY, JSON.stringify(userData));
      } catch (error: unknown) {
        console.warn('Stored login expired or invalid:', error);
        setToken(null);
        setUser(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } finally {
        setIsLoading(false);
      }
    }

    initAuth();
  }, []);

  const setupUser = useCallback(async (username: string, password: string): Promise<void> => {
    const { user: userData, token: newToken } = await authApi.setup(username, password);
    persistSession(userData, newToken);
  }, [persistSession]);

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const { user: userData, token: newToken } = await authApi.login(username, password);
    persistSession(userData, newToken);
  }, [persistSession]);

  const register = useCallback(async (username: string, password: string): Promise<void> => {
    const { user: userData, token: newToken } = await authApi.register(username, password);
    persistSession(userData, newToken);
  }, [persistSession]);

  const updateUsername = useCallback(async (username: string): Promise<void> => {
    if (!token) throw new Error('Not authenticated');
    const { user: userData, token: newToken } = await authApi.updateUsername(username, token);
    setUser(userData);
    setToken(newToken);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  }, [token]);

  const logout = useCallback((): void => {
    authApi.logout().catch(() => {});
    setUser(null);
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const refreshUser = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const { user: userData } = await authApi.me(token);
      setUser(userData);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  }, [token]);

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    isAuthenticated,
    setupUser,
    login,
    register,
    updateUsername,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
