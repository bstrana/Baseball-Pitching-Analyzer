import React from 'react';
import { Pitch, PitchType, PitchCategory, StrikeZoneConfig, PitcherHandedness, PITCH_TYPE_INFO, PITCH_TYPES } from '../types';
import { Target, Trash2, Gauge, RotateCcw, Sliders, Eye, EyeOff, Lock, Unlock, Crosshair, Flag, RefreshCw } from 'lucide-react';
import { PitchVelocityChart } from './PitchVelocityChart';

// Shared between the type selector and the pitch log table below - see
// PITCH_TYPE_INFO in types.ts for the abbreviation/category/color backing
// each pitch type.
function getPitchColor(type: PitchType) {
  return PITCH_TYPE_INFO[type].badgeClass;
}

function getPitchAbbreviation(type: PitchType) {
  return PITCH_TYPE_INFO[type].abbreviation;
}

const PITCH_CATEGORY_ORDER: PitchCategory[] = ['Fastball', 'Breaking Ball', 'Off-Speed'];

function getMissResultStyle(result: Pitch['missResult']) {
  switch (result) {
    case 'on-target': return { label: 'On Target', className: 'text-emerald-400' };
    case 'good-miss': return { label: 'Good Miss', className: 'text-amber-400' };
    case 'bad-miss': return { label: 'Bad Miss', className: 'text-red-400' };
    default: return null;
  }
}

interface PitchTrackerProps {
  pitches: Pitch[];
  config: StrikeZoneConfig;
  onConfigChange: (config: StrikeZoneConfig) => void;
  showStrikeZone: boolean;
  setShowStrikeZone: (show: boolean) => void;
  strikeZoneLocked: boolean;
  setStrikeZoneLocked: (locked: boolean) => void;
  showPitchSpeeds: boolean;
  setShowPitchSpeeds: (show: boolean) => void;
  currentPitchType: PitchType;
  setCurrentPitchType: (type: PitchType) => void;
  currentPitchSpeed: number;
  setCurrentPitchSpeed: (speed: number) => void;
  targetMode: boolean;
  setTargetMode: (enabled: boolean) => void;
  pitcherHandedness: PitcherHandedness;
  setPitcherHandedness: (handedness: PitcherHandedness) => void;
}

function PitchTrackerBase({
  pitches,
  config,
  onConfigChange,
  showStrikeZone,
  setShowStrikeZone,
  strikeZoneLocked,
  setStrikeZoneLocked,
  showPitchSpeeds,
  setShowPitchSpeeds,
  currentPitchType,
  setCurrentPitchType,
  currentPitchSpeed,
  setCurrentPitchSpeed,
  targetMode,
  setTargetMode,
  pitcherHandedness,
  setPitcherHandedness,
}: PitchTrackerProps) {
  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto pr-1">
      {/* Pitch Type Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-sky-400" />
            <h3 className="font-semibold text-sm text-white">PITCH CALIBRATION</h3>
          </div>
          <div className="flex items-center flex-wrap gap-1.5">
            <button
              onClick={() => setShowStrikeZone(!showStrikeZone)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors ${showStrikeZone ? 'bg-sky-950/40 border-sky-500/50 text-sky-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              {showStrikeZone ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {showStrikeZone ? 'Zone Visible' : 'Zone Hidden'}
            </button>
            <button
              onClick={() => setStrikeZoneLocked(!strikeZoneLocked)}
              title={strikeZoneLocked
                ? 'Zone locked - canvas clicks only plot pitches. Unlock to drag/resize the zone.'
                : 'Zone unlocked - canvas clicks drag/resize the zone. Lock it once positioned to plot pitches instead.'}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors ${strikeZoneLocked ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              {strikeZoneLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              {strikeZoneLocked ? 'Zone Locked' : 'Zone Unlocked'}
            </button>
            <button
              onClick={() => setShowPitchSpeeds(!showPitchSpeeds)}
              title={showPitchSpeeds ? 'Hide MPH on plotted pitches' : 'Show MPH on plotted pitches'}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors ${showPitchSpeeds ? 'bg-sky-950/40 border-sky-500/50 text-sky-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              <Gauge className="w-3.5 h-3.5" />
              {showPitchSpeeds ? 'Speed On' : 'Speed Off'}
            </button>
            <button
              onClick={() => setTargetMode(!targetMode)}
              title={targetMode
                ? 'Target Mode on - tap the video canvas to plant a target, then tap again where the pitch lands to grade it.'
                : 'Target Mode off - tap the video canvas to plant a target before each pitch and grade misses against it.'}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors ${targetMode ? 'bg-amber-950/40 border-amber-500/50 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              {targetMode ? 'Target Mode On' : 'Target Mode Off'}
            </button>
            <button
              onClick={() => setPitcherHandedness(pitcherHandedness === 'right' ? 'left' : 'right')}
              title="Pitcher's throwing hand - only relabels Target Mode's glove side / arm side, doesn't change zone geometry."
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border bg-slate-800 border-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Throws {pitcherHandedness === 'right' ? 'R' : 'L'}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block">Select Pitch Type</label>
          {PITCH_CATEGORY_ORDER.map((category) => {
            const typesInCategory = PITCH_TYPES.filter((type) => PITCH_TYPE_INFO[type].category === category);
            return (
              <div key={category}>
                <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest block mb-1">{category}</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {typesInCategory.map((type) => (
                    <button
                      key={type}
                      onClick={() => setCurrentPitchType(type)}
                      title={type}
                      className={`py-1.5 px-1 rounded text-center border transition-all ${
                        currentPitchType === type
                          ? 'bg-sky-600 border-sky-400 text-white shadow-md shadow-sky-600/20'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      }`}
                    >
                      <span className="block text-xs font-bold leading-tight">{PITCH_TYPE_INFO[type].abbreviation}</span>
                      <span className="block text-[9px] font-semibold leading-tight truncate opacity-80">{type}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Velocity trend (Speed on) or strike/ball mix by type (Speed off) -
          pitch location is already plotted live on the video canvas itself,
          so this panel shows something that isn't */}
      <PitchVelocityChart pitches={pitches} showSpeeds={showPitchSpeeds} />

      {/* Pitch Velocity & Zone Calibration */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Pitch Velocity (MPH)</label>
            <span className="text-sm font-mono text-sky-400 font-bold">{currentPitchSpeed} MPH</span>
          </div>
          <input
            type="range"
            min="50"
            max="105"
            value={currentPitchSpeed}
            onChange={(e) => setCurrentPitchSpeed(Number(e.target.value))}
            className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-slate-500 font-mono mt-1">
            <span>50 MPH</span>
            <span>85 MPH</span>
            <span>105 MPH</span>
          </div>
        </div>

        {/* Calibration Sliders */}
        <div className="border-t border-slate-800/80 mt-4 pt-4 space-y-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Sliders className="w-4 h-4 text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Adjust Zone Overlay Position</span>
          </div>

          <div>
            <div className="flex justify-between text-[9px] text-slate-400 font-mono mb-1">
              <span>Horizontal Offset (X)</span>
              <span>{Math.round(config.x * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.8"
              step="0.01"
              value={config.x}
              onChange={(e) => onConfigChange({ ...config, x: Number(e.target.value) })}
              className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between text-[9px] text-slate-400 font-mono mb-1">
              <span>Vertical Offset (Y)</span>
              <span>{Math.round(config.y * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.8"
              step="0.01"
              value={config.y}
              onChange={(e) => onConfigChange({ ...config, y: Number(e.target.value) })}
              className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-[9px] text-slate-400 font-mono mb-1">
                <span>Width</span>
                <span>{Math.round(config.width * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.5"
                step="0.01"
                value={config.width}
                onChange={(e) => onConfigChange({ ...config, width: Number(e.target.value) })}
                className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between text-[9px] text-slate-400 font-mono mb-1">
                <span>Height</span>
                <span>{Math.round(config.height * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.6"
                step="0.01"
                value={config.height}
                onChange={(e) => onConfigChange({ ...config, height: Number(e.target.value) })}
                className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PitchLogProps {
  pitches: Pitch[];
  onRemovePitch: (id: string) => void;
  onClearPitches: () => void;
  selectedPitchId: string | null;
  setSelectedPitchId: (id: string | null) => void;
  onToggleBadShape: (id: string) => void;
}

export function PitchLog({
  pitches,
  onRemovePitch,
  onClearPitches,
  selectedPitchId,
  setSelectedPitchId,
  onToggleBadShape,
}: PitchLogProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col h-full min-h-[220px]">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-sky-400" />
          <h3 className="font-semibold text-sm text-white">SESSION PITCH LOG</h3>
        </div>
        {pitches.length > 0 && (
          <button
            onClick={onClearPitches}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Log
          </button>
        )}
      </div>

      {/* Logs Table */}
      <div className="flex-1 overflow-y-auto pr-0.5 border border-slate-800 bg-slate-950/20 rounded-lg min-h-0">
        {pitches.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500">
            <Target className="w-8 h-8 text-slate-700 mb-2 animate-pulse" />
            <p className="text-xs font-semibold uppercase tracking-wider">No pitches logged</p>
            <p className="text-[10px] text-slate-600 mt-1 max-w-[180px]">
              Click on the main video feed to log a pitch.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-[10px] text-slate-500 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-800">
              <tr>
                <th className="py-2 px-3">#</th>
                <th className="py-2 px-2">Type</th>
                <th className="py-2 px-2">MPH</th>
                <th className="py-2 px-2">Location</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {[...pitches].reverse().map((pitch) => {
                const isHovered = selectedPitchId === pitch.id;
                return (
                  <tr
                    key={pitch.id}
                    onMouseEnter={() => setSelectedPitchId(pitch.id)}
                    onMouseLeave={() => setSelectedPitchId(null)}
                    className={`hover:bg-slate-800/40 transition-colors ${isHovered ? 'bg-slate-800/50' : ''}`}
                  >
                    <td className="py-2.5 px-3 font-bold text-slate-400">{pitch.number}</td>
                    <td className="py-2.5 px-2">
                      <span
                        title={pitch.type}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider font-sans uppercase whitespace-nowrap ${getPitchColor(pitch.type)}`}
                      >
                        {getPitchAbbreviation(pitch.type)}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 font-bold text-white">{pitch.velocity}</td>
                    <td className="py-2.5 px-2 truncate max-w-[90px] text-slate-300 font-sans" title={pitch.targetZoneLabel ? `${pitch.zone} - Target: ${pitch.targetZoneLabel}` : pitch.zone}>
                      <span className={pitch.isStrike ? 'text-red-400' : 'text-emerald-400'}>
                        ●
                      </span>{' '}
                      {pitch.zone.split(' (')[0]}
                      {pitch.missResult && (() => {
                        const miss = getMissResultStyle(pitch.missResult);
                        return miss ? (
                          <span className={`block text-[9px] font-bold uppercase tracking-wider ${miss.className}`}>
                            {miss.label}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => onToggleBadShape(pitch.id)}
                        title={pitch.badShape ? 'Flagged as bad shape (flat curve, hanging slider, etc.) - click to clear' : 'Flag as bad shape (flat curve, hanging slider, etc.)'}
                        className={`p-1 rounded hover:bg-orange-500/10 transition-colors inline-block ${pitch.badShape ? 'text-orange-400' : 'text-slate-600 hover:text-orange-400'}`}
                      >
                        <Flag className="w-3.5 h-3.5" fill={pitch.badShape ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={() => onRemovePitch(pitch.id)}
                        className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-red-500/10 transition-colors inline-block"
                        title="Delete pitch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export const PitchTracker = React.memo(PitchTrackerBase);
