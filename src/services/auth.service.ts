import { apiFetch } from './api.service';

export interface AuthUser {
  id: number | string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  city: string | null;
  document: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
  refreshToken: string;
}

const SESSION_KEY = 'concertix_auth_session';
const LOCAL_USERS_KEY = 'concertix_local_auth_users';
const FORCE_FALLBACK_HOSTS = new Set(['frontend-ed-2.vercel.app']);

interface LocalAuthUserRecord extends AuthUser {
  password: string;
}

const isNetworkFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|fetch failed/i.test(error.message);
};

const shouldForceLocalAuthFallback = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!import.meta.env.PROD) return false;
  return FORCE_FALLBACK_HOSTS.has(window.location.hostname);
};

const readLocalUsers = (): LocalAuthUserRecord[] => {
  const raw = localStorage.getItem(LOCAL_USERS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as LocalAuthUserRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalUsers = (users: LocalAuthUserRecord[]) => {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
};

const toSafeUser = (user: LocalAuthUserRecord): AuthUser => {
  const { password: _password, ...safeUser } = user;
  return safeUser;
};

const buildLocalSession = (user: LocalAuthUserRecord): AuthSession => {
  const seed = `${Date.now()}-${user.email}`;
  return {
    user: toSafeUser(user),
    token: `local-token-${seed}`,
    refreshToken: `local-refresh-${seed}`,
  };
};

const loginLocalFallback = (payload: { email: string; password: string }): AuthSession => {
  const normalizedEmail = payload.email.trim().toLowerCase();
  const user = readLocalUsers().find((entry) => entry.email.toLowerCase() === normalizedEmail);

  if (!user || user.password !== payload.password) {
    throw new Error('Credenciales invalidas');
  }

  return buildLocalSession(user);
};

const registerLocalFallback = (payload: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): AuthSession => {
  const users = readLocalUsers();
  const normalizedEmail = payload.email.trim().toLowerCase();

  if (users.some((entry) => entry.email.toLowerCase() === normalizedEmail)) {
    throw new Error('El email ya esta registrado');
  }

  const now = new Date().toISOString();
  const newUser: LocalAuthUserRecord = {
    id: `local-${Date.now()}`,
    firstName: payload.firstName.trim(),
    lastName: payload.lastName.trim(),
    email: normalizedEmail,
    role: 'USER',
    phone: null,
    birthDate: null,
    gender: null,
    city: null,
    document: null,
    bio: null,
    avatarUrl: null,
    createdAt: now,
    password: payload.password,
  };

  users.push(newUser);
  writeLocalUsers(users);

  return buildLocalSession(newUser);
};

const persistSession = (session: AuthSession) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

const getSession = (): AuthSession | null => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
};

const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

const getUserFullName = (user: AuthUser): string =>
  `${user.firstName} ${user.lastName}`.trim();

const login = async (payload: { email: string; password: string }): Promise<AuthSession> => {
  if (shouldForceLocalAuthFallback()) {
    return loginLocalFallback(payload);
  }

  try {
    const res = await apiFetch<{ accessToken: string; refreshToken: string; user: AuthUser }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email: payload.email, password: payload.password }) }
    );
    return { user: res.user, token: res.accessToken, refreshToken: res.refreshToken };
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    return loginLocalFallback(payload);
  }
};

const register = async (payload: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<AuthSession> => {
  if (shouldForceLocalAuthFallback()) {
    return registerLocalFallback(payload);
  }

  try {
    const res = await apiFetch<{ accessToken: string; refreshToken: string; user: AuthUser }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(payload) }
    );
    return { user: res.user, token: res.accessToken, refreshToken: res.refreshToken };
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    return registerLocalFallback(payload);
  }
};

export const authService = {
  login,
  register,
  persistSession,
  getSession,
  clearSession,
  getUserFullName,
};
