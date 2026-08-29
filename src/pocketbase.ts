import PocketBase from 'pocketbase';
import { Pitch, KinematicFrame, StrikeZoneConfig, SplitTestGroup, SplitTestPitch } from './types';
import { PoseMetrics } from './components/PoseDetector';
import { keycloak, keycloakEnabled } from './auth';

// Reverse-proxied by nginx (see cloudron/nginx.conf) so this is always
// same-origin - no separate URL/API key to configure, unlike Keycloak.
export const pb = new PocketBase('/pb');

// Attaches the coach's Keycloak access token to every PocketBase request so
// pb_hooks/keycloak_auth.pb.js can verify it (against Keycloak's own
// /userinfo endpoint) and scope players/mechanics_sessions/pitch_sessions
// to that coach - see pb_migrations/1700000200_coach_auth.js for the rules
// this enforces. Without this header, every request to those collections
// is rejected by the backend regardless of what the UI shows.
pb.beforeSend = (url, options) => {
  if (keycloakEnabled && keycloak?.token) {
    options.headers = { ...options.headers, Authorization: `Bearer ${keycloak.token}` };
  }
  return { url, options };
};

export interface Player {
  id: string;
  name: string;
  position: string;
  height_in: number;
  weight_lb: number;
  wingspan_in: number;
  notes: string;
  owner_sub: string;
  created: string;
  updated: string;
}

export interface MechanicsSessionRecord {
  id: string;
  player: string;
  camera_view: 'side' | 'front' | 'back';
  metrics: PoseMetrics;
  kinematics_data: KinematicFrame[];
  notes: string;
  location: string;
  duration_seconds: number;
  recorded_at: string;
  created: string;
}

export interface PitchSessionRecord {
  id: string;
  player: string;
  strike_zone_config: StrikeZoneConfig;
  pitches: Pitch[];
  total_pitches: number;
  strikes: number;
  avg_velocity: number;
  max_velocity: number;
  notes: string;
  location: string;
  duration_seconds: number;
  recorded_at: string;
  created: string;
}

export interface SplitTestSessionRecord {
  id: string;
  player: string;
  groups: SplitTestGroup[];
  pitches: SplitTestPitch[];
  total_pitches: number;
  avg_velocity: number;
  max_velocity: number;
  notes: string;
  location: string;
  duration_seconds: number;
  recorded_at: string;
  created: string;
}

export async function listPlayers(): Promise<Player[]> {
  return pb.collection('players').getFullList<Player>({ sort: 'name' });
}

export async function createPlayer(data: {
  name: string;
  position?: string;
  height_in?: number;
  weight_lb?: number;
  wingspan_in?: number;
  notes?: string;
  owner_sub?: string;
}): Promise<Player> {
  return pb.collection('players').create<Player>(data);
}

export async function updatePlayer(id: string, data: Partial<Omit<Player, 'id' | 'created' | 'updated'>>): Promise<Player> {
  return pb.collection('players').update<Player>(id, data);
}

export async function deletePlayer(id: string): Promise<void> {
  await pb.collection('players').delete(id);
}

export async function saveMechanicsSession(data: {
  player: string;
  camera_view: 'side' | 'front' | 'back';
  metrics: PoseMetrics;
  kinematics_data: KinematicFrame[];
  notes?: string;
  location?: string;
  duration_seconds?: number;
}): Promise<MechanicsSessionRecord> {
  return pb.collection('mechanics_sessions').create<MechanicsSessionRecord>({
    ...data,
    recorded_at: new Date().toISOString(),
  });
}

export async function savePitchSession(data: {
  player: string;
  strike_zone_config: StrikeZoneConfig;
  pitches: Pitch[];
  notes?: string;
  location?: string;
  duration_seconds?: number;
}): Promise<PitchSessionRecord> {
  const strikes = data.pitches.filter(p => p.isStrike).length;
  const speeds = data.pitches.map(p => p.velocity);
  const avg_velocity = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
  const max_velocity = speeds.length ? Math.max(...speeds) : 0;

  return pb.collection('pitch_sessions').create<PitchSessionRecord>({
    ...data,
    total_pitches: data.pitches.length,
    strikes,
    avg_velocity,
    max_velocity,
    recorded_at: new Date().toISOString(),
  });
}

export async function saveSplitTestSession(data: {
  player: string;
  groups: SplitTestGroup[];
  pitches: SplitTestPitch[];
  notes?: string;
  location?: string;
  duration_seconds?: number;
}): Promise<SplitTestSessionRecord> {
  const speeds = data.pitches.map(p => p.velocity);
  const avg_velocity = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
  const max_velocity = speeds.length ? Math.max(...speeds) : 0;

  return pb.collection('split_test_sessions').create<SplitTestSessionRecord>({
    ...data,
    total_pitches: data.pitches.length,
    avg_velocity,
    max_velocity,
    recorded_at: new Date().toISOString(),
  });
}

export async function listSplitTestSessions(playerId: string): Promise<SplitTestSessionRecord[]> {
  return pb.collection('split_test_sessions').getFullList<SplitTestSessionRecord>({
    filter: pb.filter('player = {:playerId}', { playerId }),
    sort: '-recorded_at',
  });
}

export async function listMechanicsSessions(playerId: string): Promise<MechanicsSessionRecord[]> {
  return pb.collection('mechanics_sessions').getFullList<MechanicsSessionRecord>({
    filter: pb.filter('player = {:playerId}', { playerId }),
    sort: '-recorded_at',
  });
}

export async function listPitchSessions(playerId: string): Promise<PitchSessionRecord[]> {
  return pb.collection('pitch_sessions').getFullList<PitchSessionRecord>({
    filter: pb.filter('player = {:playerId}', { playerId }),
    sort: '-recorded_at',
  });
}

// Combined mechanics + pitch + split-test session count for one player, for
// the roster list - uses getList(1, 1) so PocketBase only has to report
// totalItems rather than the full record set.
export async function getPlayerSessionCount(playerId: string): Promise<number> {
  const filter = pb.filter('player = {:playerId}', { playerId });
  const [mechanics, pitch, splitTest] = await Promise.all([
    pb.collection('mechanics_sessions').getList(1, 1, { filter, fields: 'id' }),
    pb.collection('pitch_sessions').getList(1, 1, { filter, fields: 'id' }),
    pb.collection('split_test_sessions').getList(1, 1, { filter, fields: 'id' }),
  ]);
  return mechanics.totalItems + pitch.totalItems + splitTest.totalItems;
}

// Same combined count as getPlayerSessionCount, but for the whole roster at
// once - 3 requests total (one per collection) instead of 3 per player, so
// the roster list doesn't fire O(players) requests every time it loads.
export async function getPlayerSessionCounts(playerIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (playerIds.length === 0) return counts;

  const filter = playerIds.map(id => pb.filter('player = {:id}', { id })).join(' || ');
  const [mechanics, pitch, splitTest] = await Promise.all([
    pb.collection('mechanics_sessions').getFullList<{ player: string }>({ filter, fields: 'player' }),
    pb.collection('pitch_sessions').getFullList<{ player: string }>({ filter, fields: 'player' }),
    pb.collection('split_test_sessions').getFullList<{ player: string }>({ filter, fields: 'player' }),
  ]);
  for (const record of [...mechanics, ...pitch, ...splitTest]) {
    counts[record.player] = (counts[record.player] ?? 0) + 1;
  }
  return counts;
}
