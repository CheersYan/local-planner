import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { aiCommandBatchSchema } from "@/lib/ai/command-schema";
import { executeCommandBatch } from "@/lib/commands/executor";

const requestSchema = z.object({
  mode: z.enum(["preview", "execute"]).default("preview"),
  commands: aiCommandBatchSchema,
});

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { mode, commands } = parsed.data;

  try {
    const execution = await executeCommandBatch(commands, {
      dryRun: mode === "preview",
    });

    return NextResponse.json(execution, { status: 200 });
  } catch (error) {
    console.error("Command execution failed", error);
    return NextResponse.json(
      { error: "Command execution failed", details: String(error) },
      { status: 500 },
    );
  }
}
