import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";

type ChromeIdentity = {
  getRedirectURL: (path?: string) => string;
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string>;
};

const getChromeIdentity = (): ChromeIdentity | null => {
  const identity = (globalThis as { chrome?: { identity?: ChromeIdentity } }).chrome?.identity;

  if (!identity?.getRedirectURL || !identity?.launchWebAuthFlow) {
    return null;
  }

  return identity;
};

export const getGoogleOAuthRedirectUrl = (): string | null => {
  const identity = getChromeIdentity();

  return identity ? identity.getRedirectURL("auth/callback") : null;
};

export const getOAuthRedirectUrl = (): string => {
  const extensionRedirectUrl = getGoogleOAuthRedirectUrl();

  if (extensionRedirectUrl) {
    return extensionRedirectUrl;
  }

  const redirectUrl = new URL(window.location.href);
  redirectUrl.hash = "";
  redirectUrl.search = "";

  return redirectUrl.toString();
};

export const clearOAuthParamsFromUrl = (targetHash = "overview"): void => {
  const url = new URL(window.location.href);

  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");

  const nextSearch = url.searchParams.toString();

  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}#${targetHash}`,
  );
};

const parseOAuthCallback = (
  callbackUrl: string,
): { code?: string; error?: string; errorDescription?: string } => {
  const url = new URL(callbackUrl);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));

  return {
    code: url.searchParams.get("code") ?? hashParams.get("code") ?? undefined,
    error: url.searchParams.get("error") ?? hashParams.get("error") ?? undefined,
    errorDescription:
      url.searchParams.get("error_description") ?? hashParams.get("error_description") ?? undefined,
  };
};

const isUserCancelledOAuth = (message: string): boolean =>
  /did not approve|canceled|cancelled|user cancel/i.test(message);

export const isGoogleOAuthAvailable = (): boolean => getChromeIdentity() !== null;

export const completeOAuthCallbackIfPresent = async (): Promise<Session | null> => {
  const { code, error, errorDescription } = parseOAuthCallback(window.location.href);

  if (error) {
    clearOAuthParamsFromUrl("auth/login");
    throw new Error(errorDescription ?? error);
  }

  if (!code) {
    return null;
  }

  const { data: sessionData, error: exchangeError } = await getSupabaseClient().auth.exchangeCodeForSession(code);

  if (exchangeError) {
    throw exchangeError;
  }

  if (!sessionData.session) {
    throw new Error("Session introuvable apres echange du code OAuth.");
  }

  clearOAuthParamsFromUrl("overview");

  return sessionData.session;
};

export const signInWithGoogleOAuth = async (): Promise<Session> => {
  const identity = getChromeIdentity();

  if (!identity) {
    throw new Error("Connexion Google disponible uniquement dans l'extension Chrome.");
  }

  const redirectTo = identity.getRedirectURL("auth/callback");
  const supabase = getSupabaseClient();

  const { data, error: startError } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (startError) {
    throw startError;
  }

  if (!data.url) {
    throw new Error("Supabase n'a pas renvoye d'URL OAuth Google.");
  }

  let callbackUrl: string;

  try {
    callbackUrl = await identity.launchWebAuthFlow({
      url: data.url,
      interactive: true,
    });
  } catch (launchError) {
    const message = launchError instanceof Error ? launchError.message : String(launchError);

    if (isUserCancelledOAuth(message)) {
      throw new Error("Connexion Google annulee.");
    }

    throw new Error(
      `Fenetre OAuth Google impossible. Verifie que ${redirectTo} est autorise dans Supabase Auth > URL Configuration.`,
    );
  }

  const { code, error, errorDescription } = parseOAuthCallback(callbackUrl);

  if (error) {
    throw new Error(errorDescription ?? error);
  }

  if (!code) {
    throw new Error(
      `Code OAuth Google manquant. Ajoute ${redirectTo} dans Supabase Auth > URL Configuration > Redirect URLs.`,
    );
  }

  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    throw exchangeError;
  }

  if (!sessionData.session) {
    throw new Error("Session Google introuvable apres echange du code.");
  }

  clearOAuthParamsFromUrl("overview");

  return sessionData.session;
};