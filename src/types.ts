export type PitchType =
  | 'Four-Seam Fastball'
  | 'Two-Seam Fastball'
  | 'Cutter'
  | 'Changeup'
  | 'Curveball'
  | 'Slider'
  | 'Slurve'
  | 'Sweeper'
  | 'Splitter'
  | 'Forkball'
  | 'Knuckleball';

export type PitchCategory = 'Fastball' | 'Off-Speed' | 'Breaking Ball';

export interface PitchTypeInfo {
  abbreviation: string;
  category: PitchCategory;
  hexColor: string;
  // Tailwind classes for colored badges - kept as literal strings (not
  // built from hexColor at runtime) so Tailwind's scanner can see them.
  badgeClass: string;
}

// Single source of truth for pitch type metadata, shared by the pitch type
// selector, session log, legend, and canvas markers.
export const PITCH_TYPE_INFO: Record<PitchType, PitchTypeInfo> = {
  'Four-Seam Fastball': { abbreviation: 'FF', category: 'Fastball', hexColor: '#ef4444', badgeClass: 'bg-red-500 text-white border-red-400' },
  'Two-Seam Fastball': { abbreviation: 'FT', category: 'Fastball', hexColor: '#ec4899', badgeClass: 'bg-pink-500 text-white border-pink-400' },
  'Cutter': { abbreviation: 'FC', category: 'Fastball', hexColor: '#a855f7', badgeClass: 'bg-purple-500 text-white border-purple-400' },
  'Changeup': { abbreviation: 'CH', category: 'Off-Speed', hexColor: '#10b981', badgeClass: 'bg-emerald-500 text-white border-emerald-400' },
  'Curveball': { abbreviation: 'CB', category: 'Breaking Ball', hexColor: '#3b82f6', badgeClass: 'bg-blue-500 text-white border-blue-400' },
  'Slider': { abbreviation: 'SL', category: 'Breaking Ball', hexColor: '#f59e0b', badgeClass: 'bg-amber-500 text-white border-amber-400' },
  'Slurve': { abbreviation: 'SV', category: 'Breaking Ball', hexColor: '#8b5cf6', badgeClass: 'bg-violet-500 text-white border-violet-400' },
  'Sweeper': { abbreviation: 'SW', category: 'Breaking Ball', hexColor: '#14b8a6', badgeClass: 'bg-teal-500 text-white border-teal-400' },
  'Splitter': { abbreviation: 'SF', category: 'Off-Speed', hexColor: '#06b6d4', badgeClass: 'bg-cyan-500 text-white border-cyan-400' },
  'Forkball': { abbreviation: 'FO', category: 'Off-Speed', hexColor: '#f97316', badgeClass: 'bg-orange-500 text-white border-orange-400' },
  'Knuckleball': { abbreviation: 'KN', category: 'Off-Speed', hexColor: '#84cc16', badgeClass: 'bg-lime-500 text-white border-lime-400' },
};

// Canonical display order: fastballs, then breaking balls, then off-speed -
// matches how pitchers typically build a repertoire.
export const PITCH_TYPES: PitchType[] = [
  'Four-Seam Fastball', 'Two-Seam Fastball', 'Cutter',
  'Curveball', 'Slider', 'Slurve', 'Sweeper',
  'Changeup', 'Splitter', 'Forkball', 'Knuckleball',
];

export type PitcherHandedness = 'right' | 'left';

// Mechanics Tracker (pose analysis only), Pitch Tracker (strike zone +
// location), or Split Test (velocity comparison across mechanical tweaks,
// no location) - the three top-level modes selectable from the nav bar.
export type AppMode = 'mechanics' | 'pitching' | 'splitTest';

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

// --- Split Test Mode ---
//
// A Group is a mechanical variable a coach wants to isolate (e.g. "Foot on
// Rubber"); each Group holds a small number of Sets - the specific tweaks
// being compared (e.g. "Inward" / "Neutral" / "Outward"). Split Test Mode
// has no pitch location: each logged pitch just tags a velocity reading
// with whichever Group/Set was active, so sets within a group can be
// compared on average/max velocity to see which tweak is worth promoting
// into the pitcher's actual mechanics.
export interface SplitTestSet {
  id: string;
  name: string;
}

export interface SplitTestGroup {
  id: string;
  name: string;
  sets: SplitTestSet[];
}

// groupName/setName are denormalized (copied at log time) so a pitch's
// history stays meaningful even after its group or set is later renamed
// or deleted.
export interface SplitTestPitch {
  id: string;
  number: number;
  groupId: string;
  groupName: string;
  setId: string;
  setName: string;
  velocity: number; // mph
  timestamp: Date;
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
