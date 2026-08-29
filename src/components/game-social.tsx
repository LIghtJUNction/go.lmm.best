import {
    useState,
    type FormEvent,
    type KeyboardEvent,
    type Ref,
} from "react";
import {
    ArrowRightIcon,
    FlagIcon,
    MessageCircleIcon,
    RotateCcwIcon,
    ScaleIcon,
    SendIcon,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldLabel,
} from "@/components/ui/field";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupText,
    InputGroupTextarea,
} from "@/components/ui/input-group";
import {
    Message,
    MessageContent,
    MessageHeader,
} from "@/components/ui/message";
import {
    MessageScroller,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Switch } from "@/components/ui/switch";
import type { Copy } from "@/lib/i18n";
import {
    MAX_MESSAGE_LENGTH,
    type GameMessage,
    type GameState,
} from "@/lib/session";

export function ConversationCue({
    t,
    messages,
    onOpen,
    readOnly = false,
}: {
    t: Copy;
    messages: GameMessage[];
    onOpen: () => void;
    readOnly?: boolean;
}) {
    const latest = messages.at(-1);

    return (
        <button
            type="button"
            className="group flex w-full items-center gap-3 border-b py-3 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-controls="game-chat-panel"
            onClick={onOpen}
        >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background text-foreground">
                <MessageCircleIcon className="size-4" />
            </span>
            <span
                className="min-w-0 flex-1"
                aria-live="polite"
                aria-atomic="true"
            >
                <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.chatTitle}</span>
                    <Badge variant={messages.length > 0 ? "secondary" : "outline"}>
                        {messages.length}
                    </Badge>
                </span>
                {latest ? (
                    <span className="mt-1 block min-w-0 truncate">
                        <span className="mr-2 text-sm font-medium text-muted-foreground">
                            {latest.actor === "human" ? t.human : t.ai} ·{" "}
                            {t.messageAtMove(latest.moveNumber)}
                        </span>
                        <span className="text-sm text-foreground">
                            {latest.text}
                        </span>
                    </span>
                ) : (
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                        {readOnly ? t.spectatorNoMessages : t.noMessages}
                    </span>
                )}
            </span>
            <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
    );
}

export function GameChat({
    t,
    messages,
    danmakuEnabled,
    onDanmakuToggle,
    onSendMessage,
    disabled,
    readOnly = false,
    inputRef,
}: {
    t: Copy;
    messages: GameMessage[];
    danmakuEnabled: boolean;
    onDanmakuToggle: (enabled: boolean) => void;
    onSendMessage: (message: string) => boolean;
    disabled: boolean;
    readOnly?: boolean;
    inputRef?: Ref<HTMLTextAreaElement>;
}) {
    const [draft, setDraft] = useState("");
    const canSend = !disabled && draft.trim().length > 0;

    const submit = (event?: FormEvent) => {
        event?.preventDefault();
        if (!canSend) return;
        if (onSendMessage(draft)) setDraft("");
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
        }
    };

    return (
        <section
            id="game-chat-panel"
            className="scroll-mt-6 flex flex-col gap-4"
            aria-labelledby="game-chat-title"
        >
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 id="game-chat-title" className="text-xl font-medium">
                        {t.chatTitle}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {readOnly
                            ? t.spectatorChatDescription
                            : t.chatDescription}
                    </p>
                </div>
                <Badge variant={messages.length > 0 ? "secondary" : "outline"}>
                    {messages.length}
                </Badge>
            </div>

            <MessageScrollerProvider>
                <MessageScroller className="h-64 min-h-0 rounded-lg border bg-muted/40">
                    <MessageScrollerViewport>
                        <MessageScrollerContent className="gap-4 p-3">
                            {messages.length === 0 ? (
                                <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                                    <MessageCircleIcon className="size-5" />
                                    <p>
                                        {readOnly
                                            ? t.spectatorNoMessages
                                            : t.noMessages}
                                    </p>
                                </div>
                            ) : (
                                messages.map((message, index) => {
                                    const human = message.actor === "human";
                                    return (
                                        <MessageScrollerItem
                                            key={message.id}
                                            scrollAnchor={
                                                index === messages.length - 1
                                            }
                                        >
                                            <Message
                                                align={human ? "end" : "start"}
                                            >
                                                <MessageContent>
                                                    <MessageHeader className="gap-1">
                                                        <span>
                                                            {human
                                                                ? t.human
                                                                : t.ai}
                                                        </span>
                                                        <span>·</span>
                                                        <span>
                                                            {t.messageAtMove(
                                                                message.moveNumber,
                                                            )}
                                                        </span>
                                                    </MessageHeader>
                                                    <Bubble
                                                        align={
                                                            human
                                                                ? "end"
                                                                : "start"
                                                        }
                                                        variant={
                                                            human
                                                                ? "default"
                                                                : "secondary"
                                                        }
                                                    >
                                                        <BubbleContent className="whitespace-pre-wrap break-words">
                                                            {message.text}
                                                        </BubbleContent>
                                                    </Bubble>
                                                </MessageContent>
                                            </Message>
                                        </MessageScrollerItem>
                                    );
                                })
                            )}
                        </MessageScrollerContent>
                    </MessageScrollerViewport>
                </MessageScroller>
            </MessageScrollerProvider>

            {!readOnly && (
                <form onSubmit={submit}>
                    <Field>
                        <InputGroup className="h-auto">
                            <InputGroupTextarea
                                ref={inputRef}
                                id="game-chat-input"
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={handleKeyDown}
                                maxLength={MAX_MESSAGE_LENGTH}
                                placeholder={t.chatPlaceholder}
                                aria-label={t.chatPlaceholder}
                                className="min-h-20 resize-none text-base sm:text-sm"
                                disabled={disabled}
                            />
                            <InputGroupAddon
                                align="block-end"
                                className="justify-between"
                            >
                                <InputGroupText className="tabular-nums">
                                    {draft.length}/{MAX_MESSAGE_LENGTH}
                                </InputGroupText>
                                <InputGroupButton
                                    type="submit"
                                    size="sm"
                                    variant="default"
                                    className="h-8 px-3"
                                    disabled={!canSend}
                                    aria-label={t.sendMessage}
                                >
                                    <SendIcon />
                                    {t.sendMessage}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                    </Field>
                </form>
            )}

            <Field orientation="horizontal">
                <FieldContent>
                    <FieldLabel htmlFor="danmaku-toggle">
                        {t.danmaku}
                    </FieldLabel>
                    <FieldDescription>{t.danmakuDescription}</FieldDescription>
                </FieldContent>
                <Switch
                    id="danmaku-toggle"
                    checked={danmakuEnabled}
                    onCheckedChange={onDanmakuToggle}
                    aria-label={t.danmaku}
                />
            </Field>
        </section>
    );
}

export function DanmakuLayer({
    messages,
    enabled,
}: {
    messages: GameMessage[];
    enabled: boolean;
}) {
    const reducedMotion = useReducedMotion();
    const latest = messages.at(-1);
    if (!enabled || !latest) return null;
    const lane = latest.id % 3;

    return (
        <div
            className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
            aria-hidden="true"
        >
            <AnimatePresence mode="popLayout">
                <m.div
                    key={latest.id}
                    className="absolute left-full max-w-[75%] truncate rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm"
                    style={{ top: `${10 + lane * 12}%` }}
                    initial={
                        reducedMotion ? { opacity: 0 } : { opacity: 0, x: 0 }
                    }
                    animate={
                        reducedMotion
                            ? { opacity: [0, 1, 1, 0] }
                            : {
                                  opacity: [0, 1, 1, 0],
                                  x: "calc(-100vw - 100%)",
                              }
                    }
                    transition={
                        reducedMotion
                            ? { duration: 3, times: [0, 0.1, 0.8, 1] }
                            : {
                                  duration: 8,
                                  ease: "linear",
                                  times: [0, 0.05, 0.9, 1],
                              }
                    }
                >
                    {latest.text}
                </m.div>
            </AnimatePresence>
        </div>
    );
}

export function ScoreSummary({ t, game }: { t: Copy; game: GameState }) {
    if (game.scoring.status !== "complete") return null;
    const score = game.scoring.result;
    const result =
        score.winner === "black"
            ? t.blackWinsBy(score.margin)
            : score.winner === "white"
              ? t.whiteWinsBy(score.margin)
              : t.scoreTie;

    return (
        <section className="flex flex-col gap-4" aria-labelledby="score-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="score-title" className="text-xl font-medium">
                        {t.scoreTitle}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t.areaScoring}
                    </p>
                </div>
                <Badge variant="secondary">{result}</Badge>
            </div>
            <div className="grid grid-cols-2 divide-x border-y py-4">
                {(
                    [
                        [t.blackScore, score.black, 0],
                        [t.whiteScore, score.white, score.komi],
                    ] as const
                ).map(([label, side, komi]) => (
                    <div key={label} className="px-4 first:pl-0 last:pr-0">
                        <span className="text-sm text-muted-foreground">
                            {label}
                        </span>
                        <strong className="mt-1 block font-heading text-3xl tabular-nums">
                            {side.total}
                        </strong>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {t.stones} {side.stones} · {t.territory}{" "}
                            {side.territory}
                            {komi > 0 ? ` · ${t.komi} ${komi}` : ""}
                        </p>
                    </div>
                ))}
            </div>
            <p className="text-sm text-muted-foreground">
                {t.neutral}: {score.neutral}
            </p>
        </section>
    );
}

export function GameActions({
    t,
    game,
    isHumanTurn,
    onPass,
    onResign,
    onRequestScoring,
    onWithdrawScoring,
}: {
    t: Copy;
    game: GameState;
    isHumanTurn: boolean;
    onPass: () => void;
    onResign: () => void;
    onRequestScoring: () => void;
    onWithdrawScoring: () => void;
}) {
    const scoringPending = game.scoring.status === "pending";
    return (
        <div className="sticky bottom-2 z-30 flex flex-col gap-2 rounded-xl border bg-background p-2 shadow-lg shadow-foreground/5 xl:static xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none">
            <Button
                variant={scoringPending ? "secondary" : "outline"}
                onClick={scoringPending ? onWithdrawScoring : onRequestScoring}
            >
                <ScaleIcon data-icon="inline-start" />
                {scoringPending ? t.withdrawScoring : t.requestScoring}
            </Button>
            <div className="grid grid-cols-2 gap-2">
                <Button
                    variant="outline"
                    onClick={onPass}
                    disabled={!isHumanTurn || scoringPending}
                >
                    {t.pass}
                    <RotateCcwIcon data-icon="inline-end" />
                </Button>
                <Button variant="destructive" onClick={onResign}>
                    {t.resign}
                    <FlagIcon data-icon="inline-end" />
                </Button>
            </div>
        </div>
    );
}
