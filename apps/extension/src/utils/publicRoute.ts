export type PublicRoute = "landing" | "auth";
export type AuthMode = "signup" | "login";

export type PublicRouteState = {
  route: PublicRoute;
  authMode: AuthMode;
};

const parseAuthMode = (hash: string): AuthMode => {
  if (hash === "auth/login" || hash.endsWith("/login")) {
    return "login";
  }

  if (hash === "auth/signup" || hash.endsWith("/signup")) {
    return "signup";
  }

  return "signup";
};

export const parsePublicRoute = (): PublicRouteState => {
  const hash = window.location.hash.replace("#", "").trim();

  if (hash === "auth" || hash.startsWith("auth/")) {
    return {
      route: "auth",
      authMode: parseAuthMode(hash),
    };
  }

  return {
    route: "landing",
    authMode: "signup",
  };
};

export const navigateToLanding = (): void => {
  if (window.location.hash !== "#landing") {
    window.location.hash = "landing";
  }
};

export const navigateToAuth = (mode: AuthMode = "signup"): void => {
  const nextHash = `#auth/${mode}`;

  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
};

export const getAuthRedirectUrl = (): string => {
  const redirectUrl = new URL(window.location.href);
  const { authMode } = parsePublicRoute();

  redirectUrl.hash = `auth/${authMode}`;
  redirectUrl.search = "";

  if (redirectUrl.pathname.includes("*")) {
    redirectUrl.pathname = "/";
  }

  return redirectUrl.toString();
};