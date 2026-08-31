import { readOnchainStoreSnapshot } from "@/lib/base-terminal/onchainDiscovery";

const RELAY_STATE_KEY = Symbol.for("mergen.onchain.relay.state");
type RelayState = { clients: number };
type RelayGlobal = typeof globalThis & { [RELAY_STATE_KEY]?: RelayState };

function relayState() {
  const scope = globalThis as RelayGlobal;
  scope[RELAY_STATE_KEY] ??= { clients: 0 };
  return scope[RELAY_STATE_KEY];
}

export function registerOnchainRelayClient() {
  relayState().clients += 1;
  return () => { relayState().clients = Math.max(0, relayState().clients - 1); };
}

export function getOnchainRelayClientCount() { return relayState().clients; }

export function readRelayEventsAfter(lastEventId?: string) {
  const result = readOnchainStoreSnapshot();
  if (!result.ok) return { ok: false as const, reason: result.reason, events: [] };
  const ring = result.state.eventRing ?? [];
  if (!lastEventId) return { ok: true as const, state: result.state, events: ring.slice(-1) };
  const index = ring.findIndex((event) => event.id === lastEventId);
  return { ok: true as const, state: result.state, events: index < 0 ? ring : ring.slice(index + 1) };
}
