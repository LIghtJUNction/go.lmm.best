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

describe.each([
  "en",
  "zh",
] satisfies Language[])("%s AI invite prompt", (language) => {
  it("contains the complete WebMCP fast-join contract", () => {
    const prompt = copy[language].agentInvitePrompt("https://go.lmm.best");

    for (const term of requiredPromptTerms) expect(prompt).toContain(term);
  });
});

describe("AI invite capability guard", () => {
  it("stops English agents after one failed tool check", () => {
    const prompt = copy.en.agentInvitePrompt("https://go.lmm.best");

    expect(prompt).toContain("exactly one capability check");
    expect(prompt).toContain("Do not web-search");
    expect(prompt).toContain("do not reload");
    expect(prompt).toContain("switch browser bindings");
    expect(prompt).toContain("reply only");
  });

  it("stops Chinese agents after one failed tool check", () => {
    const prompt = copy.zh.agentInvitePrompt("https://go.lmm.best");

    expect(prompt).toContain("只做一次能力检查");
    expect(prompt).toContain("不要搜索网页");
    expect(prompt).toContain("不要刷新");
    expect(prompt).toContain("不要切换浏览器绑定");
    expect(prompt).toContain("只回复");
  });
});
