import { memo, type ReactNode } from "react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BotIcon,
  CheckIcon,
  CircleIcon,
  FlagIcon,
  InfoIcon,
  LanguagesIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  UserIcon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";

import type { GameState, MatchMode, Move, PopulationStats, RoomView } from "@/App";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { createBoard, type Board as GoBoardData, type Point } from "@/lib/go";
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
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function formatLastMove(point?: Point): string {
  if (!point) return "—";
  return `${String.fromCharCode(65 + point.x)}${point.y + 1}`;
}

function PageTransition({ children, className, state }: { children: ReactNode; className: string; state?: string }) {
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

export function Header({
  t,
  language,
  webmcpStatus,
  onLanguageToggle,
  onReturnHome,
}: {
  t: Copy;
  language: Language;
  webmcpStatus: WebMCPStatus;
  onLanguageToggle: () => void;
  onReturnHome: () => void;
}) {
  const connected = webmcpStatus === "available";
  return (
    <header className="border-b bg-background/95">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Button variant="ghost" size="lg" className="px-0" onClick={onReturnHome} aria-label="go.lmm.best home">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-foreground" />
              <span className="size-2.5 rounded-full border bg-card" />
              <span className="size-2.5 rounded-full bg-primary" />
            </span>
            <span className="font-heading text-xl font-semibold tracking-tight">go.lmm.best</span>
          </span>
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected ? <WifiIcon /> : <WifiOffIcon />}
            <span className="hidden sm:inline">WebMCP</span>
            {connected ? t.connected : t.offline}
          </Badge>
          <Button variant="outline" size="sm" onClick={onLanguageToggle} aria-label={t.languageSwitchLabel}>
            <LanguagesIcon data-icon="inline-start" />
            {language === "zh" ? "EN" : "中"}
          </Button>
        </div>
      </div>
    </header>
  );
}

export function PopulationOverview({
  t,
  stats,
  compact = false,
}: {
  t: Copy;
  stats: PopulationStats;
  compact?: boolean;
}) {
  const waitingMessage = stats.waitingHumans > 0
    ? t.waitingHumansCount(stats.waitingHumans)
    : stats.waitingAi > 0
      ? t.waitingAiCount(stats.waitingAi)
      : t.queuesBalanced;

  return (
    <section className={cn("flex flex-col gap-5", compact ? "py-2" : "py-4")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium">{t.livePlayersTitle}</h2>
          {!compact && <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">{t.livePlayersDetail}</p>}
        </div>
        <Badge variant="outline">FIFO</Badge>
      </div>
      <Separator />
      <div className="grid grid-cols-3 gap-6">
        <div className="flex flex-col gap-1"><AnimatedNumber value={stats.humanPlayers} /><span className="text-sm text-muted-foreground">{t.humanPlayers}</span></div>
        <div className="flex flex-col gap-1"><AnimatedNumber value={stats.aiPlayers} /><span className="text-sm text-muted-foreground">{t.aiPlayers}</span></div>
        <div className="flex flex-col gap-1"><AnimatedNumber value={stats.activeGames} /><span className="text-sm text-muted-foreground">{t.activeGames}</span></div>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{waitingMessage}</p>
    </section>
  );
}

export function Lobby({
  t,
  webmcpStatus,
  population,
  onStartMatch,
  onStartDemo,
}: {
  t: Copy;
  webmcpStatus: WebMCPStatus;
  population: PopulationStats;
  onStartMatch: () => void;
  onStartDemo: () => void;
}) {
  const connected = webmcpStatus === "available";
  return (
    <PageTransition state="idle" className="grid gap-14 py-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(28rem,0.7fr)] lg:items-center lg:gap-20 lg:py-20">
      <div className="flex flex-col gap-9">
        <div className="flex max-w-2xl flex-col gap-5">
          <h1 className="text-5xl font-medium leading-none tracking-tight sm:text-6xl">{t.heroTitle}</h1>
          <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">{t.heroDescription}</p>
        </div>
        <PopulationOverview t={t} stats={population} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button size="lg" onClick={onStartMatch}>{t.startMatch}<ArrowUpRightIcon data-icon="inline-end" /></Button>
          <Button variant="ghost" size="lg" onClick={onStartDemo}>{t.viewDemo}<ArrowRightIcon data-icon="inline-end" /></Button>
        </div>
        <div>
          <Badge variant={connected ? "secondary" : "outline"}>{connected ? <WifiIcon /> : <WifiOffIcon />}{connected ? t.webmcpReady : t.demoHint}</Badge>
        </div>
      </div>
      <BoardPreview t={t} />
      <HowItWorks t={t} />
    </PageTransition>
  );
}

function HowItWorks({ t }: { t: Copy }) {
  const steps = [
    { number: "01", title: t.stepOne, detail: t.stepOneDetail, icon: UserIcon },
    { number: "02", title: t.stepTwo, detail: t.stepTwoDetail, icon: BotIcon },
    { number: "03", title: t.stepThree, detail: t.stepThreeDetail, icon: CircleIcon },
  ];
  return (
    <section className="flex flex-col gap-6 pt-6 lg:col-span-2 lg:pt-10" id="how-it-works" aria-labelledby="steps-title">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="steps-title" className="text-2xl font-medium">{t.matchStepsTitle}</h2>
        <Badge variant="outline">{t.matchMode}</Badge>
      </div>
      <ItemGroup className="grid gap-8 md:grid-cols-3">
        {steps.map(({ number, title, detail, icon: StepIcon }, index) => (
          <m.div key={number} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ type: "spring", bounce: 0, duration: 0.35, delay: index * 0.06 }}>
            <Item>
              <ItemMedia variant="icon"><StepIcon /></ItemMedia>
              <ItemContent>
                <ItemTitle><Badge variant="outline">{number}</Badge>{title}</ItemTitle>
                <ItemDescription>{detail}</ItemDescription>
              </ItemContent>
            </Item>
          </m.div>
        ))}
      </ItemGroup>
    </section>
  );
}

function BoardPreview({ t }: { t: Copy }) {
  const reducedMotion = useReducedMotion();
  return (
    <m.section className="flex flex-col gap-5" whileHover={reducedMotion ? undefined : { y: -4 }} transition={{ type: "spring", bounce: 0, duration: 0.35 }}>
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-xl font-medium">{t.boardPreview}</h2><p className="mt-1 text-sm text-muted-foreground">{t.boardPreviewHint}</p></div>
        <Badge variant="secondary">{t.live}</Badge>
      </div>
      <Board board={previewBoard} interactive={false} lastMove={{ x: 4, y: 4 }} t={t} />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-foreground" />{t.human}</span>
        <span className="text-xs">VS</span>
        <span className="flex items-center gap-2"><span className="size-2.5 rounded-full border bg-card" />{t.ai}</span>
      </div>
    </m.section>
  );
}

export function Searching({
  t,
  elapsed,
  webmcpStatus,
  population,
  onCancel,
  onStartDemo,
}: {
  t: Copy;
  elapsed: number;
  webmcpStatus: WebMCPStatus;
  population: PopulationStats;
  onCancel: () => void;
  onStartDemo: () => void;
}) {
  const connected = webmcpStatus === "available";
  return (
    <PageTransition state="searching" className="mx-auto flex max-w-5xl flex-col gap-12 py-14 lg:py-20">
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        <Badge variant="secondary"><LoaderCircleIcon className="motion-safe:animate-spin" />{t.waiting}</Badge>
        <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">{t.waitingTitle}</h1>
        <p className="text-base leading-7 text-muted-foreground">{t.waitingDescription}</p>
      </div>
      <div className="grid gap-10 lg:grid-cols-[1fr_auto_1fr] lg:gap-12">
        <div className="flex flex-col gap-8">
          <PopulationOverview t={t} stats={population} compact />
          <Separator />
          <section className="flex flex-col gap-5">
            <div><h2 className="text-xl font-medium">{t.statusLabel}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{t.statusWaiting}</p></div>
            <div className="grid grid-cols-2 gap-8">
              <div><span className="text-sm text-muted-foreground">{t.queuePosition}</span><strong className="mt-1 block font-heading text-3xl font-medium tabular-nums">{t.queuePositionValue}</strong></div>
              <div><span className="text-sm text-muted-foreground">{t.elapsed}</span><strong className="mt-1 block font-heading text-3xl font-medium tabular-nums">{formatElapsed(elapsed)}</strong></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onCancel}>{t.cancelMatch}<XIcon data-icon="inline-end" /></Button>
              <Button variant="ghost" onClick={onStartDemo}>{t.viewDemo}<ArrowRightIcon data-icon="inline-end" /></Button>
            </div>
          </section>
        </div>
        <Separator className="lg:hidden" />
        <Separator orientation="vertical" className="hidden lg:block" />
        <section className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-xl font-medium">{t.aiCallHint}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{t.toolsDescription}</p></div>
            <Badge variant={connected ? "secondary" : "outline"}>{connected ? t.connected : t.offline}</Badge>
          </div>
          <ItemGroup className="gap-2">
            {[t.agentJoinStepOne, t.agentJoinStepTwo, t.agentJoinStepThree].map((step, index) => (
              <m.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.3, delay: index * 0.06 }}>
                <Item size="sm"><ItemMedia><Badge variant="outline">{index + 1}</Badge></ItemMedia><ItemContent><ItemDescription>{step}</ItemDescription></ItemContent></Item>
              </m.div>
            ))}
          </ItemGroup>
          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm"><code>{JOIN_TOOL_EXAMPLE}</code></pre>
          <Badge variant={connected ? "secondary" : "outline"}>{connected ? <WifiIcon /> : <WifiOffIcon />}{connected ? t.listening : t.webmcpUnsupported}</Badge>
        </section>
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
  onMove,
  onPass,
  onResign,
  onReturnLobby,
  onNewGame,
}: {
  t: Copy;
  language: Language;
  game: GameState;
  view: RoomView;
  matchMode: MatchMode;
  webmcpStatus: WebMCPStatus;
  lastToolCall: string | null;
  onMove: (point: Point) => void;
  onPass: () => void;
  onResign: () => void;
  onReturnLobby: () => void;
  onNewGame: () => void;
}) {
  const isFinished = view === "finished";
  const isHumanTurn = !isFinished && game.turn === game.humanColor;
  const finishedText = game.endReason === "human-resigned" ? t.finishedByResignYou : game.endReason === "ai-resigned" ? t.finishedByResignAi : t.finishedByPass;
  const statusText = isFinished ? finishedText : isHumanTurn ? t.statusYourTurn : t.statusAiTurn;
  const modeText = matchMode === "demo" ? t.demoMatch : t.gameLive;

  return (
    <PageTransition state={isFinished ? "finished" : "playing"} className="grid gap-12 py-10 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-16">
      <div className="flex min-w-0 flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-4xl font-medium tracking-tight sm:text-5xl">{t.gameTitle}</h1><p className="mt-2 text-sm text-muted-foreground">{t.gameSubtitle}</p></div>
          <Badge variant={isFinished ? "outline" : "secondary"}>{isFinished ? t.finishedTitle : modeText}</Badge>
        </div>
        <section className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-xl font-medium">Room 01</h2><p className="mt-1 text-sm text-muted-foreground">{game.aiModelId ? `${t.human} vs ${game.aiModelId}` : t.gameSubtitle}</p></div>
            <Badge variant="outline">{isFinished ? t.finishedTitle : game.turn === game.humanColor ? t.turnYou : t.turnAi}</Badge>
          </div>
          <m.div className="mx-auto w-full max-w-[min(100%,70vh)]" layout transition={{ type: "spring", bounce: 0, duration: 0.35 }}>
            <Board board={game.board} interactive={isHumanTurn} lastMove={game.moves.at(-1)?.point} onMove={onMove} t={t} />
          </m.div>
          <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2"><InfoIcon />{isFinished ? t.statusFinished : isHumanTurn ? t.tipContent : t.statusAiTurn}</span>
            <Badge variant="outline">9 × 9</Badge>
          </div>
        </section>
        <Separator />
        <div className="flex items-start gap-3 py-1"><InfoIcon className="mt-0.5 shrink-0" /><div><h2 className="font-medium">{isFinished ? t.finishedTitle : isHumanTurn ? t.turnYou : t.turnAi}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{statusText}</p></div></div>
      </div>
      <aside className="flex flex-col gap-8 xl:border-l xl:pl-10">
        <PlayerStack t={t} game={game} isFinished={isFinished} />
        <Separator />
        <ToolPanel t={t} webmcpStatus={webmcpStatus} lastToolCall={lastToolCall} />
        <Separator />
        <MoveLog t={t} language={language} moves={game.moves} />
        <Separator />
        {isFinished ? (
          <div className="flex flex-col gap-2"><Button size="lg" onClick={onNewGame}>{t.newMatch}<ArrowUpRightIcon data-icon="inline-end" /></Button><Button variant="ghost" onClick={onReturnLobby}>{t.returnLobby}<ArrowRightIcon data-icon="inline-end" /></Button></div>
        ) : (
          <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={onPass} disabled={!isHumanTurn}>{t.pass}<RotateCcwIcon data-icon="inline-end" /></Button><Button variant="destructive" onClick={onResign}>{t.resign}<FlagIcon data-icon="inline-end" /></Button></div>
        )}
      </aside>
    </PageTransition>
  );
}

function PlayerStack({ t, game, isFinished }: { t: Copy; game: GameState; isFinished: boolean }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-medium">{t.gameLive}</h2><p className="mt-1 text-sm text-muted-foreground">{t.rulesDetail}</p></div><Badge variant="outline">{isFinished ? t.finishedTitle : "1 / 1"}</Badge></div>
      <ItemGroup>
        <Item variant={!isFinished && game.turn === game.humanColor ? "muted" : "default"}><ItemMedia><Avatar><AvatarFallback><UserIcon /></AvatarFallback></Avatar></ItemMedia><ItemContent><ItemTitle>{t.human}</ItemTitle><ItemDescription>{t.humanFull}</ItemDescription></ItemContent><ItemActions><Badge variant="outline">{t.black}</Badge></ItemActions></Item>
        <Item variant={!isFinished && game.turn === game.aiColor ? "muted" : "default"}><ItemMedia><Avatar><AvatarFallback><BotIcon /></AvatarFallback></Avatar></ItemMedia><ItemContent><ItemTitle title={game.aiModelId ?? t.ai}>{game.aiModelId ?? t.ai}</ItemTitle><ItemDescription>{t.aiFull}</ItemDescription></ItemContent><ItemActions><Badge variant="outline">{t.white}</Badge></ItemActions></Item>
      </ItemGroup>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div><span className="block text-muted-foreground">{t.moves}</span><strong className="tabular-nums">{game.moves.length}</strong></div>
        <div><span className="block text-muted-foreground">{t.captures}</span><strong className="tabular-nums">{game.captures[game.humanColor]}</strong></div>
        <div><span className="block text-muted-foreground">{t.lastMove}</span><strong>{formatLastMove(game.moves.at(-1)?.point)}</strong></div>
      </div>
    </section>
  );
}

function ToolPanel({ t, webmcpStatus, lastToolCall }: { t: Copy; webmcpStatus: WebMCPStatus; lastToolCall: string | null }) {
  const tools = [
    { icon: ListTreeIcon, label: t.toolState, code: "get_go_game_state" },
    { icon: CircleIcon, label: t.toolMove, code: "play_go_move" },
    { icon: RotateCcwIcon, label: t.toolPass, code: "pass_go_turn" },
    { icon: FlagIcon, label: t.toolResign, code: "resign_go_game" },
  ];
  const connected = webmcpStatus === "available";
  return (
    <section className="flex flex-col gap-5" id="tools">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-medium">{t.toolsTitle}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{t.toolsDescription}</p></div><Badge variant={connected ? "secondary" : "outline"}>{connected ? t.connected : t.offline}</Badge></div>
      <ItemGroup>
        {tools.map(({ icon: ToolIcon, label, code }) => (
          <Item size="xs" variant={lastToolCall === code ? "muted" : "default"} key={code}><ItemMedia variant="icon"><ToolIcon /></ItemMedia><ItemContent><ItemTitle>{label}</ItemTitle><ItemDescription><code>{code}</code></ItemDescription></ItemContent>{lastToolCall === code && <ItemActions><CheckIcon /></ItemActions>}</Item>
        ))}
      </ItemGroup>
    </section>
  );
}

function MoveLog({ t, language, moves }: { t: Copy; language: Language; moves: Move[] }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-medium">{t.moveLog}</h2><Badge variant="outline">{moves.length}</Badge></div>
      {moves.length === 0 ? (
        <Empty><EmptyHeader><EmptyMedia variant="icon"><ListTreeIcon /></EmptyMedia><EmptyTitle>{t.moveLog}</EmptyTitle><EmptyDescription>{t.emptyMoves}</EmptyDescription></EmptyHeader></Empty>
      ) : (
        <Table><TableBody>{moves.slice(-5).reverse().map((move) => (
          <TableRow key={`${move.number}-${move.actor}`}><TableCell><span className={cn("block size-2.5 rounded-full", move.stone === "black" ? "bg-foreground" : "border bg-card")} /></TableCell><TableCell className="tabular-nums text-muted-foreground">{move.number}</TableCell><TableCell>{move.pass ? (language === "zh" ? "停一手" : "Pass") : formatLastMove(move.point)}</TableCell><TableCell className="text-right text-muted-foreground">{move.actor === "human" ? t.human : t.ai}</TableCell></TableRow>
        ))}</TableBody></Table>
      )}
    </section>
  );
}

export function ErrorNotice({ t, message, onClose }: { t: Copy; message: string; onClose: () => void }) {
  return (
    <m.div className="fixed right-4 bottom-4 w-[min(26rem,calc(100%-2rem))]" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ type: "spring", bounce: 0, duration: 0.32 }}>
      <Alert variant="destructive"><InfoIcon /><AlertTitle>{t.errorLabel}</AlertTitle><AlertDescription>{message}</AlertDescription><AlertAction><Button variant="ghost" size="icon-sm" aria-label={t.closeError} onClick={onClose}><XIcon /></Button></AlertAction></Alert>
    </m.div>
  );
}

export function SiteFooter({ t }: { t: Copy }) {
  return (
    <footer className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8"><Separator /><div className="flex flex-col gap-2 pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>{t.footerNote}</span><span>go.lmm.best · WebMCP</span></div></footer>
  );
}

const Board = memo(function Board({ board, interactive, lastMove, onMove, t }: { board: GoBoardData; interactive: boolean; lastMove?: Point; onMove?: (point: Point) => void; t: Copy }) {
  const size = board.length;
  const coordinates = "ABCDEFGHI";
  return (
    <div className="board-surface">
      <div className="board-coordinates board-coordinates--top" aria-hidden="true">{coordinates.slice(0, size).split("").map((letter) => <span key={letter}>{letter}</span>)}</div>
      <div className="board-coordinates board-coordinates--bottom" aria-hidden="true">{coordinates.slice(0, size).split("").map((letter) => <span key={letter}>{letter}</span>)}</div>
      <div className="board-coordinates board-coordinates--left" aria-hidden="true">{Array.from({ length: size }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
      <div className="board-coordinates board-coordinates--right" aria-hidden="true">{Array.from({ length: size }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
      <div className="go-board" role="grid" aria-label={t.ariaBoard}>
        <div className="board-lines" aria-hidden="true">{Array.from({ length: size }, (_, index) => <span className="board-line board-line--vertical" data-board-position={index} key={`v-${index}`} />)}{Array.from({ length: size }, (_, index) => <span className="board-line board-line--horizontal" data-board-position={index} key={`h-${index}`} />)}</div>
        <div className="star-points" aria-hidden="true">{[2, 4, 6].flatMap((y) => [2, 4, 6].map((x) => <span key={`${x}-${y}`} data-board-x={x} data-board-y={y} />))}</div>
        {board.map((row, y) => row.map((cell, x) => {
          const occupied = cell === "black" ? t.occupiedBlack : cell === "white" ? t.occupiedWhite : t.emptyIntersection;
          const isLast = lastMove?.x === x && lastMove?.y === y;
          return <button key={`${x}-${y}`} type="button" className={cn("intersection", cell && `has-${cell}`, isLast && "is-last")} data-board-x={x} data-board-y={y} onClick={() => onMove?.({ x, y })} disabled={!interactive || Boolean(cell)} aria-label={t.ariaIntersection(x, y, occupied)} role="gridcell">{cell && <span className="stone" aria-hidden="true">{isLast && <i />}</span>}</button>;
        }))}
      </div>
    </div>
  );
});
