import type { LaunchConfig } from './launchConfig';
import type { StartPayload } from './lobbyClient';

export interface MultiplayerTransport {
  start(): Promise<StartPayload>;
  attachEngineWorker(worker: Worker): void;
  dispose(): void;
}

export async function createMultiplayerTransport(config: LaunchConfig): Promise<MultiplayerTransport> {
  if (config.mode !== 'webrtc' || !config.room || !config.role || !config.map) {
    throw new Error('multiplayer transport requires a validated webrtc LaunchConfig');
  }
  return new PokiMultiplayerTransport({ ...config, room: config.room, role: config.role, map: config.map });
}

class PokiMultiplayerTransport implements MultiplayerTransport {
  private disposed = false;
  private detachStartListener: (() => void) | null = null;
  constructor(private readonly config: Required<Pick<LaunchConfig, 'room' | 'role' | 'map'>> & LaunchConfig) {}

  async start(): Promise<StartPayload> {
    const lobby = await import('./lobbyClient');
    await waitUntil(() => lobby.getLobbyState().ready || lobby.getLobbyState().bridgeFailed, 'netlib ready');
    if (lobby.getLobbyState().bridgeFailed) throw new Error(lobby.getLobbyState().lastError || 'multiplayer transport unavailable');

    if (this.config.role === 'client') {
      await lobby.joinLobby(this.config.room);
      return new Promise<StartPayload>((resolve) => {
        const existing = lobby.getPendingStartFromHost();
        if (existing) { resolve(lobby.buildJoinerStartPayload(existing)); return; }
        this.detachStartListener = lobby.onStartFromHost((m) => resolve(lobby.buildJoinerStartPayload(m)));
      });
    }

    const actualRoom = await lobby.createLobby({ mapPath: this.config.map });
    if (actualRoom !== this.config.room) {
      console.warn(`[multiplayer] transport created room ${actualRoom}; requested room was ${this.config.room}. Current Poki transport cannot choose room ids.`);
    }
    for (const slot of this.config.slots ?? []) {
      lobby.updateSlot(slot.index, {
        ...(slot.type ? { slotType: slot.type } : {}),
        ...(slot.race !== undefined ? { race: slot.race } : {}),
        ...(slot.color !== undefined ? { color: slot.color } : {}),
        ...(slot.team !== undefined ? { team: slot.team } : {}),
        ...(slot.handicap !== undefined ? { handicap: slot.handicap } : {}),
      });
    }
    const started = lobby.startGame();
    if (!started) throw new Error('host could not create multiplayer start payload');
    return lobby.buildHostStartPayload(started.mapPath, started.selfId, started.hostToken, started.sessionTokens, started.slotConfigs);
  }

  attachEngineWorker(worker: Worker): void {
    void import('./lobbyClient').then((lobby) => lobby.attachEngineWorker(worker));
  }

  dispose(): void {
    this.disposed = true;
    this.detachStartListener?.();
  }
}

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 15_000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
