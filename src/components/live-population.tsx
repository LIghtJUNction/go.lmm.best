import { AnimatePresence, m, useReducedMotion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Copy } from "@/lib/i18n";
import type { PopulationStats } from "@/lib/session";

function LiveCount({ value }: { value: number }) {
  const reducedMotion = useReducedMotion();
  return (
    <span className="relative inline-grid min-w-4 place-items-center font-semibold tabular-nums">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={value}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
          transition={
            reducedMotion
              ? { duration: 0.1 }
              : { type: "spring", bounce: 0, duration: 0.22 }
          }
        >
          {value}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

export function LivePopulationStrip({
  t,
  stats,
}: {
  t: Copy;
  stats: PopulationStats;
}) {
  const values = [
    { label: t.humanPlayers, value: stats.humanPlayers },
    { label: t.aiPlayers, value: stats.aiPlayers },
    { label: t.activeGames, value: stats.activeGames },
  ];

  return (
    <section
      className="border-b bg-background"
      aria-label={t.livePopulation}
      title={t.localPopulationNote}
    >
      <div className="mx-auto flex min-h-11 max-w-7xl items-center gap-3 overflow-x-auto px-4 py-2 text-sm text-muted-foreground sm:px-6 lg:px-8">
        <Badge variant="secondary" className="shrink-0">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          {t.live}
        </Badge>
        {values.map((item, index) => (
          <span key={item.label} className="contents">
            {index > 0 && <Separator orientation="vertical" className="h-3" />}
            <span className="flex shrink-0 items-center gap-1.5">
              <LiveCount value={item.value} />
              {item.label}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}
