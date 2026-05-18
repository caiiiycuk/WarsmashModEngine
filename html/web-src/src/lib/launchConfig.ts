export type LaunchMode = 'single' | 'webrtc';
export type MultiplayerRole = 'host' | 'client';

export interface LaunchSlotConfig {
  index: number;
  type?: 'open' | 'closed';
  race?: number;
  color?: number;
  team?: number;
  handicap?: number;
}

export interface LaunchConfig {
  mode: LaunchMode;
  room?: string;
  role?: MultiplayerRole;
  map?: string;
  slots?: LaunchSlotConfig[];
}

export type LaunchConfigParseResult =
  | { ok: true; config: LaunchConfig }
  | { ok: false; errors: string[] };

export function parseLaunchConfig(search: string): LaunchConfigParseResult {
  const p = new URLSearchParams(search);
  const errors: string[] = [];
  const modeRaw = p.get('mode') ?? 'single';
  if (modeRaw !== 'single' && modeRaw !== 'webrtc') {
    errors.push('mode must be "single" or "webrtc".');
  }

  const map = clean(p.get('map'));
  let room: string | undefined;
  let role: MultiplayerRole | undefined;
  let slots: LaunchSlotConfig[] | undefined;

  if (modeRaw === 'webrtc') {
    room = clean(p.get('room'));
    const roleRaw = clean(p.get('role'));
    if (!room) errors.push('room is required when mode=webrtc.');
    if (!roleRaw) errors.push('role is required when mode=webrtc.');
    else if (roleRaw !== 'host' && roleRaw !== 'client') errors.push('role must be "host" or "client".');
    else role = roleRaw;
    if (role === 'host' && !map) errors.push('map is required when mode=webrtc&role=host.');
    slots = parseSlots(p.get('slots'), errors);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      mode: modeRaw as LaunchMode,
      ...(room ? { room } : {}),
      ...(role ? { role } : {}),
      ...(map ? { map } : {}),
      ...(slots?.length ? { slots } : {}),
    },
  };
}

function clean(v: string | null): string | undefined {
  const s = v?.trim();
  return s || undefined;
}

function parseSlots(raw: string | null, errors: string[]): LaunchSlotConfig[] | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('not an array');
    return value.map((entry, i) => {
      if (!entry || typeof entry !== 'object' || !Number.isInteger(entry.index)) {
        throw new Error(`entry ${i} must contain an integer index`);
      }
      return entry as LaunchSlotConfig;
    });
  }
  catch (e) {
    errors.push(`slots must be a JSON array of slot configs (${e instanceof Error ? e.message : String(e)}).`);
    return undefined;
  }
}
