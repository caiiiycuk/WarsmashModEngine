/**
 * EnginePage — the single-entry game orchestrator.
 *
 * It keeps the inline first-run asset uploader, boots immediately when
 * staged assets are already present, and receives multiplayer startup
 * from the launch transport rather than from route-to-route lobby UI
 * handoff. The DOM shell itself is rendered by App.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  formatSummary, hasStagedAssets,
  readIndex, stageFiles, summarizeIndex, writeIndex,
  type IndexSummary,
} from '../lib/assetStaging';
import { bootEngineWorker, type EngineHandle } from '../lib/engineBoot';
import {
  getLobbyState,
  isSlotJoinable,
  requestSlot,
  startGame,
  subscribeLobbyState,
  updateSlot,
  type LobbySlotType,
  type LobbyState,
  type StartPayload,
} from '../lib/lobbyClient';
import { PlayerRace, raceLabel } from '../lib/mapInfo';
import type { LaunchConfig } from '../lib/launchConfig';
import { createMultiplayerTransport, type MultiplayerTransport } from '../lib/multiplayerTransport';
import { clearOpfs, hasW3Root, installEngineWorkerGlobals, listAllMaps } from '../lib/opfs';
import { HANDICAP_VALUES, PLAYER_COLORS, colorById } from '../lib/playerColors';
import { acquireWakeLock, installWakeLockReacquire } from '../lib/wakeLock';
import DesyncOverlay, { type DesyncReportPayload } from './DesyncOverlay';

type BootState = 'loading' | 'no-assets' | 'staging' | 'running';

declare global {
  interface Window {
    __startEngine?: () => void;
    __engineStarted?: () => boolean;
    __attachWorker?: (w: Worker) => void;
  }
}

interface Props {
  launchConfig: LaunchConfig;
  /** id of the canvas element rendered by the app shell. */
  canvasId?: string;
  /** id of the splash element rendered by the app shell. */
  splashId?: string;
  /** id of the canvas wrapper element (toggles between display:none/flex). */
  canvasWrapId?: string;
}

export default function EnginePage({
  launchConfig,
  canvasId = 'canvas',
  splashId = 'splash',
  canvasWrapId = 'canvas-wrap',
}: Props) {
  const [boot, setBoot] = useState<BootState>('loading');
  const [summary, setSummary] = useState<IndexSummary>({ fileCount: 0, mpqCount: 0, mapCount: 0, totalBytes: 0 });
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [desync, setDesync] = useState<DesyncReportPayload | null>(null);
  const [lobbyState, setLobbyState] = useState<LobbyState>(() => getLobbyState());
  const [multiplayerLobbyVisible, setMultiplayerLobbyVisible] = useState(launchConfig.mode === 'webrtc');
  const engineHandle = useRef<EngineHandle | null>(null);
  const transport = useRef<MultiplayerTransport | null>(null);
  const menuReady = useRef(false);
  const sessionDirty = useRef(false);
  /** Multiplayer start payload waiting to be forwarded to the engine
   *  worker once it reaches the menu screen. Populated either via
   *  launch transport once it has resolved enough runtime state to form
   *  the engine-facing payload. */
  const queuedMpStart = useRef<StartPayload | null>(null);
  /** Guards onPlay against being called twice (e.g. from auto-boot
   *  AND from a manual click). */
  const bootInFlight = useRef(false);

  // Splash control — imperative because the splash element lives in
  // the outer app shell, not inside this component.
  const showSplash = useCallback(() => {
    const el = document.getElementById(splashId);
    if (el) el.style.display = 'flex';
  }, [splashId]);
  const hideSplash = useCallback(() => {
    const el = document.getElementById(splashId);
    if (el) el.style.display = 'none';
  }, [splashId]);

  // ---- Init: install globals, purge legacy state, auto-boot if ready ----
  useEffect(() => {
    return subscribeLobbyState(setLobbyState);
  }, []);

  useEffect(() => {
    if (launchConfig.mode === 'webrtc' && lobbyState.lobbyCode) {
      hideSplash();
    }
  }, [hideSplash, launchConfig.mode, lobbyState.lobbyCode]);

  useEffect(() => {
    let cancelled = false;
    console.log('[EnginePage] hydrated, beginning init.');
    installEngineWorkerGlobals();
    installWakeLockReacquire(() => sessionDirty.current || boot === 'running');

    if (launchConfig.mode === 'webrtc') {
      (window as any).__mpPendingStart = true;
      void createMultiplayerTransport(launchConfig)
        .then((t) => {
          transport.current = t;
          return t.start();
        })
        .then((payload) => {
          queuedMpStart.current = payload;
          setMultiplayerLobbyVisible(false);
          sendQueuedMultiplayerStart();
        })
        .catch((err) => setErrorMsg('Multiplayer bootstrap failed: ' + msg(err)));
    }

    (async () => {
      try {
        if (!('storage' in navigator) || !navigator.storage.getDirectory) {
          setErrorMsg('OPFS is not supported in this browser. Try a Chromium-based browser (Chrome, Edge, Opera).');
          setBoot('no-assets');
          return;
        }
        await purgeLegacyExtractedDir();
        if (cancelled) return;

        if (hasStagedAssets()) {
          const idx = readIndex();
          const s = summarizeIndex(idx);
          setSummary(s);

          // The index is a localStorage cache, not proof that OPFS still
          // contains the staged install. DevTools/browser cleanup can wipe
          // OPFS independently and otherwise leave us auto-booting from a
          // phantom install forever.
          if (!(await hasW3Root())) {
            console.warn('[EnginePage] staged asset index exists, but OPFS /w3 is missing; resetting stale index.');
            writeIndex([]);
            setSummary({ fileCount: 0, mpqCount: 0, mapCount: 0, totalBytes: 0 });
            setStatusMsg('Staged install was not found in browser storage. Select your Warcraft III folder again.');
            setBoot('no-assets');
            return;
          }

          if (s.mapCount > 0) {
            // Cheap reality check against the actual Maps subtree. This catches
            // a second stale-index case where OPFS still has /w3 but its staged
            // map files were deleted underneath the cached index.
            const actualMaps = await listAllMaps();
            if (actualMaps.length === 0) {
              console.warn('[EnginePage] staged asset index reports maps, but OPFS has none; resetting stale index.');
              writeIndex([]);
              setSummary({ fileCount: 0, mpqCount: 0, mapCount: 0, totalBytes: 0 });
              setStatusMsg('Staged maps were not found in browser storage. Select your Warcraft III folder again.');
              setBoot('no-assets');
              return;
            }
            console.log('[EnginePage] staged assets present, auto-booting engine.');
            await tryBootEngine();
          }
          else {
            // Edge case: assets staged but no .w3x/.w3m. User must
            // re-pick a folder that includes a stock map.
            setStatusMsg('No map files staged yet. Re-pick your Warcraft III folder so a stock map is included.');
            setBoot('no-assets');
          }
        }
        else {
          setBoot('no-assets');
        }
      }
      catch (err) {
        console.error('[EnginePage] init failed:', err);
        setErrorMsg('Init failed: ' + msg(err));
        setBoot('no-assets');
      }
    })();
    return () => { cancelled = true; transport.current?.dispose(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Preserve compatibility engine-control globals ----
  useEffect(() => {
    window.__startEngine = () => { void tryBootEngine(); };
    window.__engineStarted = () => boot === 'running';
    return () => {
      delete window.__startEngine;
      delete window.__engineStarted;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  // ---- File pick → staging → auto-boot on completion ----
  async function onDirectoryPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = input.files;
    if (!files || !files.length) return;
    await runStaging(Array.from(files), 'directory', /*replace*/ true);
    input.value = '';
  }

  async function runStaging(files: File[], mode: 'directory' | 'files', replace: boolean) {
    setErrorMsg('');
    setBoot('staging');
    setProgressPct(0);
    setStatusMsg('');
    let success = false;
    try {
      const result = await stageFiles(files, {
        mode,
        replaceExisting: replace,
        sessionDirty: sessionDirty.current,
        onProgress: (p) => {
          const pct = p.totalBytes ? (p.bytes / p.totalBytes) * 100 : 100;
          setProgressPct(pct);
          const mb = (p.bytes / 1048576).toFixed(1);
          const totalMb = (p.totalBytes / 1048576).toFixed(1);
          setStatusMsg(`${p.done}/${p.total}  ${mb} / ${totalMb} MB  (${p.currentName})`);
        },
      });
      sessionDirty.current = true;
      setSummary(result.summary);
      setStatusMsg(`Staged ${result.staged} files (${(result.totalBytes / 1048576).toFixed(1)} MB) in ${result.durationSeconds.toFixed(1)}s.`);
      success = true;
    }
    catch (err) {
      setErrorMsg('Staging failed: ' + msg(err));
    }
    finally {
      if (!success && replace) sessionDirty.current = false;
      const idx = readIndex();
      const s = summarizeIndex(idx);
      setSummary(s);
      if (success && s.mapCount > 0) {
        // Auto-boot now that we have what we need.
        await tryBootEngine();
      }
      else if (success && s.mapCount === 0) {
        setStatusMsg('No map files were included. Re-pick your folder so a stock map (e.g. Echo Isles) is present.');
        setBoot('no-assets');
      }
      else {
        setBoot('no-assets');
      }
    }
  }

  // ---- Engine boot ----
  async function tryBootEngine() {
    if (bootInFlight.current) return;
    if (boot === 'running') return;
    bootInFlight.current = true;
    console.log('[EnginePage] tryBootEngine starting.');

    setBoot('running');
    setErrorMsg('');
    acquireWakeLock();

    const wrap = document.getElementById(canvasWrapId);
    if (wrap) wrap.style.display = 'flex';
    showSplash();

    const canvas = document.getElementById(canvasId);
    if (!(canvas instanceof HTMLCanvasElement)) {
      setErrorMsg(`Canvas element #${canvasId} not found in DOM.`);
      setBoot('no-assets');
      hideSplash();
      if (wrap) wrap.style.display = 'none';
      bootInFlight.current = false;
      return;
    }
    if (typeof OffscreenCanvas === 'undefined' || typeof canvas.transferControlToOffscreen !== 'function') {
      setErrorMsg('OffscreenCanvas is required but not supported by this browser.');
      setBoot('no-assets');
      hideSplash();
      if (wrap) wrap.style.display = 'none';
      bootInFlight.current = false;
      return;
    }

    try {
      const handle = bootEngineWorker({
        canvas,
        // Synchronous hand-off the moment the Worker is constructed.
        // We MUST attach the lobby bridge here (not after the
        // bootEngineWorker call returns) because handle.worker is
        // populated asynchronously inside the lib's loadHowlerOnce
        // callback, and the engine reaches the multiplayer-start
        // path almost instantly. Without this hook the worker boots
        // before main has replayed mp-ready / mp-peer-connected and
        // Java sees no selfId.
        onWorkerReady: (worker) => {
          window.__attachWorker?.(worker);
          transport.current?.attachEngineWorker(worker);
        },
        onMenuReady: () => {
          // Multiplayer: if a queued start is waiting, fire it now —
          // the engine has built MenuUI and is ready to receive
          // mp-start-as-{host,joiner}. The engine then transitions
          // through WarsmashGdxMenuScreen → WarsmashGdxMapScreen on
          // its own, masked by the splash overlay.
          menuReady.current = true;
          sendQueuedMultiplayerStart();
          // Splash stays up if a multiplayer start is pending — drops
          // once the engine reaches the actual map. Single-player
          // flow drops it here.
          if (!(window as any).__mpPendingStart) {
            hideSplash();
          }
        },
        onMapReached: () => {
          (window as any).__mpInMap = true;
          (window as any).__mpPendingStart = false;
          setMultiplayerLobbyVisible(false);
          hideSplash();
        },
        onError: (m) => setErrorMsg(m),
        onWorkerMessage: (data) => {
          if (!data || typeof data !== 'object') return;
          const d = data as { kind?: string };
          if (d.kind === 'mp-desync-report') {
            setDesync({
              turn: (d as any).turn,
              lobbyCode: (window as any).pokiBridgeCurrentLobby?.() ?? undefined,
              selfPeerId: (window as any).pokiBridgeSelfId?.() ?? undefined,
            });
          }
          else if (d.kind === 'mp-desync-combined-report') {
            setDesync(prev => ({
              ...(prev ?? {}),
              turn: (d as any).turn,
              combinedReport: (d as any).combinedReport,
              lobbyCode: prev?.lobbyCode ?? (window as any).pokiBridgeCurrentLobby?.() ?? undefined,
              selfPeerId: prev?.selfPeerId ?? (window as any).pokiBridgeSelfId?.() ?? undefined,
            }));
          }
        },
      });
      // handle.worker is still undefined here — populated inside the
      // loadHowlerOnce callback in the lib. The onWorkerReady hook
      // above is the right attachment point; we just retain the
      // handle object for any later cleanup logic.
      engineHandle.current = handle;
    }
    catch (err) {
      console.error('[EnginePage] Engine boot failed:', err);
      setErrorMsg('Engine boot failed: ' + msg(err));
      setBoot('no-assets');
      hideSplash();
      if (wrap) wrap.style.display = 'none';
      bootInFlight.current = false;
    }
  }

  function sendQueuedMultiplayerStart() {
    const payload = queuedMpStart.current;
    const worker = engineHandle.current?.worker;
    if (!menuReady.current || !payload || !worker) return;
    console.log('[EnginePage] sending multiplayer start payload to worker:', payload.kind);
    worker.postMessage(payload);
    queuedMpStart.current = null;
  }

  function startHostedMatch() {
    const started = startGame();
    if (!started) return;
    console.log('[EnginePage] host Start clicked.');
    setMultiplayerLobbyVisible(false);
  }

  const showOverlay = boot !== 'running';

  return (
    <>
      {launchConfig.mode === 'webrtc' && multiplayerLobbyVisible && (
        <MultiplayerRoomOverlay lobby={lobbyState} onStart={startHostedMatch} />
      )}
      {showOverlay && (
        <div class="boot-overlay">
          <div class="boot-overlay-card">
            {boot === 'loading' && <p class="boot-status">Reading staged install…</p>}

            {(boot === 'no-assets' || boot === 'staging') && (
              <>
                <h1>{summary.fileCount > 0 ? 'Update install' : 'First-time setup'}</h1>
                <p>
                  The engine boots from a Warcraft III install staged in private browser
                  storage (OPFS). Pick your folder once — after that, the engine loads
                  directly on every visit.
                </p>
                <div class="row">
                  <label
                    class={`fakebtn ${summary.fileCount > 0 ? 'secondary' : 'primary'}`}
                    for="dir-input"
                  >
                    {summary.fileCount > 0 ? 'Re-pick Warcraft III folder' : 'Select Warcraft III folder'}
                  </label>
                  <input
                    id="dir-input"
                    type="file"
                    /* @ts-expect-error — non-standard but supported in Chromium */
                    webkitdirectory
                    multiple
                    style={{ display: 'none' }}
                    disabled={boot === 'staging'}
                    onChange={onDirectoryPick}
                  />
                </div>
                {boot === 'staging' && (
                  <div class="progress">
                    <div class="progress-bar" style={{ width: progressPct.toFixed(1) + '%' }} />
                  </div>
                )}
                {summary.fileCount > 0 && (
                  <div class="boot-summary">{formatSummary(summary)}</div>
                )}
                {statusMsg && <div class="boot-status">{statusMsg}</div>}
                {errorMsg  && <div class="boot-error">{errorMsg}</div>}
              </>
            )}
          </div>
        </div>
      )}

      <DesyncOverlay
        payload={desync}
        onReload={() => location.reload()}
      />
    </>
  );
}

function MultiplayerRoomOverlay({ lobby, onStart }: { lobby: LobbyState; onStart: () => void }) {
  const mapLabel = lobby.mapInfo?.name || lobby.selectedMap;
  const selfSlot = lobby.slots.find((slot) => slot.occupant === lobby.selfId) ?? null;
  const racesLocked = lobby.mapInfo?.fixedPlayerSettings ?? false;
  const hasTeams = lobby.mapInfo?.useCustomForces === true && (lobby.mapInfo?.forces.length ?? 0) > 0;
  const occupiedCount = lobby.slots.filter((slot) => slot.occupant !== null).length;
  const peerCount = occupiedCount - (lobby.isHost ? 1 : 0);
  const canStart = lobby.isHost && peerCount >= 1;
  return (
    <div class="boot-overlay multiplayer-room-overlay">
      <div class="boot-overlay-card">
        <h1>{lobby.isHost ? 'Hosting multiplayer room' : 'Joining multiplayer room'}</h1>
        <p><strong>Room:</strong> {lobby.lobbyCode || 'connecting…'}</p>
        <p><strong>Map:</strong> {mapLabel}</p>

        <h2>Players</h2>
        <ul class="room-player-list">
          {lobby.players.map((player) => (
            <li key={player.peerId}>
              {player.name}
              {player.peerId === lobby.leaderId ? ' (host)' : ''}
            </li>
          ))}
        </ul>

        <h2>Slots</h2>
        <ul class="room-slot-list">
          {lobby.slots.map((slot) => {
            const occupant = lobby.players.find((p) => p.peerId === slot.occupant);
            const isSelf = slot.occupant === lobby.selfId;
            const canClaim = slot.occupant === null && isSlotJoinable(slot, lobby.mapInfo);
            const color = colorById(slot.color);
            return (
              <li key={slot.index}>
                <span class="room-slot-summary">
                  <span class="room-slot-title">Slot {slot.index + 1}: {occupant?.name ?? slotTypeLabel(slot.type)}</span>
                  {isSelf ? ' (you)' : ''}
                  <span class="room-slot-meta">
                    {raceLabel(slot.race)}
                    <span class="room-color-chip" style={{ backgroundColor: color.hex }} />
                    {color.name}
                    {hasTeams ? `, ${teamLabel(lobby, slot.team)}` : ''}
                    {`, ${slot.handicap}%`}
                  </span>
                </span>
                <div class="room-slot-actions">
                  {lobby.isHost && (
                    <select
                      class="room-slot-type-select"
                      value={slot.type}
                      onChange={(e) => updateSlot(slot.index, {
                        slotType: (e.currentTarget as HTMLSelectElement).value as LobbySlotType,
                      })}
                    >
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                      <option value="computer-newbie">Computer (Easy)</option>
                      <option value="computer-normal">Computer (Normal)</option>
                      <option value="computer-insane">Computer (Insane)</option>
                    </select>
                  )}
                  {canClaim && (
                    <button class="secondary room-slot-claim" onClick={() => requestSlot(slot.index)}>
                      Choose
                    </button>
                  )}
                </div>
                {lobby.isHost && (
                  <SlotConfigControls
                    lobby={lobby}
                    slot={slot}
                    racesLocked={racesLocked}
                    hasTeams={hasTeams}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {selfSlot && !lobby.isHost && (
          <div class="room-self-config">
            <h2>Your side</h2>
            <SlotConfigControls
              lobby={lobby}
              slot={selfSlot}
              racesLocked={racesLocked}
              hasTeams={hasTeams}
            />
          </div>
        )}

        {lobby.lastError && <p class="error">{lobby.lastError}</p>}

        {lobby.isHost
          ? <button class="primary" disabled={!lobby.lobbyCode || !canStart} onClick={onStart}>Start</button>
          : <p>Waiting for host to start the match…</p>}
      </div>
    </div>
  );
}

function SlotConfigControls({
  lobby,
  slot,
  racesLocked,
  hasTeams,
}: {
  lobby: LobbyState;
  slot: LobbyState['slots'][number];
  racesLocked: boolean;
  hasTeams: boolean;
}) {
  return (
    <div class="room-slot-config">
      <label>
        Race
        <select
          value={slot.race}
          disabled={racesLocked}
          onChange={(e) => updateSlot(slot.index, {
            race: Number((e.currentTarget as HTMLSelectElement).value) as PlayerRace,
          })}
        >
          {[
            PlayerRace.Selectable,
            PlayerRace.Human,
            PlayerRace.Orc,
            PlayerRace.Undead,
            PlayerRace.NightElf,
          ].map((race) => <option key={race} value={race}>{raceLabel(race)}</option>)}
        </select>
      </label>
      <label>
        Color
        <select
          value={slot.color}
          onChange={(e) => updateSlot(slot.index, {
            color: Number((e.currentTarget as HTMLSelectElement).value),
          })}
        >
          {PLAYER_COLORS.map((color) => (
            <option key={color.id} value={color.id}>{color.name}</option>
          ))}
        </select>
      </label>
      {hasTeams && (
        <label>
          Team
          <select
            value={slot.team}
            disabled={racesLocked}
            onChange={(e) => updateSlot(slot.index, {
              team: Number((e.currentTarget as HTMLSelectElement).value),
            })}
          >
            <option value={-1}>None</option>
            {lobby.mapInfo?.forces.map((force, index) => (
              <option key={index} value={index}>{force.name || `Team ${index + 1}`}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Handicap
        <select
          value={slot.handicap}
          onChange={(e) => updateSlot(slot.index, {
            handicap: Number((e.currentTarget as HTMLSelectElement).value),
          })}
        >
          {HANDICAP_VALUES.map((value) => (
            <option key={value} value={value}>{value}%</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function teamLabel(lobby: LobbyState, team: number): string {
  if (team < 0) return 'No team';
  return lobby.mapInfo?.forces[team]?.name || `Team ${team + 1}`;
}

function slotTypeLabel(type: LobbySlotType): string {
  switch (type) {
  case 'closed': return 'Closed';
  case 'computer-newbie': return 'Computer (Easy)';
  case 'computer-normal': return 'Computer (Normal)';
  case 'computer-insane': return 'Computer (Insane)';
  case 'open':
  default: return 'Open';
  }
}

/** One-time legacy cleanup: the presence of OPFS /extracted/ marks an
 *  install staged by the previous main-thread engine. The old /w3
 *  layout from that era doesn't always boot cleanly under the engine-
 *  worker (esp. on iOS Safari). Wipe and have the user re-pick.
 *  Remove this in a release or two once most users have migrated. */
async function purgeLegacyExtractedDir(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    let hasLegacy = false;
    try { await root.getDirectoryHandle('extracted'); hasLegacy = true; }
    catch { /* not present */ }
    if (!hasLegacy) return;
    await clearOpfs();
    writeIndex([]);
  }
  catch (e) {
    console.warn('legacy cleanup failed:', e);
  }
}

function msg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
