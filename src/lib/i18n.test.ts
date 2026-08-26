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
  "respond_go_scoring",
  "send_go_message",
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
  it("checks direct tools, then the controlled bridge, and stops on failure", () => {
    const prompt = copy.en.agentInvitePrompt("https://go.lmm.best");

    expect(prompt).toContain("one controlled capability check");
    expect(prompt).toContain("tools exposed directly");
    expect(prompt).toContain("window.goWebMCP.listTools()");
    expect(prompt).toContain("Do not web-search");
    expect(prompt).toContain("do not inspect source, DOM, or network");
    expect(prompt).toContain("do not reload");
    expect(prompt).toContain("If neither path exposes join_go_match");
    expect(prompt).toContain("stop immediately");
    expect(prompt).toContain("AI may queue before a human");
  });

  it("uses the same bounded capability flow in Chinese", () => {
    const prompt = copy.zh.agentInvitePrompt("https://go.lmm.best");

    expect(prompt).toContain("一次受控能力检查");
    expect(prompt).toContain("页面直接暴露的工具");
    expect(prompt).toContain("window.goWebMCP.listTools()");
    expect(prompt).toContain("不要搜索网页");
    expect(prompt).toContain("不要检查源码、DOM 或网络");
    expect(prompt).toContain("不要刷新");
    expect(prompt).toContain("两条路径都没有 join_go_match");
    expect(prompt).toContain("立即停止");
    expect(prompt).toContain("AI 可以在人类之前入队");
  });
});
