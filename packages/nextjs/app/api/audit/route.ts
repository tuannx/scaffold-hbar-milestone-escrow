import { NextResponse } from "next/server";
import { isAuditConfigured, submitAuditMessage } from "~~/services/hedera/auditLog";

/**
 * POST /api/audit { "message": "EscrowFunded id=0 ..." }
 * Mirrors an escrow lifecycle event to the HCS audit topic when configured.
 * Returns 200 with { configured: false } when the operator env is unset, so
 * the route is healthy (and the UI can show "audit disabled") in a fresh scaffold.
 */
export async function POST(request: Request) {
  if (!isAuditConfigured()) {
    return NextResponse.json({ configured: false });
  }

  let message: unknown;
  try {
    const body = await request.json();
    message = body?.message;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof message !== "string" || message.length === 0 || message.length > 1024) {
    return NextResponse.json({ error: "Field 'message' must be a string of 1-1024 characters." }, { status: 400 });
  }

  try {
    const result = await submitAuditMessage(message);
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown HCS error.";
    return NextResponse.json({ configured: true, error: detail }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ configured: isAuditConfigured() });
}
