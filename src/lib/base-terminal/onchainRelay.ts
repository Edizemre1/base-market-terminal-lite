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
  const checkpoint = ring.at(-1)?.id;
  if (!lastEventId) return { ok: true as const, state: result.state, events: [], checkpoint, resetRequired: false };
  const valid = /^\d{1,16}$/.test(lastEventId);
  const gap = !valid || Boolean(ring[0] && BigInt(lastEventId) < BigInt(ring[0].id) - BigInt(1)) || Boolean(checkpoint && BigInt(lastEventId) > BigInt(checkpoint));
  // A gap requires a new snapshot, not replay of an arbitrary bounded tail.
  return { ok: true as const, state: result.state, events: gap ? [] : ring.filter((event) => BigInt(event.id) > BigInt(lastEventId)), checkpoint, resetRequired: gap };
}
