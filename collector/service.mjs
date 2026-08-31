import { BASE_CHAIN_ID, COLLECTOR_VERSION, FACTORY_REGISTRY } from "./factory-registry.mjs";
import { applyCanonicalEvents, buildCanonicalOpportunities, coalesceBoundedQueue, decodeFactoryLog, reconcileCanonicalWindow } from "./model.mjs";
import { enrichTokenMetadata, JsonRpcClient, verifyPoolBinding } from "./rpc.mjs";
import { DurableDiscoveryStore } from "./store.mjs";

const ENABLED = FACTORY_REGISTRY.filter((entry) => entry.enabled);

export function resolveCollectorConfig(environment = process.env) {
  const httpUrl = environment.BASE_RPC_HTTP_URL?.trim() || "https://mainnet.base.org";
  const websocketUrl = environment.BASE_RPC_WS_URL?.trim();
  return {
    httpUrl,
    websocketUrl: websocketUrl && /^wss?:\/\//i.test(websocketUrl) ? websocketUrl : undefined,
    storeDirectory: environment.ONCHAIN_STORE_PATH?.trim() || ".data/onchain-discovery",
    pollIntervalMs: boundedInteger(environment.ONCHAIN_POLL_INTERVAL_MS, 3_000, 1_000, 60_000),
    bootstrapBlocks: boundedInteger(environment.ONCHAIN_BOOTSTRAP_BLOCKS, 2_000, 64, 10_000),
    maximumChunksPerPass: boundedInteger(environment.ONCHAIN_MAX_CHUNKS_PER_PASS, 4, 1, 16),
    metadataBatchSize: boundedInteger(environment.ONCHAIN_METADATA_BATCH_SIZE, 12, 1, 32)
  };
}

export class OnchainDiscoveryCollector {
  constructor(config = resolveCollectorConfig()) {
    this.config = config;
    this.rpc = new JsonRpcClient(config.httpUrl);
    this.store = new DurableDiscoveryStore(config.storeDirectory);
    this.running = false;
    this.websocket = undefined;
    this.websocketReconnectTimer = undefined;
    this.websocketRequestId = 1;
  }

  async open() {
    const state = await this.store.open();
    if (this.config.websocketUrl) this.startWebsocket();
    return state;
  }

  async run(signal) {
    this.running = true;
    while (this.running && !signal?.aborted) {
      const startedAt = Date.now();
      try { await this.scanOnce(); }
      catch (error) { await this.recordFailure(error); }
      const remaining = Math.max(50, this.config.pollIntervalMs - (Date.now() - startedAt));
      await delay(remaining, signal);
    }
  }

  async scanOnce() {
    const head = await this.rpc.blockNumber();
    const confirmations = Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.confirmations));
    const confirmedHead = Math.max(0, head - confirmations);
    let state = this.store.read();
    const cursors = ENABLED.map((entry) => state.cursors?.[entry.id]?.blockNumber ?? 0);
    if (cursors.some((cursor) => cursor <= 0)) {
      const initialCursor = Math.max(1, confirmedHead - this.config.bootstrapBlocks - 1);
      state = await this.store.transact("initialize-bounded-cursors", (draft) => {
        for (const entry of ENABLED) draft.cursors[entry.id] = { blockNumber: initialCursor, blockHash: undefined, updatedAt: new Date().toISOString() };
        draft.currentHead = head;
        draft.confirmedHead = confirmedHead;
        draft.health.backfillState = "catching_up";
      });
    }

    let cursor = Math.min(...ENABLED.map((entry) => state.cursors[entry.id].blockNumber));
    let chunks = 0;
    while (cursor < confirmedHead && chunks < this.config.maximumChunksPerPass) {
      const maximumChunk = Math.min(...ENABLED.map((entry) => entry.confirmationPolicy.maximumChunkBlocks));
      const overlap = Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.overlapBlocks));
      const fromBlock = Math.max(1, cursor - overlap + 1);
      const toBlock = Math.min(confirmedHead, cursor + maximumChunk);
      const rawLogs = await this.rpc.getLogs({
        fromBlock,
        toBlock,
        addresses: ENABLED.map((entry) => entry.address),
        topics: [...new Set(ENABLED.map((entry) => entry.eventTopic))]
      });
      const decoded = rawLogs.map((log) => decodeFactoryLog(log)).filter(Boolean);
      const malformedCount = rawLogs.length - decoded.length;
      const confirmed = [];
      for (const event of decoded) {
        const binding = await verifyPoolBinding(this.rpc, event, event.blockNumber);
        if (!binding.ok) continue;
        const block = await this.rpc.getBlock(event.blockNumber);
        const timestampSeconds = block?.timestamp ? Number.parseInt(block.timestamp, 16) : undefined;
        confirmed.push({
          ...event,
          provisional: false,
          verifiedBinding: binding.kind,
          blockTimestamp: Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1_000).toISOString() : undefined
        });
      }
      state = await this.store.transact("confirmed-log-reconciliation", (draft) => {
        const next = reconcileCanonicalWindow(draft, confirmed, fromBlock, toBlock);
        for (const token of confirmed.flatMap((event) => [event.token0, event.token1])) {
          if (!next.tokenMetadata[token]) next.metadataQueue = coalesceBoundedQueue(next.metadataQueue, [{ poolKey: token, tokenAddress: token, blockNumber: toBlock }], 256);
        }
        for (const entry of ENABLED) next.cursors[entry.id] = { blockNumber: toBlock, blockHash: undefined, updatedAt: new Date().toISOString() };
        next.currentHead = head;
        next.confirmedHead = confirmedHead;
        next.counters.malformedRejected += malformedCount;
        next.health = buildHealth(next, head, confirmedHead, this.config.websocketUrl ? (this.websocket?.readyState === WebSocket.OPEN ? "websocket" : "reconnecting") : "confirmed_polling");
        return next;
      });
      cursor = toBlock;
      chunks += 1;
    }
    await this.drainMetadata();
    return this.store.read();
  }

  async replayConfirmedEvent({ blockNumber, transactionHash, logIndex }) {
    const rawLogs = await this.rpc.getLogs({
      fromBlock: blockNumber,
      toBlock: blockNumber,
      addresses: ENABLED.map((entry) => entry.address),
      topics: [...new Set(ENABLED.map((entry) => entry.eventTopic))]
    });
    const selected = rawLogs
      .map((log) => decodeFactoryLog({ ...log, replay: true }))
      .filter(Boolean)
      .filter((event) => !transactionHash || event.transactionHash === transactionHash.toLowerCase())
      .filter((event) => logIndex === undefined || event.logIndex === logIndex);
    if (!selected.length) throw new Error("No verified registry event matched the replay provenance");
    const event = selected[0];
    const binding = await verifyPoolBinding(this.rpc, event, event.blockNumber);
    if (!binding.ok) throw new Error(`Replay pool binding rejected: ${binding.reason}`);
    const metadata = {};
    for (const token of [event.token0, event.token1]) metadata[token] = await enrichTokenMetadata(this.rpc, token, event.blockNumber);
    const sandbox = applyCanonicalEvents(this.store.read(), [{ ...event, provisional: false, replay: true }], { replay: true });
    const opportunities = buildCanonicalOpportunities(Object.values(sandbox.pools), { ...sandbox.tokenMetadata, ...metadata }, sandbox.opportunities);
    const evidence = {
      replay: true,
      replayedAt: new Date().toISOString(),
      exactProvenance: { blockNumber: event.blockNumber, blockHash: event.blockHash, transactionHash: event.transactionHash, logIndex: event.logIndex },
      event,
      pool: sandbox.pools[event.poolKey],
      opportunities: opportunities.filter((opportunity) => opportunity.poolKeys.includes(event.poolKey)),
      cursorBefore: Object.fromEntries(Object.entries(this.store.read().cursors).map(([id, cursor]) => [id, cursor.blockNumber]))
    };
    await this.store.transact("deterministic-historical-replay-evidence", (draft) => {
      draft.replayEvidence ??= [];
      draft.replayEvidence.push(evidence);
      draft.replayEvidence = draft.replayEvidence.slice(-16);
    });
    return evidence;
  }

  async close() {
    this.running = false;
    if (this.websocketReconnectTimer) clearTimeout(this.websocketReconnectTimer);
    this.websocketReconnectTimer = undefined;
    try { this.websocket?.close(); } catch { /* best effort */ }
    this.websocket = undefined;
    await this.store.close();
  }

  async drainMetadata() {
    const state = this.store.read();
    const batch = (state.metadataQueue ?? []).slice(0, this.config.metadataBatchSize);
    if (!batch.length) return;
    const results = {};
    for (const item of batch) {
      results[item.tokenAddress] = await enrichTokenMetadata(this.rpc, item.tokenAddress, item.blockNumber);
    }
    await this.store.transact("bounded-token-metadata-enrichment", (draft) => {
      draft.tokenMetadata = { ...draft.tokenMetadata, ...results };
      const completed = new Set(batch.map((item) => item.tokenAddress));
      draft.metadataQueue = draft.metadataQueue.filter((item) => !completed.has(item.tokenAddress));
      draft.health.metadataQueueDepth = draft.metadataQueue.length;
    });
  }

  startWebsocket() {
    if (!this.running && this.store.closed) return;
    try {
      const socket = new WebSocket(this.config.websocketUrl);
      this.websocket = socket;
      socket.addEventListener("open", () => {
        const id = this.websocketRequestId++;
        socket.send(JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "eth_subscribe",
          params: ["logs", { address: ENABLED.map((entry) => entry.address), topics: [[...new Set(ENABLED.map((entry) => entry.eventTopic))]] }]
        }));
        void this.store.transact("websocket-connected", (draft) => {
          draft.mode = "websocket";
          draft.health.mode = "websocket";
        }).catch(() => {});
      });
      socket.addEventListener("message", (message) => {
        void this.handleWebsocketMessage(message.data).catch(() => {});
      });
      socket.addEventListener("close", () => this.scheduleWebsocketReconnect());
      socket.addEventListener("error", () => { try { socket.close(); } catch { /* best effort */ } });
    } catch { this.scheduleWebsocketReconnect(); }
  }

  async handleWebsocketMessage(data) {
    const payload = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    const raw = payload?.method === "eth_subscription" ? payload.params?.result : undefined;
    if (!raw) return;
    const event = decodeFactoryLog({ ...raw, provisional: true });
    if (!event) {
      await this.store.transact("malformed-provisional-event", (draft) => { draft.counters.malformedRejected += 1; });
      return;
    }
    await this.store.transact("provisional-websocket-event", (draft) => {
      const next = applyCanonicalEvents(draft, [{ ...event, provisional: true }]);
      next.provisional[event.idempotencyKey] = { ...event, receivedAt: new Date().toISOString() };
      next.provisional = Object.fromEntries(Object.entries(next.provisional).slice(-256));
      next.health.lastEventTime = new Date().toISOString();
      return next;
    });
  }

  scheduleWebsocketReconnect() {
    this.websocket = undefined;
    if (!this.running && this.store.closed) return;
    if (this.websocketReconnectTimer || !this.config.websocketUrl) return;
    void this.store.transact("websocket-reconnecting", (draft) => {
      draft.mode = "reconnecting";
      draft.counters.reconnectCount += 1;
      draft.health.mode = "reconnecting";
      draft.health.reconnectCount = draft.counters.reconnectCount;
    }).catch(() => {});
    this.websocketReconnectTimer = setTimeout(() => {
      this.websocketReconnectTimer = undefined;
      this.startWebsocket();
    }, 2_000);
  }

  async recordFailure(error) {
    await this.store.transact("collector-scan-failure", (draft) => {
      draft.health.ready = false;
      draft.health.backfillState = "retrying";
      draft.health.lastFailure = safeError(error);
      if (this.config.websocketUrl && this.websocket?.readyState !== WebSocket.OPEN) draft.health.mode = "reconnecting";
    });
  }
}

function buildHealth(state, head, confirmedHead, mode) {
  const cursor = Math.min(...ENABLED.map((entry) => state.cursors[entry.id].blockNumber));
  const lagBlocks = Math.max(0, confirmedHead - cursor);
  const latestEvent = Object.values(state.events ?? {}).filter((event) => event.status === "confirmed" && !event.replay).sort((left, right) => right.blockNumber - left.blockNumber)[0];
  return {
    ...state.health,
    ready: cursor > 0 && lagBlocks <= 16,
    mode,
    currentHead: head,
    confirmedCursor: cursor,
    lagBlocks,
    lagSeconds: lagBlocks * 2,
    lastEventTime: latestEvent?.firstSeenAt ?? state.health.lastEventTime,
    lastConfirmedEvent: latestEvent ? { blockNumber: latestEvent.blockNumber, transactionHash: latestEvent.transactionHash, logIndex: latestEvent.logIndex } : undefined,
    factories: Object.fromEntries(ENABLED.map((entry) => [entry.id, { enabled: true, healthy: state.cursors[entry.id].blockNumber > 0, cursor: state.cursors[entry.id].blockNumber }])),
    reconnectCount: state.counters.reconnectCount,
    backfillState: lagBlocks === 0 ? "caught_up" : "catching_up",
    reorgCount: state.counters.reorgCount,
    duplicateDropped: state.counters.duplicateDropped,
    malformedRejected: state.counters.malformedRejected,
    metadataQueueDepth: state.metadataQueue.length,
    storeIntegrity: "ok",
    collectorVersion: COLLECTOR_VERSION,
    chainId: BASE_CHAIN_ID
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function safeError(error) {
  const message = error instanceof Error ? error.message : "unknown collector failure";
  return message.replace(/https?:\/\/\S+/gi, "[redacted-rpc]").slice(0, 240);
}

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
