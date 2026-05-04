import { NextRequest, NextResponse } from "next/server";

import { connectIntegrationProvider } from "@/lib/integrations/orchestrator";
import { parseIntegrationProvider } from "@/lib/integrations/providers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider: rawProvider } = await params;
    const provider = parseIntegrationProvider(rawProvider);
    const payload = (await request.json().catch(() => ({}))) as { nextPath?: string };
    const result = await connectIntegrationProvider(provider, payload.nextPath ?? "/overview");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        mode: "error",
        message: error instanceof Error ? error.message : "Failed to connect provider",
      },
      { status: 400 },
    );
  }
}
