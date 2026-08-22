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
