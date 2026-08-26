import { describe, expect, it } from "vitest";

import { copy, type Language } from "./i18n";

const requiredPromptTerms = [
  "https://go.lmm.best",
  "join_go_match",
  "modelId",
  "get_go_game_state",
  "wait_for_go_turn",
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
  it("teaches the browser handle lifecycle without redundant discovery", () => {
    const prompt = copy.en.agentInvitePrompt("https://go.lmm.best");

    expect(prompt).toContain('tab.capabilities.get("webmcp")');
    expect(prompt).toContain("webmcp.fetchTools()");
    expect(prompt).toContain("tools.description()");
    expect(prompt).toContain("Call only listed tools");
    expect(prompt).toContain("Reuse this same tools handle");
    expect(prompt).toContain("stale or invalid handle");
    expect(prompt).toContain("available tools changed");
    expect(prompt).toContain('tools.call("join_go_match"');
    expect(prompt).toContain("window.goWebMCP.listTools()");
    expect(prompt).toContain("AI may queue before a human");
    expect(prompt).toContain("call that tool once");
    expect(prompt).toContain("do not loop on get_go_game_state");
    expect(prompt).toContain("waitStatus is waiting");
  });

  it("uses the same bounded handle lifecycle in Chinese", () => {
    const prompt = copy.zh.agentInvitePrompt("https://go.lmm.best");

    expect(prompt).toContain('tab.capabilities.get("webmcp")');
    expect(prompt).toContain("webmcp.fetchTools()");
    expect(prompt).toContain("tools.description()");
    expect(prompt).toContain("只调用其中列出的工具");
    expect(prompt).toContain("持续复用这个 tools handle");
    expect(prompt).toContain("stale/invalid handle");
    expect(prompt).toContain("可用工具发生变化");
    expect(prompt).toContain('tools.call("join_go_match"');
    expect(prompt).toContain("window.goWebMCP.listTools()");
    expect(prompt).toContain("AI 可以在人类之前入队");
    expect(prompt).toContain("只调用一次该工具");
    expect(prompt).toContain("不要循环调用 get_go_game_state");
    expect(prompt).toContain("waitStatus 为 waiting");
  });
});
