/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { AiCommandBatch } from "@/lib/ai/command-schema";
import { AiChatPanel } from "../ai-chat-panel";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: vi.fn(), writable: true });
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AiChatPanel (preview + execute flow)", () => {
  it("shows blackout changes after execution and refreshes the page", async () => {
    const commands: AiCommandBatch = [
      {
        type: "update_blackout_window",
        payload: {
          target: { blackoutId: "blk-1" },
          startDate: "2026-03-13",
          endDate: "2026-03-13",
          reason: "Travel updated",
        },
      },
    ];

    const matched = {
      id: "blk-1",
      start: "2026-03-12T00:00:00Z",
      end: "2026-03-12T23:59:59Z",
      reason: "Travel",
    };
    const updated = {
      ...matched,
      start: "2026-03-13T00:00:00Z",
      end: "2026-03-13T23:59:59Z",
      reason: "Travel updated",
    };

    const previewResponse = {
      results: [
        {
          command: commands[0],
          status: "ok" as const,
          matchedBlackouts: [matched],
          blackoutChanges: [{ before: matched, after: updated }],
          requiresReplan: true,
        },
      ],
      replanTriggered: false,
    };

    const executeResponse = {
      results: [
        {
          command: commands[0],
          status: "ok" as const,
          matchedBlackouts: [matched],
          blackoutChanges: [{ before: matched, after: updated }],
          requiresReplan: true,
        },
      ],
      replanTriggered: true,
    };

    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
      const mode = body.mode ?? "preview";
      if (mode === "execute") {
        return { ok: true, json: async () => executeResponse } as Response;
      }
      return { ok: true, json: async () => previewResponse } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<AiChatPanel initialCommands={commands} initialHasResult />);
    });

    try {
      // Preview fetch should have happened once.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const executeButton = Array.from(container.querySelectorAll("button")).find((btn) =>
        btn.textContent?.includes("执行这些命令"),
      ) as HTMLButtonElement;

      await act(async () => {
        executeButton?.click();
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(refreshMock).toHaveBeenCalled();
      expect(container.textContent).toContain("执行成功");
      expect(container.textContent).toContain("变更前");
      expect(container.textContent).toContain("Travel updated");
      expect(container.textContent).toContain("2026-03-13");
    } finally {
      vi.unstubAllGlobals();
      refreshMock.mockClear();
    }
  });
});
