import {
  CheckCircleIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LogInIcon,
  LogOutIcon,
  ShieldOffIcon,
} from "lucide-react";
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createPasskeyAuthClient,
  isPasskeySupported,
  PasskeyAuthError,
  type AuthSession,
  type PasskeyAuthClient,
} from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export type PasskeyAuthLanguage = "en" | "zh";

export interface PasskeyAuthCopy {
  title: string;
  description: string;
  displayNameLabel: string;
  displayNamePlaceholder: string;
  register: string;
  registering: string;
  loginDescription: string;
  login: string;
  loggingIn: string;
  loading: string;
  successTitle: string;
  registerSuccess: string;
  loginSuccess: string;
  signedInAs: string;
  signOut: string;
  signingOut: string;
  unsupportedTitle: string;
  unsupportedDescription: string;
  errorTitle: string;
  cancelled: string;
  signedOut: string;
}

export const PASSKEY_AUTH_COPY: Record<
  PasskeyAuthLanguage,
  PasskeyAuthCopy
> = {
  en: {
    title: "Passkey access",
    description:
      "Create a passkey for this device or sign in with a passkey you already have.",
    displayNameLabel: "Display name",
    displayNamePlaceholder: "How others will see you",
    register: "Create passkey",
    registering: "Creating passkey…",
    loginDescription:
      "No username is needed. Choose an available passkey when your device asks.",
    login: "Sign in with a passkey",
    loggingIn: "Waiting for passkey…",
    loading: "Checking your session…",
    successTitle: "Signed in",
    registerSuccess: "Your passkey is ready and you are signed in.",
    loginSuccess: "You are signed in with your passkey.",
    signedInAs: "Signed in as",
    signOut: "Sign out",
    signingOut: "Signing out…",
    unsupportedTitle: "Passkeys unavailable",
    unsupportedDescription:
      "This browser or device does not support the WebAuthn features required for passkeys.",
    errorTitle: "Passkey request failed",
    cancelled: "The passkey request was cancelled. You can try again.",
    signedOut: "You are signed out.",
  },
  zh: {
    title: "通行密钥登录",
    description: "为此设备创建通行密钥，或使用已有通行密钥登录。",
    displayNameLabel: "显示名称",
    displayNamePlaceholder: "其他人看到的名称",
    register: "创建通行密钥",
    registering: "正在创建通行密钥…",
    loginDescription: "无需输入用户名，请在设备提示时选择可用的通行密钥。",
    login: "使用通行密钥登录",
    loggingIn: "正在等待通行密钥…",
    loading: "正在检查会话…",
    successTitle: "已登录",
    registerSuccess: "通行密钥已创建，你已登录。",
    loginSuccess: "已使用通行密钥登录。",
    signedInAs: "当前用户",
    signOut: "退出登录",
    signingOut: "正在退出…",
    unsupportedTitle: "无法使用通行密钥",
    unsupportedDescription: "此浏览器或设备不支持通行密钥所需的 WebAuthn 功能。",
    errorTitle: "通行密钥请求失败",
    cancelled: "通行密钥请求已取消，你可以重试。",
    signedOut: "你已退出登录。",
  },
};

type AuthStatus =
  | "anonymous"
  | "error"
  | "loading"
  | "logging-in"
  | "registering"
  | "signing-out"
  | "success"
  | "unsupported";

export interface PasskeyAuthProps {
  className?: string;
  client?: PasskeyAuthClient;
  copy?: Partial<PasskeyAuthCopy>;
  language?: PasskeyAuthLanguage;
  onSessionChange?: (session: AuthSession | null) => void;
}

function getSessionDisplayName(session: AuthSession): string | null {
  const displayName = session.user?.displayName;
  return typeof displayName === "string" && displayName.trim()
    ? displayName
    : null;
}

export function PasskeyAuth({
  className,
  client,
  copy,
  language = "en",
  onSessionChange,
}: PasskeyAuthProps) {
  const t = useMemo(
    () => ({ ...PASSKEY_AUTH_COPY[language], ...copy }),
    [copy, language],
  );
  const authClient = useMemo(
    () => client ?? createPasskeyAuthClient(),
    [client],
  );
  const titleId = useId();
  const displayNameId = useId();
  const [displayName, setDisplayName] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [message, setMessage] = useState(t.loading);

  const publishSession = useCallback(
    (nextSession: AuthSession | null) => {
      setSession(nextSession);
      onSessionChange?.(nextSession);
    },
    [onSessionChange],
  );

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setMessage(t.loading);

    void authClient
      .getSession()
      .then((currentSession) => {
        if (!active) return;
        publishSession(currentSession);
        if (currentSession) {
          setStatus("success");
          setMessage(t.loginSuccess);
        } else if (!isPasskeySupported() && !client) {
          setStatus("unsupported");
          setMessage(t.unsupportedDescription);
        } else {
          setStatus("anonymous");
          setMessage("");
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : t.errorTitle);
      });

    return () => {
      active = false;
    };
  }, [authClient, client, publishSession, t]);

  const showError = (error: unknown) => {
    const nextMessage =
      error instanceof PasskeyAuthError && error.code === "cancelled"
        ? t.cancelled
        : error instanceof Error
          ? error.message
          : t.errorTitle;
    setStatus(
      error instanceof PasskeyAuthError && error.code === "unsupported"
        ? "unsupported"
        : "error",
    );
    setMessage(nextMessage);
  };

  const handleRegister = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("registering");
    setMessage(t.registering);
    try {
      const nextSession = await authClient.register(displayName);
      publishSession(nextSession);
      setStatus("success");
      setMessage(t.registerSuccess);
    } catch (error) {
      showError(error);
    }
  };

  const handleLogin = async () => {
    setStatus("logging-in");
    setMessage(t.loggingIn);
    try {
      const nextSession = await authClient.login();
      publishSession(nextSession);
      setStatus("success");
      setMessage(t.loginSuccess);
    } catch (error) {
      showError(error);
    }
  };

  const handleSignOut = async () => {
    setStatus("signing-out");
    setMessage(t.signingOut);
    try {
      await authClient.signOut();
      publishSession(null);
      setStatus("anonymous");
      setMessage(t.signedOut);
    } catch (error) {
      showError(error);
    }
  };

  const busy =
    status === "loading" ||
    status === "logging-in" ||
    status === "registering" ||
    status === "signing-out";

  return (
    <section
      className={cn("flex w-full max-w-md flex-col gap-6", className)}
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <header className="flex flex-col gap-2">
        <h2 id={titleId} className="text-2xl font-medium">
          {t.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.description}</p>
      </header>

      <div aria-live="polite" aria-atomic="true">
        {status === "loading" ||
        status === "logging-in" ||
        status === "registering" ||
        status === "signing-out" ? (
          <Alert>
            <LoaderCircleIcon className="motion-safe:animate-spin" />
            <AlertTitle>{message}</AlertTitle>
          </Alert>
        ) : status === "unsupported" ? (
          <Alert variant="destructive">
            <ShieldOffIcon />
            <AlertTitle>{t.unsupportedTitle}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : status === "error" ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>{t.errorTitle}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : status === "success" && session ? (
          <Alert>
            <CheckCircleIcon />
            <AlertTitle>{t.successTitle}</AlertTitle>
            <AlertDescription>
              {getSessionDisplayName(session)
                ? `${t.signedInAs}: ${getSessionDisplayName(session)}`
                : message}
            </AlertDescription>
          </Alert>
        ) : message ? (
          <Alert>
            <CheckCircleIcon />
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {session ? (
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={busy}
          onClick={handleSignOut}
        >
          {status === "signing-out" ? (
            <LoaderCircleIcon
              data-icon="inline-start"
              className="motion-safe:animate-spin"
            />
          ) : (
            <LogOutIcon data-icon="inline-start" />
          )}
          {status === "signing-out" ? t.signingOut : t.signOut}
        </Button>
      ) : status !== "unsupported" && status !== "loading" ? (
        <FieldGroup>
          <form className="flex flex-col gap-3" onSubmit={handleRegister}>
            <Field>
              <FieldLabel htmlFor={displayNameId}>
                {t.displayNameLabel}
              </FieldLabel>
              <Input
                id={displayNameId}
                name="displayName"
                type="text"
                autoComplete="name"
                maxLength={80}
                required
                className="h-11"
                value={displayName}
                placeholder={t.displayNamePlaceholder}
                disabled={busy}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <Button type="submit" size="lg" disabled={busy}>
              {status === "registering" ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="motion-safe:animate-spin"
                />
              ) : (
                <KeyRoundIcon data-icon="inline-start" />
              )}
              {status === "registering" ? t.registering : t.register}
            </Button>
          </form>

          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t.loginDescription}
            </p>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={busy}
              onClick={handleLogin}
            >
              {status === "logging-in" ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="motion-safe:animate-spin"
                />
              ) : (
                <LogInIcon data-icon="inline-start" />
              )}
              {status === "logging-in" ? t.loggingIn : t.login}
            </Button>
          </div>
        </FieldGroup>
      ) : null}
    </section>
  );
}
