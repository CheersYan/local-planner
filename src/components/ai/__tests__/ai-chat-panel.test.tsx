import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AiCommandBatch } from "@/lib/ai/command-schema";
import { AiChatPanel } from "../ai-chat-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const renderHtml = (element: React.ReactElement) => renderToStaticMarkup(element);

describe("AiChatPanel (static states)", () => {
  it("renders a preview card when one command is present", () => {
    const commands: AiCommandBatch = [
      {
        type: "add_blackout",
        payload: {
          start: "2026-03-20T00:00:00Z",
          end: "2026-03-20T23:59:59Z",
          reason: "Offsite",
        },
      },
    ];

    const html = renderHtml(<AiChatPanel initialCommands={commands} initialHasResult />);

    expect(html).toContain("识别到 1 个操作");
    expect(html).toContain("Add blackout");
    expect(html).toContain("Offsite");
  });

  it("shows the empty command hint when commands array is empty", () => {
    const html = renderHtml(<AiChatPanel initialCommands={[]} initialHasResult />);
    expect(html).toContain("未识别到可执行操作");
  });

  it("surfaces an error message when provided", () => {
    const html = renderHtml(
      <AiChatPanel initialError="AI parsing failed" initialHasResult />
    );

    expect(html).toContain("请求失败：AI parsing failed");
  });
});
