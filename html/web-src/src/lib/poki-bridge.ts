import { createNet, type Net } from '../webrtcnet/net';

interface BridgeCallbacks {
  ready?: (selfId: string) => void;
  lobby?: (code: string, leaderId: string) => void;
  left?: () => void;
  peerConnected?: (peerId: string) => void;
  peerDisconnected?: (peerId: string, reason: string) => void;
  leader?: (leaderId: string) => void;
  message?: (peerId: string, channel: string, bytes: Uint8Array, isString: boolean, stringValue: string) => void;
  error?: (kind: string, message: string) => void;
  signalingreconnected?: (selfId: string) => void;
}

interface JoinedLobbyInfo { code: string; customData?: Record<string, unknown>; }
interface PublicLobbyEntry {
  code: string; playerCount: number; maxPlayers: number; hasPassword: boolean;
  customData?: Record<string, unknown>; leader?: string; createdAt: string; updatedAt: string;
}

enum WireKind { Control = 1, Game = 2 }
const enc = new TextEncoder();
const dec = new TextDecoder();
let net: Net | null = null;
let room = '';
let leaderId = '';
let host = false;
let pump: number | null = null;
let helloRetry: number | null = null;
const peers = new Set<string>();
const callbacks: Required<BridgeCallbacks> = {
  ready: () => {}, lobby: () => {}, left: () => {}, peerConnected: () => {}, peerDisconnected: () => {},
  leader: () => {}, message: () => {}, error: () => {}, signalingreconnected: () => {},
};

function safe<T extends (...args: any[]) => unknown>(fn: T) {
  return (...args: Parameters<T>): void => { try { fn(...args); } catch (e) { console.error('[webrtcnet-bridge] callback threw:', e); } };
}
function id(n: number): string { return String(n); }
function numeric(peerId: string): number {
  const n = Number(peerId);
  if (!Number.isInteger(n) || n <= 0) throw new Error('invalid peer id: ' + peerId);
  return n;
}
function frame(kind: WireKind, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.byteLength + 1); out[0] = kind; out.set(body, 1); return out;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isDevNetConfigHost(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === 'test.js-dos.com';
}
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
function notePeer(peerId: string): void {
  if (peerId === pokiBridgeSelfId() || peers.has(peerId)) return;
  peers.add(peerId); safe(callbacks.peerConnected)(peerId);
}
function send(peerId: string, kind: WireKind, bytes: Uint8Array): void {
  if (!net) return;
  notePeer(peerId);
  net.sendBinary(frame(kind, bytes), numeric(peerId));
}
function dispatch(peerId: string, data: Uint8Array): void {
  if (data.byteLength < 1) return;
  notePeer(peerId);
  const payload = data.subarray(1);
  if (data[0] === WireKind.Control) {
    safe(callbacks.message)(peerId, 'reliable', new Uint8Array(0), true, dec.decode(payload));
  } else if (data[0] === WireKind.Game) {
    safe(callbacks.message)(peerId, 'unreliable', payload.slice(), false, '');
  }
}
function startPump(): void {
  if (pump !== null) clearInterval(pump);
  pump = window.setInterval(() => {
    if (!net) return;
    // WebRTCNet is pump-driven. createNet() calls wait() only until the
    // initial peer id appears; after that, alias queries / signaling /
    // delivery still need regular servicing or promises such as
    // queryAliases('=room') can remain pending forever.
    net.wait(4);
    let pkt: ReturnType<Net['recvBinary']>;
    while ((pkt = net.recvBinary()) !== null) dispatch(id(pkt.peerId), pkt.data);
    for (const peerId of Array.from(peers)) {
      if (!net.connected.has(numeric(peerId))) {
        peers.delete(peerId);
        safe(callbacks.peerDisconnected)(peerId, 'disconnected');
      }
    }
  }, 16);
}
async function ensureNet(): Promise<Net> {
  if (net) return net;

  if (isDevNetConfigHost()) {
    setTimeout(() => {
      window.postMessage({
        event: "mp.room.netConfig",
        netConfig: {
          debug: true,
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        },
      });
      console.log("netConfig sent");
    }, 3000);
  }

  const params = new URLSearchParams(window.location.search);
  const netEndpoint = (params.get("net") ?? "wss://net.dos.zone");
  // const netEndpoint = "ws://127.0.0.1:8080";
  const netToken = "war3ft";
  const netSecret = "aslkdnionwqeasdqw";
  net = await createNet(netEndpoint, netToken, netSecret,
    (peerId) => {
      const peer = id(peerId);
      if (peers.delete(peer)) safe(callbacks.peerDisconnected)(peer, 'network-error');
    },
    () => safe(callbacks.error)('disconnect', 'network disconnected'),
  );
  startPump();
  safe(callbacks.ready)(id(net.peerId));
  return net;
}

export function pokiBridgeInit(_gameId: string, cb: BridgeCallbacks): boolean {
  Object.assign(callbacks, cb);
  void ensureNet().catch((e) => safe(callbacks.error)('init', String((e as any)?.message ?? e)));
  return true;
}
export function pokiBridgeCreateLobby(cbCode: (code: string) => void, cbErr: (reason: string) => void, settings?: any): void {
  const alias = String(settings?.alias ?? settings?.room ?? '').trim();
  if (!alias) { safe(cbErr)('room alias required'); return; }
  void ensureNet().then(async (n) => {
    const deadline = performance.now() + 10_000;
    while (true) {
      try {
        await withTimeout(n.registerAlias(alias), 1_500, 'alias registration timed out');
        break;
      } catch (e) {
        const message = String((e as any)?.message ?? e);
        if (message === 'Alias already in use') throw e;
        // WebRTCNet sometimes confirms the alias natively but the
        // promise inside registerAlias() never settles because its
        // follow-up alias query is lost/stuck. In that case retrying
        // only makes things worse: pendingRegister remains set, every
        // next attempt says "Register already in progress", and the
        // host UI is left on "connecting..." even though the alias is
        // already live. Treat the first registration timeout as a
        // recoverable success path here; a real conflict is still
        // surfaced above as "Alias already in use".
        if (message === 'alias registration timed out') {
          console.warn('[webrtcnet-bridge] alias registration promise timed out; proceeding after native registration attempt', alias);
          break;
        }
        if (performance.now() >= deadline) throw new Error('Alias registration timed out');
        await sleep(250);
      }
    }
    room = alias; host = true; leaderId = id(n.peerId);
    safe(callbacks.lobby)(room, leaderId); safe(callbacks.leader)(leaderId); safe(cbCode)(room);
  }).catch((e) => safe(cbErr)(String((e as any)?.message ?? e)));
}
export function pokiBridgeJoinLobby(code: string, cbInfo: (info: JoinedLobbyInfo) => void, cbErr: (reason: string) => void): void {
  void ensureNet().then(async (n) => {
    const matches = await n.queryAliases('=' + code);
    if (matches.length !== 1) { safe(cbErr)('join-not-found'); return; }
    room = code; host = false; leaderId = id(matches[0].peerId);
    notePeer(leaderId);
    safe(callbacks.lobby)(room, leaderId); safe(callbacks.leader)(leaderId); safe(cbInfo)({ code });
    const hello = frame(WireKind.Control, enc.encode(JSON.stringify({ type: 'hello' })));
    const sendHello = () => {
      try { n.sendBinary(hello, numeric(leaderId)); }
      catch { /* channel may not be ready yet; retry below */ }
    };
    sendHello();
    if (helloRetry !== null) clearInterval(helloRetry);
    helloRetry = window.setInterval(sendHello, 500);
  }).catch((e) => safe(cbErr)(String((e as any)?.message ?? e)));
}
export function pokiBridgeLeaveLobby(): void {
  if (host && room && net) net.unregisterAlias(room);
  if (helloRetry !== null) clearInterval(helloRetry);
  helloRetry = null;
  room = ''; leaderId = ''; host = false; peers.clear(); safe(callbacks.left)();
}
export function pokiBridgeSendBytesTo(peerId: string, _channel: string, int8: Int8Array): void {
  send(peerId, WireKind.Game, new Uint8Array(int8.buffer, int8.byteOffset, int8.byteLength));
}
export function pokiBridgeBroadcastBytes(_channel: string, int8: Int8Array): void {
  for (const peerId of peers) pokiBridgeSendBytesTo(peerId, 'unreliable', int8);
}
export function pokiBridgeSendStringTo(peerId: string, _channel: string, str: string): void { send(peerId, WireKind.Control, enc.encode(str)); }
export function pokiBridgeBroadcastString(_channel: string, str: string): void { for (const peerId of peers) pokiBridgeSendStringTo(peerId, 'reliable', str); }
export function pokiBridgeSetLobbySettings(_settings: object, cbOk?: () => void): void { cbOk?.(); }
export function pokiBridgeListLobbies(cbOk: (entries: PublicLobbyEntry[]) => void): void { cbOk([]); }
export function pokiBridgeSelfId(): string { return net ? id(net.peerId) : ''; }
export function pokiBridgeCurrentLobby(): string { return room; }
export function pokiBridgeCurrentLeader(): string { return leaderId; }
export function pokiBridgePeerCount(): number { return peers.size; }
export function pokiBridgePeerIds(): string[] { return Array.from(peers); }
export function pokiBridgeReady(): boolean { return net !== null; }
export function pokiBridgeClose(): void { pokiBridgeLeaveLobby(); if (pump !== null) clearInterval(pump); pump = null; net = null; }
export function pokiBridgeLobbyStateReceived(): void {
  if (helloRetry !== null) clearInterval(helloRetry);
  helloRetry = null;
}

const target: any = globalThis;
target.pokiBridgeInit = pokiBridgeInit;
target.pokiBridgeCreateLobby = pokiBridgeCreateLobby;
target.pokiBridgeJoinLobby = pokiBridgeJoinLobby;
target.pokiBridgeLeaveLobby = pokiBridgeLeaveLobby;
target.pokiBridgeSendBytesTo = pokiBridgeSendBytesTo;
target.pokiBridgeBroadcastBytes = pokiBridgeBroadcastBytes;
target.pokiBridgeSelfId = pokiBridgeSelfId;
target.pokiBridgeCurrentLobby = pokiBridgeCurrentLobby;
target.pokiBridgeCurrentLeader = pokiBridgeCurrentLeader;
target.pokiBridgePeerCount = pokiBridgePeerCount;
target.pokiBridgePeerIds = pokiBridgePeerIds;
target.pokiBridgeSendStringTo = pokiBridgeSendStringTo;
target.pokiBridgeBroadcastString = pokiBridgeBroadcastString;
target.pokiBridgeSetLobbySettings = pokiBridgeSetLobbySettings;
target.pokiBridgeListLobbies = pokiBridgeListLobbies;
target.pokiBridgeReady = pokiBridgeReady;
target.pokiBridgeClose = pokiBridgeClose;
target.pokiBridgeLobbyStateReceived = pokiBridgeLobbyStateReceived;
export type { JoinedLobbyInfo, PublicLobbyEntry };
