import type { AppUserProfile } from "../services/api";

const AUTH_PROFILE_CACHE_KEY = "jarvis:authProfile";
const AUTH_PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedAuthProfilePayload = {
  storedAt: number;
  profile: AppUserProfile;
};

export const readPersistedSupabaseUserId = (): string | null => {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) {
        continue;
      }

      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
        user?: { id?: string };
      } | null;
      const userId = parsed?.user?.id;

      if (typeof userId === "string" && userId.length > 0) {
        return userId;
      }
    }
  } catch {
    // Ignore malformed Supabase auth storage payloads.
  }

  return null;
};

export const readCachedAuthProfile = (): AppUserProfile | null => {
  try {
    const rawCache = window.localStorage.getItem(AUTH_PROFILE_CACHE_KEY);

    if (!rawCache) {
      return null;
    }

    const parsed = JSON.parse(rawCache) as Partial<CachedAuthProfilePayload>;

    if (
      typeof parsed.storedAt !== "number" ||
      Date.now() - parsed.storedAt > AUTH_PROFILE_CACHE_TTL_MS ||
      !parsed.profile ||
      typeof parsed.profile.authUserId !== "string"
    ) {
      return null;
    }

    const sessionUserId = readPersistedSupabaseUserId();

    if (!sessionUserId || parsed.profile.authUserId !== sessionUserId) {
      return null;
    }

    return parsed.profile;
  } catch {
    return null;
  }
};

export const writeCachedAuthProfile = (profile: AppUserProfile): void => {
  try {
    const payload: CachedAuthProfilePayload = {
      storedAt: Date.now(),
      profile,
    };

    window.localStorage.setItem(AUTH_PROFILE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage can be unavailable in restricted extension contexts.
  }
};

export const clearCachedAuthProfile = (): void => {
  try {
    window.localStorage.removeItem(AUTH_PROFILE_CACHE_KEY);
  } catch {
    // Ignore storage failures during sign-out cleanup.
  }
};