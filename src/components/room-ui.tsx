import {
  memo,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BotIcon,
  CableIcon,
  CheckIcon,
  CircleIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
  GitForkIcon,
  HourglassIcon,
  InfoIcon,
  LanguagesIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  MoonIcon,
  RotateCcwIcon,
  ScaleIcon,
  SunIcon,
  UserIcon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";

import type {
  GameState,
  MatchMode,
  Move,
  PopulationStats,
  QueueSide,
  RoomView,
  Theme,
} from "@/lib/session";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  ConversationCue,
  DanmakuLayer,
  GameActions,
  GameChat,
  ScoreSummary,
} from "@/components/game-social";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { writeToClipboard } from "@/lib/clipboard";
import {
  createBoard,
  formatGoCoordinate,
  type Board as GoBoardData,
  type Point,
} from "@/lib/go";
import type { Copy, Language } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WebMCPStatus } from "@/lib/webmcp";
import "@/board.css";

const JOIN_TOOL_EXAMPLE = 'join_go_match({ "modelId": "your-model-id" })';

function createPreviewBoard(): GoBoardData {
  const board = createBoard(9);
  const stones: Array<[number, number, "black" | "white"]> = [
    [2, 2, "black"],
    [6, 2, "white"],
    [4, 4, "black"],
    [3, 5, "white"],
    [5, 5, "black"],
    [2, 6, "white"],
    [6, 6, "black"],
  ];
  for (const [x, y, stone] of stones) board[y][x] = stone;
  return board;
}

const previewBoard = createPreviewBoard();

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function formatLastMove(point: Point | undefined, boardSize: number): string {
  return point ? formatGoCoordinate(point, boardSize) : "—";
}

function nextBoardFocusPoint(
  key: string,
  ctrlKey: boolean,
  point: Point,
  size: number,
): Point | null {
  switch (key) {
    case "ArrowLeft":
      return { ...point, x: Math.max(0, point.x - 1) };
    case "ArrowRight":
      return { ...point, x: Math.min(size - 1, point.x + 1) };
    case "ArrowUp":
      return { ...point, y: Math.max(0, point.y - 1) };
    case "ArrowDown":
      return { ...point, y: Math.min(size - 1, point.y + 1) };
    case "Home":
      return ctrlKey ? { x: 0, y: 0 } : { ...point, x: 0 };
    case "End":
      return ctrlKey ? { x: size - 1, y: size - 1 } : { ...point, x: size - 1 };
    default:
      return null;
  }
}

function PageTransition({
  children,
  className,
  state,
}: {
  children: ReactNode;
  className: string;
  state?: string;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <m.section
      className={className}
      data-state={state}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={{ type: "spring", bounce: 0, duration: 0.38 }}
    >
      {children}
    </m.section>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const reducedMotion = useReducedMotion();
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <m.strong
        key={value}
        className="font-heading text-4xl font-medium tabular-nums"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
        transition={{ type: "spring", bounce: 0, duration: 0.3 }}
      >
        {value}
      </m.strong>
    </AnimatePresence>
  );
}

type InviteCopyState = "idle" | "copying" | "copied" | "failed";

function AgentInviteButton({
  t,
  variant = "outline",
  className,
}: {
  t: Copy;
  variant?: "default" | "outline";
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [copyState, setCopyState] = useState<InviteCopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleCopy = async () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    setCopyState("copying");
    const copied = await writeToClipboard(
      t.agentInvitePrompt(window.location.origin),
    );

    setCopyState(copied ? "copied" : "failed");
    resetTimer.current = window.setTimeout(() => setCopyState("idle"), 2800);
  };

  const label =
    copyState === "copying"
      ? t.copyAgentInviteCopying
      : copyState === "copied"
        ? t.copyAgentInviteCopied
        : copyState === "failed"
          ? t.copyAgentInviteFailed
          : t.copyAgentInvite;

  return (
    <span className={cn("inline-flex", className)}>
      <Button
        type="button"
        size="lg"
        variant={variant}
        className="w-full"
        data-copy-state={copyState}
        aria-busy={copyState === "copying"}
        onClick={handleCopy}
        disabled={copyState === "copying"}
      >
        <span className="flex items-center justify-center gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <m.span
              key={copyState}
              className="inline-flex"
              aria-hidden="true"
              initial={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 4, scale: 0.98 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: -3, scale: 0.98 }
              }
              transition={
                reducedMotion
                  ? { duration: 0.1 }
                  : { type: "spring", bounce: 0, duration: 0.22 }
              }
            >
              {copyState === "copying" ? (
                <LoaderCircleIcon className="motion-safe:animate-spin" />
              ) : copyState === "copied" ? (
                <CheckIcon />
              ) : (
                <CopyIcon />
              )}
            </m.span>
          </AnimatePresence>
          <span>{label}</span>
        </span>
      </Button>
      <span className="sr-only" aria-live="polite">
        {copyState === "copied" || copyState === "failed" ? label : ""}
      </span>
    </span>
  );
}

function WebMCPStatusBadge({
  t,
  status,
  showContext = false,
}: {
  t: Copy;
  status: WebMCPStatus;
  showContext?: boolean;
}) {
  const connected = status === "available";
  const bridge = status === "bridge";
  const checking = status === "checking";

  return (
    <Badge
      variant={connected || bridge ? "secondary" : "outline"}
      role="status"
      aria-live="polite"
    >
      {checking ? (
        <LoaderCircleIcon className="motion-safe:animate-spin" />
      ) : connected ? (
        <WifiIcon />
      ) : bridge ? (
        <CableIcon />
      ) : (
        <WifiOffIcon />
      )}
      {showContext && <span className="hidden sm:inline">WebMCP</span>}
      <span className={showContext ? "hidden sm:inline" : undefined}>
        {checking
          ? t.webmcpChecking
          : connected
            ? t.connected
            : bridge
              ? t.webmcpBridgeReady
              : t.offline}
      </span>
    </Badge>
  );
}

function WebMCPReadiness({ t, status }: { t: Copy; status: WebMCPStatus }) {
  const reducedMotion = useReducedMotion();
  const connected = status === "available";
  const bridge = status === "bridge";
  const checking = status === "checking";
  const title = checking
    ? t.webmcpChecking
    : connected
      ? t.webmcpSessionReady
      : bridge
        ? t.webmcpBridgeReady
        : t.webmcpSessionUnavailable;
  const description = checking
    ? t.webmcpCheckingDescription
    : connected
      ? t.webmcpSessionReadyDescription
      : bridge
        ? t.webmcpBridgeDescription
        : t.webmcpSessionUnavailableDescription;

  return (
    <m.div
      key={status}
      className="flex max-w-xl items-start gap-3"
      data-webmcp-status={status}
      role="status"
      aria-live="polite"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reducedMotion
          ? { duration: 0.1 }
          : { type: "spring", bounce: 0, duration: 0.24 }
      }
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
          connected || bridge
            ? "bg-secondary text-secondary-foreground"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {checking ? (
          <LoaderCircleIcon className="size-4 motion-safe:animate-spin" />
        ) : connected ? (
          <CheckIcon className="size-4" />
        ) : bridge ? (
          <CableIcon className="size-4" />
        ) : (
          <WifiOffIcon className="size-4" />
        )}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {!checking && !connected && !bridge && (
          <a
            className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
            href="https://developer.chrome.com/docs/ai/webmcp"
            target="_blank"
            rel="noreferrer"
          >
            {t.webmcpSetupAction}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
      </div>
    </m.div>
  );
}

export function Header({
  t,
  language,
  theme,
  webmcpStatus,
  onLanguageToggle,
  onThemeToggle,
  onReturnHome,
  showWebMcpStatus = true,
}: {
  t: Copy;
  language: Language;
  theme: Theme;
  webmcpStatus: WebMCPStatus;
  onLanguageToggle: () => void;
  onThemeToggle: () => void;
  onReturnHome: () => void;
  showWebMcpStatus?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          size="lg"
          className="px-0"
          onClick={onReturnHome}
          aria-label="go.lmm.best home"
        >
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-foreground transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)] group-hover/button:-translate-y-0.5" />
              <span className="size-2.5 rounded-full border bg-card transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)] group-hover/button:scale-110" />
              <span className="size-2.5 rounded-full bg-primary transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)] group-hover/button:translate-y-0.5" />
            </span>
            <span className="font-heading text-xl font-semibold tracking-tight">
              go.lmm.best
            </span>
          </span>
        </Button>
        <div className="flex items-center gap-2">
          {showWebMcpStatus && (
            <WebMCPStatusBadge t={t} status={webmcpStatus} showContext />
          )}
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onThemeToggle}
            aria-label={theme === "light" ? t.switchToDark : t.switchToLight}
            title={theme === "light" ? t.switchToDark : t.switchToLight}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <m.span
                key={theme}
                className="inline-flex"
                initial={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, rotate: -18, scale: 0.8 }
                }
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, rotate: 18, scale: 0.8 }
                }
                transition={{ type: "spring", bounce: 0, duration: 0.22 }}
              >
                {theme === "light" ? <MoonIcon /> : <SunIcon />}
              </m.span>
            </AnimatePresence>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onLanguageToggle}
            aria-label={t.languageSwitchLabel}
          >
            <LanguagesIcon data-icon="inline-start" />
            {language === "zh" ? "EN" : "中"}
          </Button>
        </div>
      </div>
    </header>
  );
}

function PopulationOverview({
  t,
  stats,
  compact = false,
}: {
  t: Copy;
  stats: PopulationStats;
  compact?: boolean;
}) {
  const waitingMessage =
    stats.waitingHumans > 0
      ? t.waitingHumansCount(stats.waitingHumans)
      : stats.waitingAi > 0
        ? t.waitingAiCount(stats.waitingAi)
        : t.queuesBalanced;

  return (
    <section className={cn("flex flex-col gap-5", compact ? "py-2" : "py-4")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium">{t.livePlayersTitle}</h2>
          {!compact && (
            <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
              {t.livePlayersDetail}
            </p>
          )}
        </div>
        <Badge variant="outline">FIFO</Badge>
      </div>
      <Separator />
      <div className="grid grid-cols-3 gap-6">
        <div className="flex flex-col gap-1">
          <AnimatedNumber value={stats.humanPlayers} />
          <span className="text-sm text-muted-foreground">
            {t.humanPlayers}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <AnimatedNumber value={stats.aiPlayers} />
          <span className="text-sm text-muted-foreground">{t.aiPlayers}</span>
        </div>
        <div className="flex flex-col gap-1">
          <AnimatedNumber value={stats.activeGames} />
          <span className="text-sm text-muted-foreground">{t.activeGames}</span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {waitingMessage}
      </p>
    </section>
  );
}

export function Lobby({
  t,
  webmcpStatus,
  population,
  onStartMatch,
  onPreviewBoard,
}: {
  t: Copy;
  webmcpStatus: WebMCPStatus;
  population: PopulationStats;
  onStartMatch: () => void;
  onPreviewBoard: () => void;
}) {
  return (
    <PageTransition
      state="idle"
      className="grid gap-10 py-10 sm:gap-12 sm:py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(28rem,0.7fr)] lg:items-center lg:gap-x-20 lg:gap-y-10 lg:py-20"
    >
      <div className="order-1 flex flex-col gap-8 lg:gap-9">
        <div className="flex max-w-2xl flex-col gap-4 sm:gap-5">
          <h1 className="text-4xl font-medium leading-none tracking-tight sm:text-5xl lg:text-6xl">
            {t.heroTitle}
          </h1>
          <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            {t.heroDescription}
          </p>
        </div>
        <PopulationOverview t={t} stats={population} />
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Button size="lg" onClick={onStartMatch}>
              {t.startMatch}
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
            <AgentInviteButton t={t} />
            <Button variant="ghost" size="lg" onClick={onPreviewBoard}>
              {t.viewDemo}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
          <p className="flex max-w-xl items-start gap-2 text-sm leading-6 text-muted-foreground">
            <BotIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            {t.copyAgentInviteHint}
          </p>
        </div>
      </div>
      <BoardPreview t={t} className="order-2 lg:row-span-2" />
      <div className="order-3 lg:col-start-1">
        <WebMCPReadiness t={t} status={webmcpStatus} />
      </div>
      <HowItWorks t={t} />
    </PageTransition>
  );
}

function HowItWorksSteps({ t }: { t: Copy }) {
  const reducedMotion = useReducedMotion();
  const steps = [
    { number: "01", title: t.stepOne, detail: t.stepOneDetail, icon: UserIcon },
    { number: "02", title: t.stepTwo, detail: t.stepTwoDetail, icon: BotIcon },
    {
      number: "03",
      title: t.stepThree,
      detail: t.stepThreeDetail,
      icon: CircleIcon,
    },
  ];
  return (
    <ol className="grid gap-8 md:grid-cols-3">
      {steps.map(({ number, title, detail, icon: StepIcon }, index) => (
        <m.li
          key={number}
          className="flex flex-col gap-3"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{
            type: "spring",
            bounce: 0,
            duration: reducedMotion ? 0.12 : 0.35,
            delay: reducedMotion ? 0 : index * 0.06,
          }}
        >
          <span className="flex items-center gap-3">
            <span className="font-heading text-2xl font-medium tabular-nums text-primary">
              {number}
            </span>
            <StepIcon className="size-4 text-muted-foreground" />
          </span>
          <div>
            <h3 className="text-lg font-medium">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {detail}
            </p>
          </div>
        </m.li>
      ))}
    </ol>
  );
}

function HowItWorks({ t }: { t: Copy }) {
  return (
    <section
      className="order-4 flex flex-col gap-4 border-t pt-8 lg:col-span-2 lg:gap-6 lg:pt-10"
      id="how-it-works"
      aria-labelledby="steps-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="steps-title" className="text-2xl font-medium">
          {t.matchStepsTitle}
        </h2>
        <span className="hidden text-sm text-muted-foreground lg:inline">
          {t.matchMode}
        </span>
      </div>
      <details className="group/how lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-medium text-primary marker:content-none [&::-webkit-details-marker]:hidden">
          {t.navHow}
          <ArrowRightIcon className="size-3.5 transition-transform group-open/how:rotate-90" />
        </summary>
        <div className="pt-5">
          <HowItWorksSteps t={t} />
        </div>
      </details>
      <div className="hidden lg:block">
        <HowItWorksSteps t={t} />
      </div>
    </section>
  );
}

function BoardPreview({ t, className }: { t: Copy; className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <m.section
      className={cn("flex flex-col gap-5", className)}
      whileHover={reducedMotion ? undefined : { y: -4 }}
      transition={{ type: "spring", bounce: 0, duration: 0.35 }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium">{t.boardPreview}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t.boardPreviewHint}
          </p>
        </div>
        <Badge variant="secondary">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          {t.live}
        </Badge>
      </div>
      <Board
        board={previewBoard}
        interactive={false}
        lastMove={{ x: 4, y: 4 }}
        t={t}
      />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-foreground" />
          {t.human}
        </span>
        <span className="text-sm tabular-nums">vs</span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full border bg-card" />
          {t.ai}
        </span>
      </div>
    </m.section>
  );
}

export function Searching({
  t,
  elapsed,
  queueSide,
  aiModelId,
  webmcpStatus,
  population,
  showBoardPreview,
  onCancel,
  onPreviewBoard,
  onClosePreview,
  onJoinWaitingAi,
}: {
  t: Copy;
  elapsed: number;
  queueSide: Exclude<QueueSide, null>;
  aiModelId: string | null;
  webmcpStatus: WebMCPStatus;
  population: PopulationStats;
  showBoardPreview: boolean;
  onCancel: () => void;
  onPreviewBoard: () => void;
  onClosePreview: () => void;
  onJoinWaitingAi: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const aiWaiting = queueSide === "ai";
  return (
    <PageTransition
      state="searching"
      className="mx-auto flex max-w-5xl flex-col gap-8 py-8 sm:gap-12 sm:py-14 lg:py-20"
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center sm:gap-4">
        <Badge variant="secondary">
          <LoaderCircleIcon className="motion-safe:animate-spin" />
          {t.waiting}
        </Badge>
        <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">
          {aiWaiting ? t.waitingForHumanTitle : t.waitingTitle}
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          {aiWaiting ? t.waitingForHumanDescription : t.waitingDescription}
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-12">
        <div className="flex flex-col gap-6 sm:gap-8">
          <PopulationOverview t={t} stats={population} compact />
          <Separator />
          <section className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <span className="text-sm text-muted-foreground">
                  {t.queuePosition}
                </span>
                <strong className="mt-1 block font-heading text-3xl font-medium tabular-nums">
                  {t.queuePositionValue}
                </strong>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">
                  {t.elapsed}
                </span>
                <strong className="mt-1 block font-heading text-3xl font-medium tabular-nums">
                  {formatElapsed(elapsed)}
                </strong>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onCancel}>
                {t.cancelMatch}
                <XIcon data-icon="inline-end" />
              </Button>
              {!aiWaiting && (
                <Button variant="ghost" onClick={onPreviewBoard}>
                  {t.viewDemo}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              )}
            </div>
          </section>
        </div>
        <Separator className="lg:hidden" />
        <Separator orientation="vertical" className="hidden lg:block" />
        {aiWaiting ? (
          <section className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-medium">{t.matchedWith}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t.matchFoundDescription}
              </p>
            </div>
            <Item>
              <ItemMedia variant="icon">
                <BotIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{aiModelId ?? "WebMCP AI"}</ItemTitle>
                <ItemDescription>{t.aiWaitingStatus}</ItemDescription>
              </ItemContent>
            </Item>
            <Button size="lg" onClick={onJoinWaitingAi}>
              {t.joinWaitingAi}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <WebMCPReadiness t={t} status={webmcpStatus} />
          </section>
        ) : showBoardPreview ? (
          <div className="flex flex-col gap-5">
            <BoardPreview t={t} />
            <Button variant="outline" onClick={onClosePreview}>
              {t.closeBoardPreview}
              <XIcon data-icon="inline-end" />
            </Button>
            <WebMCPReadiness t={t} status={webmcpStatus} />
          </div>
        ) : (
          <section className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-medium">{t.aiCallHint}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t.toolsDescription}
                </p>
              </div>
              <WebMCPStatusBadge t={t} status={webmcpStatus} />
            </div>
            <div className="flex flex-col gap-2">
              <AgentInviteButton t={t} variant="default" className="w-full" />
              <p className="text-sm leading-6 text-muted-foreground">
                {t.copyAgentInviteHint}
              </p>
            </div>
            <ItemGroup className="gap-2">
              {[
                t.agentJoinStepOne,
                t.agentJoinStepTwo,
                t.agentJoinStepThree,
              ].map((step, index) => (
                <m.div
                  key={step}
                  initial={
                    reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }
                  }
                  animate={{ opacity: 1, x: 0 }}
                  transition={
                    reducedMotion
                      ? { duration: 0.1 }
                      : {
                          type: "spring",
                          bounce: 0,
                          duration: 0.3,
                          delay: index * 0.06,
                        }
                  }
                >
                  <Item size="sm">
                    <ItemMedia>
                      <Badge variant="outline">{index + 1}</Badge>
                    </ItemMedia>
                    <ItemContent>
                      <ItemDescription>{step}</ItemDescription>
                    </ItemContent>
                  </Item>
                </m.div>
              ))}
            </ItemGroup>
            <pre className="code-sample rounded-r-lg">
              <code>{JOIN_TOOL_EXAMPLE}</code>
            </pre>
            <WebMCPReadiness t={t} status={webmcpStatus} />
          </section>
        )}
      </div>
    </PageTransition>
  );
}

export function GameRoom({
  t,
  language,
  game,
  view,
  matchMode,
  webmcpStatus,
  lastToolCall,
  danmakuEnabled,
  onDanmakuToggle,
  onMove,
  onPass,
  onResign,
  onRequestScoring,
  onWithdrawScoring,
  onSendMessage,
  onReturnLobby,
  onNewGame,
  audience = "player",
  shareControls,
  spectatorStatus = "live",
  spectatorViewerCount = 0,
}: {
  t: Copy;
  language: Language;
  game: GameState;
  view: RoomView;
  matchMode: MatchMode;
  webmcpStatus: WebMCPStatus;
  lastToolCall: string | null;
  danmakuEnabled: boolean;
  onDanmakuToggle: (enabled: boolean) => void;
  onMove: (point: Point) => void;
  onPass: () => void;
  onResign: () => void;
  onRequestScoring: () => void;
  onWithdrawScoring: () => void;
  onSendMessage: (message: string) => boolean;
  onReturnLobby: () => void;
  onNewGame: () => void;
  audience?: "player" | "spectator";
  shareControls?: ReactNode;
  spectatorStatus?: "live" | "reconnecting" | "offline" | "ended";
  spectatorViewerCount?: number;
}) {
  const spectating = audience === "spectator";
  const isFinished = view === "finished";
  const scoringPending = game.scoring.status === "pending";
  const isHumanTurnState =
    !isFinished && !scoringPending && game.turn === game.humanColor;
  const isHumanTurn = !spectating && isHumanTurnState;
  const finishedText =
    game.endReason === "human-resigned"
      ? t.finishedByResignYou
      : game.endReason === "ai-resigned"
        ? t.finishedByResignAi
        : game.endReason === "scored"
          ? t.finishedByScore
          : t.finishedByPass;
  const spectatorStatusLabel =
    spectatorStatus === "reconnecting"
      ? t.spectatorReconnecting
      : spectatorStatus === "offline"
        ? t.spectatorOffline
        : spectatorStatus === "ended" || isFinished
          ? t.spectatorEnded
          : t.spectatorLive;
  const statusText = spectating
    ? isFinished
      ? finishedText
      : scoringPending
        ? t.scoringPending
        : isHumanTurnState
          ? t.spectatorHumanTurn
          : t.spectatorAiTurn
    : isFinished
      ? finishedText
      : scoringPending
        ? t.scoringPending
        : game.lastScoringDecision === "rejected"
          ? t.scoringRejected
          : isHumanTurn
            ? t.statusYourTurn
            : t.statusAiTurn;
  const modeText = matchMode === "demo" ? t.demoMatch : t.gameLive;
  const largeBoard = game.boardSize > 9;
  const reducedMotion = useReducedMotion();
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const openConversation = () => {
    document.getElementById("game-chat-panel")?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    if (!isFinished && !spectating) {
      window.requestAnimationFrame(() =>
        chatInputRef.current?.focus({ preventScroll: true }),
      );
    }
  };

  return (
    <PageTransition
      state={isFinished ? "finished" : "playing"}
      className="grid gap-8 py-6 sm:py-10 xl:grid-cols-[minmax(0,1fr)_21rem] xl:gap-14"
    >
      <div className="flex min-w-0 flex-col gap-6 sm:gap-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">
              {spectating ? t.spectatorTitle : t.gameTitle}
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              {spectating
                ? t.spectatorDescription
                : t.gameSubtitle(game.boardSize)}
            </p>
          </div>
          <Badge
            variant={
              isFinished || (spectating && spectatorStatus !== "live")
                ? "outline"
                : "secondary"
            }
          >
            {spectating
              ? spectatorStatusLabel
              : isFinished
                ? t.finishedTitle
                : modeText}
          </Badge>
        </div>
        <section className="flex flex-col gap-4 sm:gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full bg-foreground"
                  aria-hidden="true"
                />
                <span className="font-medium">
                  {spectating ? t.humanFull : t.human}
                </span>
                <span className="text-muted-foreground">{t.black}</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 rounded-full border bg-card"
                  aria-hidden="true"
                />
                <span className="truncate font-medium">
                  {game.aiModelId ?? t.ai}
                </span>
                <span className="text-muted-foreground">{t.white}</span>
              </span>
            </div>
            <Badge variant="outline">
              {isFinished
                ? t.finishedTitle
                : scoringPending
                  ? t.scoringPendingBadge
                  : game.turn === game.humanColor
                    ? spectating
                      ? t.spectatorHumanTurn
                      : t.turnYou
                    : spectating
                      ? t.spectatorAiTurn
                      : t.turnAi}
            </Badge>
          </div>
          <ConversationCue
            t={t}
            messages={game.messages}
            onOpen={openConversation}
            readOnly={spectating}
          />
          <div
            className={cn(
              "-mx-4 overflow-x-auto overscroll-x-contain sm:mx-0",
              largeBoard && "pb-2",
            )}
            role={largeBoard ? "region" : undefined}
            aria-label={largeBoard ? t.panBoardHint : undefined}
            tabIndex={largeBoard ? 0 : undefined}
          >
            <m.div
              className={cn(
                "relative aspect-square shrink-0 sm:mx-auto sm:w-full sm:max-w-[min(100%,70vh)]",
                game.boardSize === 9
                  ? "w-full min-w-full"
                  : game.boardSize === 13
                    ? "w-[33rem]"
                    : "w-[50rem]",
              )}
              layout
              transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            >
              <Board
                board={game.board}
                interactive={isHumanTurn}
                lastMove={game.moves.at(-1)?.point}
                onMove={onMove}
                t={t}
              />
              <DanmakuLayer messages={game.messages} enabled={danmakuEnabled} />
            </m.div>
          </div>
          {largeBoard && (
            <p className="text-center text-sm text-muted-foreground sm:hidden">
              {t.panBoardHint}
            </p>
          )}
          <p
            className="text-sm leading-6 text-muted-foreground"
            aria-live="polite"
          >
            {statusText}
          </p>
        </section>
      </div>
      <aside className="flex min-w-0 flex-col gap-6 xl:border-l xl:pl-10">
        <PlayerStack
          t={t}
          game={game}
          isFinished={isFinished}
          spectating={spectating}
          spectatorStatusLabel={spectatorStatusLabel}
          spectatorViewerCount={spectatorViewerCount}
        />
        {!spectating && !isFinished && (
          <div className="order-1 xl:order-6">
            <GameActions
              t={t}
              game={game}
              isHumanTurn={isHumanTurn}
              onPass={onPass}
              onResign={onResign}
              onRequestScoring={onRequestScoring}
              onWithdrawScoring={onWithdrawScoring}
            />
          </div>
        )}
        {shareControls && (
          <div className="order-2 xl:order-1">{shareControls}</div>
        )}
        <div className="order-3 xl:order-2">
          <GameChat
            t={t}
            messages={game.messages}
            danmakuEnabled={danmakuEnabled}
            onDanmakuToggle={onDanmakuToggle}
            onSendMessage={onSendMessage}
            disabled={isFinished || spectating}
            readOnly={spectating}
            inputRef={chatInputRef}
          />
        </div>
        <div className="order-4 border-t pt-6 xl:order-3">
          <ScoreSummary t={t} game={game} />
        </div>
        <div className="order-5 border-t pt-6 xl:order-4">
          <MoveLog
            t={t}
            language={language}
            moves={game.moves}
            boardSize={game.boardSize}
          />
        </div>
        {!spectating && (
          <div className="order-6 border-t pt-6 xl:order-5">
            <ToolPanel
              t={t}
              webmcpStatus={webmcpStatus}
              lastToolCall={lastToolCall}
            />
          </div>
        )}
        {(isFinished || spectating) && (
          <div className="order-7 flex flex-col gap-2 border-t pt-6">
            {!spectating && (
              <Button size="lg" onClick={onNewGame}>
                {t.newMatch}
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            )}
            <Button variant="ghost" onClick={onReturnLobby}>
              {spectating ? t.backToHome : t.returnLobby}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        )}
      </aside>
    </PageTransition>
  );
}

function PlayerStack({
  t,
  game,
  isFinished,
  spectating = false,
  spectatorStatusLabel,
  spectatorViewerCount = 0,
}: {
  t: Copy;
  game: GameState;
  isFinished: boolean;
  spectating?: boolean;
  spectatorStatusLabel?: string;
  spectatorViewerCount?: number;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium">
            {spectating ? t.spectatorTitle : t.gameLive}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {spectating ? spectatorStatusLabel : t.rulesDetail}
          </p>
        </div>
        <Badge variant="outline">
          {spectating
            ? t.shareViewers(spectatorViewerCount)
            : isFinished
              ? t.finishedTitle
              : "1 / 1"}
        </Badge>
      </div>
      <ItemGroup>
        <Item>
          <ItemMedia>
            <Avatar>
              <AvatarFallback>
                <UserIcon />
              </AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{spectating ? t.humanFull : t.human}</ItemTitle>
            <ItemDescription>
              {spectating ? t.spectatorHumanPlayer : t.humanFull}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant="outline">{t.black}</Badge>
          </ItemActions>
        </Item>
        <Item>
          <ItemMedia>
            <Avatar>
              <AvatarFallback>
                <BotIcon />
              </AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemTitle title={game.aiModelId ?? t.ai}>
              {game.aiModelId ?? t.ai}
            </ItemTitle>
            <ItemDescription>{t.aiFull}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Badge variant="outline">{t.white}</Badge>
          </ItemActions>
        </Item>
      </ItemGroup>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="block text-muted-foreground">{t.moves}</span>
          <strong className="tabular-nums">{game.moves.length}</strong>
        </div>
        <div>
          <span className="block text-muted-foreground">{t.captures}</span>
          <strong className="tabular-nums">
            {game.captures[game.humanColor]}
          </strong>
        </div>
        <div>
          <span className="block text-muted-foreground">{t.lastMove}</span>
          <strong>
            {formatLastMove(game.moves.at(-1)?.point, game.boardSize)}
          </strong>
        </div>
      </div>
    </section>
  );
}

function ToolPanel({
  t,
  webmcpStatus,
  lastToolCall,
}: {
  t: Copy;
  webmcpStatus: WebMCPStatus;
  lastToolCall: string | null;
}) {
  const tools = [
    { icon: BotIcon, label: t.toolJoin, code: "join_go_match" },
    { icon: ListTreeIcon, label: t.toolState, code: "get_go_game_state" },
    { icon: HourglassIcon, label: t.toolWait, code: "wait_for_go_turn" },
    { icon: CircleIcon, label: t.toolMove, code: "play_go_move" },
    { icon: RotateCcwIcon, label: t.toolPass, code: "pass_go_turn" },
    { icon: FlagIcon, label: t.toolResign, code: "resign_go_game" },
    {
      icon: ScaleIcon,
      label: t.toolScoreResponse,
      code: "respond_go_scoring",
    },
    { icon: MessageCircleIcon, label: t.toolSpeak, code: "send_go_message" },
  ];
  return (
    <section className="flex flex-col gap-5" id="tools">
      <div className="flex flex-col items-start gap-3">
        <div>
          <h2 className="text-xl font-medium">{t.toolsTitle}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t.toolsDescription}
          </p>
        </div>
        <WebMCPStatusBadge t={t} status={webmcpStatus} showContext />
      </div>
      <ItemGroup>
        {tools.map(({ icon: ToolIcon, label, code }) => (
          <Item
            size="xs"
            variant={lastToolCall === code ? "muted" : "default"}
            key={code}
          >
            <ItemMedia variant="icon">
              <ToolIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{label}</ItemTitle>
              <ItemDescription>
                <code>{code}</code>
              </ItemDescription>
            </ItemContent>
            {lastToolCall === code && (
              <ItemActions>
                <CheckIcon />
              </ItemActions>
            )}
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}

function MoveLog({
  t,
  language,
  moves,
  boardSize,
}: {
  t: Copy;
  language: Language;
  moves: Move[];
  boardSize: number;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-medium">{t.moveLog}</h2>
        <Badge variant="outline">{moves.length}</Badge>
      </div>
      {moves.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListTreeIcon />
            </EmptyMedia>
            <EmptyTitle>{t.moveLog}</EmptyTitle>
            <EmptyDescription>{t.emptyMoves}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableBody>
            {Array.from(
              { length: Math.min(5, moves.length) },
              (_, index) => moves[moves.length - index - 1],
            ).map((move) => (
              <TableRow key={`${move.number}-${move.actor}`}>
                <TableCell>
                  <span
                    className={cn(
                      "block size-2.5 rounded-full",
                      move.stone === "black"
                        ? "bg-foreground"
                        : "border bg-card",
                    )}
                  />
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {move.number}
                </TableCell>
                <TableCell>
                  {move.pass
                    ? language === "zh"
                      ? "停一手"
                      : "Pass"
                    : formatLastMove(move.point, boardSize)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {move.actor === "human" ? t.human : t.ai}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function ErrorNotice({
  t,
  message,
  onClose,
}: {
  t: Copy;
  message: string | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {message ? (
        <m.div
          key="room-error"
          className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ type: "spring", bounce: 0, duration: 0.32 }}
        >
          <Alert
            variant="destructive"
            className="border-destructive/25 bg-[color-mix(in_srgb,var(--danger)_9%,var(--paper-raised))]"
          >
            <InfoIcon />
            <AlertTitle>{t.errorLabel}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
            <AlertAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.closeError}
                onClick={onClose}
              >
                <XIcon />
              </Button>
            </AlertAction>
          </Alert>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

export function SiteFooter({ t }: { t: Copy }) {
  return (
    <footer className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
      <Separator />
      <div className="flex flex-col gap-2 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>{t.footerNote}</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            className="inline-flex items-center gap-1.5 font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-primary"
            href="https://github.com/LIghtJUNction/go.lmm.best"
            target="_blank"
            rel="noreferrer"
          >
            <GitForkIcon className="size-4" />
            {t.sourceCode}
            <ExternalLinkIcon className="size-3.5" />
          </a>
          <span>go.lmm.best · WebMCP</span>
        </div>
      </div>
    </footer>
  );
}

const Board = memo(function Board({
  board,
  interactive,
  lastMove,
  onMove,
  t,
}: {
  board: GoBoardData;
  interactive: boolean;
  lastMove?: Point;
  onMove?: (point: Point) => void;
  t: Copy;
}) {
  const reducedMotion = useReducedMotion();
  const size = board.length;
  const boardRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const [activePoint, setActivePoint] = useState<Point>(
    () => lastMove ?? { x: Math.floor(size / 2), y: Math.floor(size / 2) },
  );
  const coordinates = "ABCDEFGHJKLMNOPQRST".slice(0, size).split("");
  const starAxis =
    size === 9 ? [2, 4, 6] : size === 13 ? [3, 6, 9] : [3, 9, 15];
  const starPoints = starAxis.flatMap((y) =>
    starAxis.flatMap((x) =>
      size !== 9 ||
      (x === starAxis[1] && y === starAxis[1]) ||
      (x !== starAxis[1] && y !== starAxis[1])
        ? [{ x, y }]
        : [],
    ),
  );
  const positionStyle = (index: number) =>
    ({
      "--board-position": `${(index / (size - 1)) * 100}%`,
    }) as CSSProperties;
  const pointStyle = (x: number, y: number) =>
    ({
      "--board-x": `${(x / (size - 1)) * 100}%`,
      "--board-y": `${(y / (size - 1)) * 100}%`,
    }) as CSSProperties;
  const surfaceStyle = {
    "--board-size": size,
    "--intersection-size": `${Math.min(10.4, 92 / (size - 1))}%`,
  } as CSSProperties;

  useEffect(() => {
    setActivePoint((current) =>
      current.x < size && current.y < size
        ? current
        : { x: Math.floor(size / 2), y: Math.floor(size / 2) },
    );
  }, [size]);

  useEffect(() => {
    if (lastMove && !boardRef.current?.contains(document.activeElement)) {
      setActivePoint(lastMove);
    }
  }, [lastMove]);

  const focusIntersection = (point: Point) => {
    setActivePoint(point);
    cellRefs.current.get(`${point.x}-${point.y}`)?.focus();
  };

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    point: Point,
  ) => {
    const next = nextBoardFocusPoint(event.key, event.ctrlKey, point, size);
    if (!next) return;
    event.preventDefault();
    focusIntersection(next);
  };

  return (
    <div className="board-surface" style={surfaceStyle}>
      <div
        className="board-coordinates board-coordinates--top"
        aria-hidden="true"
      >
        {coordinates.map((letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </div>
      <div
        className="board-coordinates board-coordinates--bottom"
        aria-hidden="true"
      >
        {coordinates.map((letter) => (
          <span key={letter}>{letter}</span>
        ))}
      </div>
      <div
        className="board-coordinates board-coordinates--left"
        aria-hidden="true"
      >
        {Array.from({ length: size }, (_, index) => (
          <span key={index}>{size - index}</span>
        ))}
      </div>
      <div
        className="board-coordinates board-coordinates--right"
        aria-hidden="true"
      >
        {Array.from({ length: size }, (_, index) => (
          <span key={index}>{size - index}</span>
        ))}
      </div>
      <div
        ref={boardRef}
        className="go-board"
        role="grid"
        aria-label={t.ariaBoard(size)}
        aria-rowcount={size}
        aria-colcount={size}
      >
        <div className="board-lines" aria-hidden="true">
          {Array.from({ length: size }, (_, index) => (
            <span
              className="board-line board-line--vertical"
              style={positionStyle(index)}
              key={`v-${index}`}
            />
          ))}
          {Array.from({ length: size }, (_, index) => (
            <span
              className="board-line board-line--horizontal"
              style={positionStyle(index)}
              key={`h-${index}`}
            />
          ))}
        </div>
        <div className="star-points" aria-hidden="true">
          {starPoints.map(({ x, y }) => (
            <span key={`${x}-${y}`} style={pointStyle(x, y)} />
          ))}
        </div>
        {board.map((row, y) => (
          <div role="row" className="contents" key={`row-${y}`}>
            {row.map((cell, x) => {
              const point = { x, y };
              const unavailable = !interactive || Boolean(cell);
              const occupied =
                cell === "black"
                  ? t.occupiedBlack
                  : cell === "white"
                    ? t.occupiedWhite
                    : t.emptyIntersection;
              const isLast = lastMove?.x === x && lastMove?.y === y;
              return (
                <button
                  ref={(element) => {
                    const key = `${x}-${y}`;
                    if (element) cellRefs.current.set(key, element);
                    else cellRefs.current.delete(key);
                  }}
                  key={`${x}-${y}`}
                  type="button"
                  className={cn(
                    "intersection",
                    cell && `has-${cell}`,
                    isLast && "is-last",
                  )}
                  style={pointStyle(x, y)}
                  onClick={() => {
                    if (!unavailable) onMove?.(point);
                  }}
                  onFocus={() => setActivePoint(point)}
                  onKeyDown={(event) => handleCellKeyDown(event, point)}
                  tabIndex={activePoint.x === x && activePoint.y === y ? 0 : -1}
                  aria-disabled={unavailable}
                  aria-rowindex={y + 1}
                  aria-colindex={x + 1}
                  aria-label={t.ariaIntersection(
                    formatGoCoordinate(point, size),
                    occupied,
                  )}
                  role="gridcell"
                >
                  {cell && (
                    <m.span
                      className="stone"
                      aria-hidden="true"
                      initial={
                        reducedMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.9, y: -5 }
                      }
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={
                        reducedMotion
                          ? { duration: 0.1 }
                          : { type: "spring", bounce: 0.08, duration: 0.16 }
                      }
                    >
                      {isLast && <i />}
                    </m.span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
