import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, LogIn, PlugZap, UserPlus, Users } from "lucide-react";
import {
  completeAdminOnboarding,
  completeMemberOnboarding,
  fetchCurrentUserProfile,
  type AppUserProfile,
} from "../../services/api";
import { setApiAuthSession } from "../../services/api/client";
import { getSupabaseClient, isSupabaseAuthConfigured } from "../../services/supabase";
import heroImageUrl from "../../assets/landing-hero.png";
import "./AuthLanding.css";

type AuthLandingProps = {
  error?: string | null;
  onAuthenticated: (profile: AppUserProfile) => void;
};

type OnboardingGateProps = {
  error?: string | null;
  fullName: string;
  onCompleted: (profile: AppUserProfile) => void;
  onSignOut: () => void;
};

const passwordMinLength = 8;

const getOAuthRedirectUrl = (): string => {
  const redirectUrl = new URL(window.location.href);

  redirectUrl.hash = "";
  redirectUrl.search = "";

  if (redirectUrl.pathname.includes("*")) {
    redirectUrl.pathname = "/";
  }

  return redirectUrl.toString();
};

export const AuthLanding = ({ error, onAuthenticated }: AuthLandingProps) => {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
          redirectTo: getOAuthRedirectUrl(),
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
        setMode("login");
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
    <main className="jarvis-auth-page">
      <img className="jarvis-auth-hero-image" src={heroImageUrl} alt="" aria-hidden="true" />
      <section className="jarvis-auth-copy" aria-labelledby="jarvis-auth-title">
        <span className="jarvis-auth-eyebrow">Jarvis for revenue teams</span>
        <h1 id="jarvis-auth-title">Le cockpit HubSpot pour chaque sales.</h1>
        <p>
          L'admin connecte le CRM, Jarvis rattache les owners, et chaque commercial retrouve sa queue priorisee
          avec ses propres deals.
        </p>
        <div className="jarvis-auth-actions">
          <button type="button" onClick={() => setMode("signup")} className={mode === "signup" ? "active" : ""}>
            <UserPlus size={18} />
            Sign up
          </button>
          <button type="button" onClick={() => setMode("login")} className={mode === "login" ? "active" : ""}>
            <LogIn size={18} />
            Connexion
          </button>
        </div>
      </section>

      <section className="jarvis-auth-panel" aria-label="Authentification Jarvis">
        <div className="jarvis-auth-panel-head">
          <div className="jarvis-auth-icon">
            {mode === "signup" ? <Building2 size={20} /> : <Users size={20} />}
          </div>
          <div>
            <span>{mode === "signup" ? "Admin HubSpot" : "Workspace equipe"}</span>
            <h2>{mode === "signup" ? "Creer l'organisation" : "Se connecter"}</h2>
          </div>
        </div>

        <button className="jarvis-google-button" type="button" onClick={handleGoogleSignIn} disabled={isSubmitting}>
          <span aria-hidden="true">G</span>
          Continuer avec Google
        </button>

        <div className="jarvis-auth-separator">
          <span>ou</span>
        </div>

        <form className="jarvis-auth-form" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <>
              <label>
                Nom complet
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
              </label>
              <label>
                Organisation
                <input
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  autoComplete="organization"
                  required
                />
              </label>
            </>
          ) : null}
          <label>
            Email professionnel
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
            />
          </label>

          {error || localError ? <p className="jarvis-auth-error">{localError ?? error}</p> : null}
          {notice ? <p className="jarvis-auth-notice">{notice}</p> : null}

          <button className="jarvis-auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Traitement..." : mode === "signup" ? "Demarrer avec HubSpot" : "Entrer dans Jarvis"}
            <ArrowRight size={18} />
          </button>
        </form>
      </section>
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
    <main className="jarvis-auth-page jarvis-auth-page-compact">
      <img className="jarvis-auth-hero-image" src={heroImageUrl} alt="" aria-hidden="true" />
      <section className="jarvis-auth-copy" aria-labelledby="jarvis-onboarding-title">
        <span className="jarvis-auth-eyebrow">Onboarding Jarvis</span>
        <h1 id="jarvis-onboarding-title">Rattache ton compte a une organisation.</h1>
        <p>
          Les sales rejoignent automatiquement leur workspace quand leur email correspond a un owner HubSpot
          connecte. Un admin peut aussi creer une nouvelle organisation.
        </p>
        <button type="button" className="jarvis-auth-secondary" onClick={onSignOut}>
          Changer de compte
        </button>
      </section>

      <section className="jarvis-auth-panel" aria-label="Onboarding Jarvis">
        <div className="jarvis-auth-panel-head">
          <div className="jarvis-auth-icon">
            <PlugZap size={20} />
          </div>
          <div>
            <span>Compte connecte</span>
            <h2>{fullName}</h2>
          </div>
        </div>

        <button className="jarvis-auth-submit" type="button" onClick={handleMemberJoin} disabled={Boolean(isSubmitting)}>
          {isSubmitting === "member" ? "Recherche HubSpot..." : "Rejoindre mon equipe HubSpot"}
          <ArrowRight size={18} />
        </button>

        <form className="jarvis-auth-form jarvis-auth-divider" onSubmit={handleAdminCreate}>
          <label>
            Nouvelle organisation
            <input
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              autoComplete="organization"
              required
            />
          </label>
          {localError ? <p className="jarvis-auth-error">{localError}</p> : null}
          <button className="jarvis-auth-secondary" type="submit" disabled={Boolean(isSubmitting)}>
            {isSubmitting === "admin" ? "Creation..." : "Creer comme admin"}
          </button>
        </form>
      </section>
    </main>
  );
};
