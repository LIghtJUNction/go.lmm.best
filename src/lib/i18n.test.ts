import { describe, expect, it } from "vitest";

import { copy, type Language } from "./i18n";

const requiredPromptTerms = [
  "https://go.lmm.best",
  "join_go_match",
  "modelId",
  "get_go_game_state",
  "expectedRevision",
  "play_go_move",
  "pass_go_turn",
  "resign_go_game",
];

describe.each(["en", "zh"] satisfies Language[])(
  "%s AI invite prompt",
  (language) => {
    it("contains the complete WebMCP fast-join contract", () => {
      const prompt = copy[language].agentInvitePrompt("https://go.lmm.best");

      for (const term of requiredPromptTerms) expect(prompt).toContain(term);
    });
  },
);
