import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, LogIn, UserPlus } from "lucide-react";
import {
  completeAdminOnboarding,
  completeMemberOnboarding,
  fetchCurrentUserProfile,
  type AppUserProfile,
} from "../../services/api";
import { setApiAuthSession } from "../../services/api/client";
import { getSupabaseClient, isSupabaseAuthConfigured } from "../../services/supabase";
import {
  getAuthRedirectUrl,
  navigateToAuth,
  navigateToLanding,
  type AuthMode,
} from "../../utils/publicRoute";
import { GoogleLogo } from "./GoogleLogo";
import "../styles/auth-landing.css";

type AuthPageProps = {
  error?: string | null;
  initialMode?: AuthMode;
  onAuthenticated: (profile: AppUserProfile) => void;
};

type OnboardingGateProps = {
  error?: string | null;
  fullName: string;
  onCompleted: (profile: AppUserProfile) => void;
  onSignOut: () => void;
};

const passwordMinLength = 8;

export const AuthPage = ({ error, initialMode = "signup", onAuthenticated }: AuthPageProps) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    navigateToAuth(nextMode);
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    setNotice(null);

    if (!isSupabaseAuthConfigured) {
      setLocalError("Ajoute VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY ou VITE_SUPABASE_ANON_KEY cote extension.");
      return;
    }

    try {
      setIsSubmitting(true);
      const { error: googleError } = await getSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getAuthRedirectUrl(),
          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (googleError) {
        throw googleError;
      }
    } catch (signInError) {
      setLocalError(signInError instanceof Error ? signInError.message : "Connexion Google impossible.");
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setNotice(null);

    if (!isSupabaseAuthConfigured) {
      setLocalError("Ajoute VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY ou VITE_SUPABASE_ANON_KEY cote extension.");
      return;
    }

    if (password.length < passwordMinLength) {
      setLocalError(`Le mot de passe doit contenir au moins ${passwordMinLength} caracteres.`);
      return;
    }

    try {
      setIsSubmitting(true);

      if (mode === "login") {
        const { data, error: signInError } = await getSupabaseClient().auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          throw signInError;
        }

        if (!data.session) {
          setNotice("Verifie ton email pour finaliser la connexion.");
          return;
        }

        setApiAuthSession(data.session);
        const profile = await completeMemberOnboarding().catch(() => fetchCurrentUserProfile());
        onAuthenticated(profile);
        return;
      }

      if (!organizationName.trim()) {
        setLocalError("Le nom de l'organisation est obligatoire pour creer un workspace admin.");
        return;
      }

      const { data, error: signUpError } = await getSupabaseClient().auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (!data.session) {
        setNotice("Compte cree. Confirme ton email, puis connecte-toi pour finir l'onboarding.");
        handleModeChange("login");
        return;
      }

      setApiAuthSession(data.session);
      const profile = await completeAdminOnboarding({
        organizationName: organizationName.trim(),
        fullName: fullName.trim() || email,
      });
      onAuthenticated(profile);
    } catch (submitError) {
      setLocalError(submitError instanceof Error ? submitError.message : "Authentification impossible.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="jv-auth-page" aria-label="Connexion Jarvis">
      <div className="jv-auth-shell">
        <button className="jv-auth-back" type="button" onClick={navigateToLanding} disabled={isSubmitting}>
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.5} />
          Retour
        </button>

        <section className="jv-auth-panel" aria-label="Authentification Jarvis">
          <header className="jv-auth-panel-head">
            <span className="jv-auth-panel-kicker">
              {mode === "signup" ? "Admin HubSpot" : "Workspace equipe"}
            </span>
            <h2>{mode === "signup" ? "Creer l'organisation" : "Se connecter"}</h2>
          </header>

          <div className="jv-filter-pills" role="group" aria-label="Mode d'authentification">
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => handleModeChange("signup")}
              disabled={isSubmitting}
            >
              <UserPlus aria-hidden="true" size={14} strokeWidth={1.5} />
              Inscription
            </button>
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => handleModeChange("login")}
              disabled={isSubmitting}
            >
              <LogIn aria-hidden="true" size={14} strokeWidth={1.5} />
              Connexion
            </button>
          </div>

          <button className="jv-btn-ghost" type="button" onClick={handleGoogleSignIn} disabled={isSubmitting}>
            <GoogleLogo size={18} />
            Continuer avec Google
          </button>

          <div className="jv-auth-separator">
            <span>ou</span>
          </div>

          <form className="jv-auth-form" onSubmit={handleSubmit}>
            {mode === "signup" ? (
              <>
                <div className="jv-auth-field">
                  <label htmlFor="jv-auth-full-name">Nom complet</label>
                  <input
                    id="jv-auth-full-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete="name"
                  />
                </div>
                <div className="jv-auth-field">
                  <label htmlFor="jv-auth-organization">Organisation</label>
                  <input
                    id="jv-auth-organization"
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                    autoComplete="organization"
                    required
                  />
                </div>
              </>
            ) : null}
            <div className="jv-auth-field">
              <label htmlFor="jv-auth-email">Email professionnel</label>
              <input
                id="jv-auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="jv-auth-field">
              <label htmlFor="jv-auth-password">Mot de passe</label>
              <input
                id="jv-auth-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
              />
            </div>

            {error || localError ? (
              <p className="jv-banner jv-banner-error" role="alert">
                {localError ?? error}
              </p>
            ) : null}
            {notice ? <p className="jv-banner jv-banner-success">{notice}</p> : null}

            <button className="jv-btn-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Traitement..." : mode === "signup" ? "Demarrer avec HubSpot" : "Entrer dans Jarvis"}
              <ArrowRight aria-hidden="true" size={15} strokeWidth={1.5} />
            </button>
          </form>
        </section>
      </div>
    </main>
  );
};

export const OnboardingGate = ({ error, fullName, onCompleted, onSignOut }: OnboardingGateProps) => {
  const [organizationName, setOrganizationName] = useState("");
  const [localError, setLocalError] = useState<string | null>(error ?? null);
  const [isSubmitting, setIsSubmitting] = useState<"admin" | "member" | null>(null);

  const handleMemberJoin = async () => {
    setLocalError(null);
    setIsSubmitting("member");

    try {
      onCompleted(await completeMemberOnboarding());
    } catch (joinError) {
      setLocalError(joinError instanceof Error ? joinError.message : "Rattachement HubSpot impossible.");
    } finally {
      setIsSubmitting(null);
    }
  };

  const handleAdminCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    setIsSubmitting("admin");

    try {
      onCompleted(
        await completeAdminOnboarding({
          organizationName,
          fullName,
        }),
      );
    } catch (createError) {
      setLocalError(createError instanceof Error ? createError.message : "Creation d'organisation impossible.");
    } finally {
      setIsSubmitting(null);
    }
  };

  return (
    <main className="jv-auth-page" aria-label="Onboarding Jarvis">
      <div className="jv-auth-shell">
        <section className="jv-auth-panel" aria-label="Onboarding Jarvis">
          <header className="jv-auth-panel-head">
            <span className="jv-auth-panel-kicker">Compte connecte</span>
            <h2>{fullName}</h2>
            <p className="jv-auth-onboarding-copy">
              Rattache ton compte a une organisation HubSpot pour acceder a ta queue.
            </p>
          </header>

          <button
            className="jv-btn-primary"
            type="button"
            onClick={handleMemberJoin}
            disabled={Boolean(isSubmitting)}
          >
            {isSubmitting === "member" ? "Recherche HubSpot..." : "Rejoindre mon equipe HubSpot"}
            <ArrowRight aria-hidden="true" size={15} strokeWidth={1.5} />
          </button>

          <form className="jv-auth-form jv-auth-divider" onSubmit={handleAdminCreate}>
            <div className="jv-auth-field">
              <label htmlFor="jv-onboarding-organization">Nouvelle organisation</label>
              <input
                id="jv-onboarding-organization"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                autoComplete="organization"
                required
              />
            </div>
            {localError ? (
              <p className="jv-banner jv-banner-error" role="alert">
                {localError}
              </p>
            ) : null}
            <button className="jv-btn-ghost" type="submit" disabled={Boolean(isSubmitting)}>
              {isSubmitting === "admin" ? "Creation..." : "Creer comme admin"}
            </button>
          </form>

          <button className="jv-btn-ghost" type="button" onClick={onSignOut} disabled={Boolean(isSubmitting)}>
            Changer de compte
          </button>
        </section>
      </div>
    </main>
  );
};