import { useState } from "react";
import { ArrowRightIcon, BotIcon, Grid3X3Icon } from "lucide-react";
import { m, useReducedMotion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Copy } from "@/lib/i18n";
import { BOARD_SIZES, DEFAULT_BOARD_SIZE, type BoardSize } from "@/lib/session";

export function MatchSetup({
  t,
  aiModelId,
  onStart,
  onReturnHome,
}: {
  t: Copy;
  aiModelId: string;
  onStart: (boardSize: BoardSize) => void;
  onReturnHome: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [boardSize, setBoardSize] = useState<BoardSize>(DEFAULT_BOARD_SIZE);
  const details = {
    9: { label: t.boardSmall, description: t.boardSmallDescription },
    13: { label: t.boardMedium, description: t.boardMediumDescription },
    19: { label: t.boardLarge, description: t.boardLargeDescription },
  } satisfies Record<BoardSize, { label: string; description: string }>;

  return (
    <m.section
      className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-8 sm:gap-10 sm:py-14 lg:py-20"
      data-state="setup"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reducedMotion
          ? { duration: 0.12 }
          : { type: "spring", bounce: 0, duration: 0.32 }
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Badge variant="secondary">{t.matchFound}</Badge>
        <div>
          <h1 className="text-4xl leading-tight sm:text-5xl">
            {t.chooseBoard}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            {t.matchFoundDescription}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BotIcon className="size-4 text-primary" />
          <span>{t.matchedWith}</span>
          <strong className="font-medium text-foreground">{aiModelId}</strong>
        </div>
      </div>

      <ToggleGroup
        className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3"
        value={[String(boardSize)]}
        onValueChange={(values) => {
          const next = Number(values[0]);
          if (BOARD_SIZES.includes(next as BoardSize)) {
            setBoardSize(next as BoardSize);
          }
        }}
        variant="outline"
        spacing={2}
        aria-label={t.chooseBoard}
      >
        {BOARD_SIZES.map((size) => (
          <ToggleGroupItem
            key={size}
            value={String(size)}
            aria-label={`${details[size].label} ${size}×${size}`}
            className="h-auto min-h-24 w-full flex-col items-start gap-1.5 px-4 py-4 text-left data-pressed:border-primary data-pressed:bg-secondary data-pressed:text-secondary-foreground"
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <Grid3X3Icon className="size-4" />
                <strong className="text-xl font-semibold tabular-nums">
                  {size}×{size}
                </strong>
              </span>
              {size === DEFAULT_BOARD_SIZE && (
                <Badge variant="outline">{t.defaultChoice}</Badge>
              )}
            </span>
            <span className="font-medium">{details[size].label}</span>
            <span className="text-xs leading-5 text-muted-foreground">
              {details[size].description}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <Button variant="ghost" size="lg" onClick={onReturnHome}>
          {t.returnLobby}
        </Button>
        <Button size="lg" onClick={() => onStart(boardSize)}>
          {t.startGame}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </m.section>
  );
}
