import { getOnchainRelayClientCount, readRelayEventsAfter, registerOnchainRelayClient } from "@/lib/base-terminal/onchainRelay";
import { collectorFreshness } from "@/lib/base-terminal/onchainDiscovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();
const MAXIMUM_CLIENTS = 64;

export function GET(request: Request) {
  if (getOnchainRelayClientCount() >= MAXIMUM_CLIENTS) {
    return Response.json({ ok: false, error: "Opportunity stream is at its bounded client limit." }, { status: 503, headers: { "Retry-After": "5" } });
  }
  let lastEventId = request.headers.get("last-event-id")?.trim() || undefined;
  let initialPushTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let release = () => {};
  let closed = false;
  let lastStatusSignature = "";
  let closeStream = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      release = registerOnchainRelayClient();
      const close = () => {
        if (closed) return;
        closed = true;
        if (initialPushTimer) clearTimeout(initialPushTimer);
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        release();
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* connection already closed */ }
      };
      closeStream = close;
      const push = () => {
        if (closed) return;
        const result = readRelayEventsAfter(lastEventId);
        if (!result.ok) {
          const status = { ready: false, reason: result.reason };
          const signature = JSON.stringify(status);
          if (signature !== lastStatusSignature) {
            controller.enqueue(encoder.encode(`event: collector_status\ndata: ${signature}\n\n`));
            lastStatusSignature = signature;
          }
          return;
        }
        const status = {
          ...collectorFreshness(result.state),
          mode: result.state.health.mode ?? result.state.mode,
          storeIntegrity: result.state.health.storeIntegrity,
          confirmedHead: result.state.confirmedHead,
          requiresSnapshot: result.resetRequired,
          readOnly: true
        };
        const signature = JSON.stringify(status);
        if (signature !== lastStatusSignature) {
          controller.enqueue(encoder.encode(`event: collector_status\ndata: ${signature}\n\n`));
          lastStatusSignature = signature;
        }
        if (!lastEventId || result.resetRequired) {
          lastEventId = result.checkpoint ?? "0";
          if (lastEventId) controller.enqueue(encoder.encode(`id: ${lastEventId}\nevent: collector_checkpoint\ndata: ${JSON.stringify({ requiresSnapshot: true })}\n\n`));
        }
        for (const event of result.events) {
          controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event.data, observedAt: event.at })}\n\n`));
          lastEventId = event.id;
        }
      };
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      // Return the SSE response and flush its headers before reading and
      // integrity-checking the bounded durable snapshot. A busy collector can
      // make that synchronous verification expensive, but it must never block
      // the stream handshake.
      initialPushTimer = setTimeout(push, 0);
      pollTimer = setInterval(push, 1_000);
      heartbeatTimer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
    },
    cancel() {
      closeStream();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "X-Mergen-Opportunity-Stream": "read-only"
    }
  });
}
