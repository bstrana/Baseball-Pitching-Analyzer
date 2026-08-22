export type PitchType =
  | 'Fastball'
  | 'Curveball'
  | 'Slider'
  | 'Changeup'
  | 'Cutter'
  | 'Sinker'
  | 'Splitter'
  | 'Knuckleball'
  | 'Forkball'
  | 'Screwball';

export type PitcherHandedness = 'right' | 'left';

export type MissResult = 'on-target' | 'good-miss' | 'bad-miss';

export interface KinematicFrame {
  time: number;
  hip: number;
  shoulder: number;
  wrist: number;
}

export interface Pitch {
  id: string;
  number: number;
  type: PitchType;
  velocity: number; // in mph
  x: number; // percentage of canvas width (0 to 1)
  y: number; // percentage of canvas height (0 to 1)
  isStrike: boolean;
  zone: string; // "Zone 1" - "Zone 9" or Ball location descriptions like "High-Outside"
  timestamp: Date;
  kinematicsData?: KinematicFrame[];
  // Target Mode (optional - only present when a target was set before this pitch)
  targetX?: number; // percentage of canvas width (0 to 1)
  targetY?: number; // percentage of canvas height (0 to 1)
  missResult?: MissResult;
  targetZoneLabel?: string;
  pitchZoneLabel?: string;
  badShape?: boolean; // manually flagged execution miss (flat curve, hanging slider, etc.)
}

export interface StrikeZoneConfig {
  x: number; // 0 to 1, top-left horizontal position
  y: number; // 0 to 1, top-left vertical position
  width: number; // 0 to 1, width of strike zone
  height: number; // 0 to 1, height of strike zone
}

export function classifyPitch(x: number, y: number, config: StrikeZoneConfig): { isStrike: boolean; zone: string } {
  const isStrike = x >= config.x && x <= (config.x + config.width) && y >= config.y && y <= (config.y + config.height);

  if (isStrike) {
    // Calculate sub-zone (3x3 grid)
    const relX = (x - config.x) / config.width;
    const relY = (y - config.y) / config.height;

    // Col index: 0, 1, 2
    const col = Math.min(Math.floor(relX * 3), 2);
    // Row index: 0, 1, 2 (0 is top, 2 is bottom)
    const row = Math.min(Math.floor(relY * 3), 2);

    const zoneNumber = row * 3 + col + 1;
    const zoneLabels = [
      'High-Inside (Zone 1)', 'High-Middle (Zone 2)', 'High-Outside (Zone 3)',
      'Middle-Inside (Zone 4)', 'Middle-Middle (Zone 5)', 'Middle-Outside (Zone 6)',
      'Low-Inside (Zone 7)', 'Low-Middle (Zone 8)', 'Low-Outside (Zone 9)'
    ];
    return {
      isStrike: true,
      zone: zoneLabels[zoneNumber - 1] || `Zone ${zoneNumber}`
    };
  } else {
    // Outside the strike zone
    const isAbove = y < config.y;
    const isBelow = y > (config.y + config.height);
    const isLeft = x < config.x;
    const isRight = x > (config.x + config.width);

    if (isAbove && isLeft) return { isStrike: false, zone: 'High-Inside Ball' };
    if (isAbove && isRight) return { isStrike: false, zone: 'High-Outside Ball' };
    if (isAbove) return { isStrike: false, zone: 'High Ball' };
    if (isBelow && isLeft) return { isStrike: false, zone: 'Low-Inside Ball' };
    if (isBelow && isRight) return { isStrike: false, zone: 'Low-Outside Ball' };
    if (isBelow) return { isStrike: false, zone: 'Low Ball' };
    if (isLeft) return { isStrike: false, zone: 'Inside Ball' };
    if (isRight) return { isStrike: false, zone: 'Outside Ball' };

    return { isStrike: false, zone: 'Ball' };
  }
}

// --- Target Mode ---
//
// A finer-grained 5x5 grid (row/col each range -1..3) used purely for
// target-vs-pitch distance comparison. It is not shown to the user directly -
// getTargetZoneLabel() below renders it as a handedness-aware phrase, and
// classifyMiss() uses Chebyshev distance between cells to grade a miss.
function zoneCell(x: number, y: number, config: StrikeZoneConfig): { row: number; col: number } {
  const relX = (x - config.x) / config.width;
  const relY = (y - config.y) / config.height;

  const col = relX < 0 ? -1 : relX > 1 ? 3 : Math.min(Math.floor(relX * 3), 2);
  const row = relY < 0 ? -1 : relY > 1 ? 3 : Math.min(Math.floor(relY * 3), 2);

  return { row, col };
}

function verticalWord(row: number): 'high' | 'middle' | 'low' {
  if (row <= 0) return 'high';
  if (row === 1) return 'middle';
  return 'low';
}

function horizontalWord(col: number, handedness: PitcherHandedness): 'glove side' | 'arm side' | 'middle' {
  // Camera assumed to face the pitcher (catcher/umpire view). For a
  // right-handed pitcher the glove side appears on screen-right; mirrored
  // for a left-handed pitcher.
  const gloveOnScreenRight = handedness === 'right';
  const onRight = col >= 2;
  const onLeft = col <= 0;
  if ((gloveOnScreenRight && onRight) || (!gloveOnScreenRight && onLeft)) return 'glove side';
  if ((gloveOnScreenRight && onLeft) || (!gloveOnScreenRight && onRight)) return 'arm side';
  return 'middle';
}

// Handedness-aware, human-readable label for a canvas position, e.g.
// "Glove Side Low Strike", "Middle Ball", "Arm Side High Ball".
export function getTargetZoneLabel(x: number, y: number, config: StrikeZoneConfig, handedness: PitcherHandedness): string {
  const { row, col } = zoneCell(x, y, config);
  const h = horizontalWord(col, handedness);
  const v = verticalWord(row);
  const inZone = row >= 0 && row <= 2 && col >= 0 && col <= 2;
  const suffix = inZone ? 'Strike' : 'Ball';

  const parts: string[] = [];
  if (h !== 'middle') parts.push(h);
  if (v !== 'middle') parts.push(v);
  if (parts.length === 0) parts.push('middle');

  return parts
    .concat(suffix)
    .map(word => word.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '))
    .join(' ');
}

// Compares a target location to where the pitch actually landed. "On
// target" means the same grid cell; a miss into a neighboring cell (one
// step away, including diagonally) is a "good miss"; anything farther is a
// "bad miss".
export function classifyMiss(targetX: number, targetY: number, pitchX: number, pitchY: number, config: StrikeZoneConfig): MissResult {
  const target = zoneCell(targetX, targetY, config);
  const pitch = zoneCell(pitchX, pitchY, config);
  const distance = Math.max(Math.abs(target.row - pitch.row), Math.abs(target.col - pitch.col));

  if (distance === 0) return 'on-target';
  if (distance === 1) return 'good-miss';
  return 'bad-miss';
}
