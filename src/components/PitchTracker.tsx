import React from 'react';
import { Pitch, PitchType, StrikeZoneConfig, classifyPitch } from '../types';
import { Target, Trash2, Gauge, RotateCcw, Sliders, Layers, Eye, EyeOff } from 'lucide-react';

const PITCH_TYPES: PitchType[] = ['Fastball', 'Curveball', 'Slider', 'Changeup', 'Cutter', 'Sinker'];

// Shared between the calibration map and the pitch log table below
function getPitchColor(type: PitchType) {
  switch (type) {
    case 'Fastball': return 'bg-red-500 text-white border-red-400';
    case 'Curveball': return 'bg-blue-500 text-white border-blue-400';
    case 'Slider': return 'bg-amber-500 text-white border-amber-400';
    case 'Changeup': return 'bg-emerald-500 text-white border-emerald-400';
    case 'Cutter': return 'bg-purple-500 text-white border-purple-400';
    case 'Sinker': return 'bg-pink-500 text-white border-pink-400';
    default: return 'bg-slate-500 text-white border-slate-400';
  }
}

function getPitchHexColor(type: PitchType) {
  switch (type) {
    case 'Fastball': return '#ef4444';
    case 'Curveball': return '#3b82f6';
    case 'Slider': return '#f59e0b';
    case 'Changeup': return '#10b981';
    case 'Cutter': return '#a855f7';
    case 'Sinker': return '#ec4899';
    default: return '#64748b';
  }
}

interface PitchTrackerProps {
  pitches: Pitch[];
  onAddPitch: (pitch: Pitch) => void;
  config: StrikeZoneConfig;
  onConfigChange: (config: StrikeZoneConfig) => void;
  showStrikeZone: boolean;
  setShowStrikeZone: (show: boolean) => void;
  currentPitchType: PitchType;
  setCurrentPitchType: (type: PitchType) => void;
  currentPitchSpeed: number;
  setCurrentPitchSpeed: (speed: number) => void;
  selectedPitchId: string | null;
  setSelectedPitchId: (id: string | null) => void;
}

export function PitchTracker({
  pitches,
  onAddPitch,
  config,
  onConfigChange,
  showStrikeZone,
  setShowStrikeZone,
  currentPitchType,
  setCurrentPitchType,
  currentPitchSpeed,
  setCurrentPitchSpeed,
  selectedPitchId,
  setSelectedPitchId,
}: PitchTrackerProps) {

  // Handle manual plotting on the mini strike zone chart
  const handleMiniMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const classification = classifyPitch(x, y, config);

    const newPitch: Pitch = {
      id: crypto.randomUUID(),
      number: pitches.length + 1,
      type: currentPitchType,
      velocity: currentPitchSpeed,
      x,
      y,
      isStrike: classification.isStrike,
      zone: classification.zone,
      timestamp: new Date()
    };

    onAddPitch(newPitch);
  };

  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto pr-1">
      {/* Pitch Type Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-sky-400" />
            <h3 className="font-semibold text-sm text-white">PITCH CALIBRATION</h3>
          </div>
          <button
            onClick={() => setShowStrikeZone(!showStrikeZone)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors ${showStrikeZone ? 'bg-sky-950/40 border-sky-500/50 text-sky-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
          >
            {showStrikeZone ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showStrikeZone ? 'Zone Visible' : 'Zone Hidden'}
          </button>
        </div>

        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-2">Select Pitch Type</label>
          <div className="grid grid-cols-3 gap-1.5">
            {PITCH_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setCurrentPitchType(type)}
                className={`py-1.5 px-1 rounded text-xs font-semibold text-center border transition-all truncate ${
                  currentPitchType === type
                    ? 'bg-sky-600 border-sky-400 text-white font-bold shadow-md shadow-sky-600/20'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive PitchCast - right under the pitch type selector, since
          picking a type and tapping the map is the most common action pair */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center">
        <div className="flex items-center justify-between w-full mb-3">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-sky-400" />
            Interactive PitchCast
          </span>
          <span className="text-[9px] text-slate-500 italic">Click/Tap map to log pitch</span>
        </div>

        {/* The Map Box */}
        <div
          onClick={handleMiniMapClick}
          className="relative w-48 h-56 bg-slate-950 border-2 border-slate-800 rounded-lg overflow-hidden cursor-crosshair group flex items-center justify-center transition-all hover:border-slate-700 shadow-inner"
        >
          {/* Outer Boundary indicator */}
          <div className="absolute inset-0 border border-slate-900/30"></div>

          {/* Calibrated Strike Zone Box */}
          <div
            style={{
              left: `${config.x * 100}%`,
              top: `${config.y * 100}%`,
              width: `${config.width * 100}%`,
              height: `${config.height * 100}%`,
            }}
            className="absolute border-2 border-dashed border-red-500/60 bg-red-500/5 flex flex-wrap"
          >
            {/* Draw 3x3 Grid inside Strike Zone */}
            <div className="w-1/3 h-full border-r border-red-500/20"></div>
            <div className="w-1/3 h-full border-r border-red-500/20"></div>
            <div className="absolute top-1/3 left-0 w-full border-t border-red-500/20"></div>
            <div className="absolute top-2/3 left-0 w-full border-t border-red-500/20"></div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
              <span className="text-[9px] text-red-400 font-bold tracking-widest uppercase">STRIKE ZONE</span>
            </div>
          </div>

          {/* Plotted Pitches */}
          {pitches.map((pitch) => {
            const isHovered = selectedPitchId === pitch.id;
            return (
              <div
                key={pitch.id}
                onMouseEnter={() => setSelectedPitchId(pitch.id)}
                onMouseLeave={() => setSelectedPitchId(null)}
                style={{
                  left: `${pitch.x * 100}%`,
                  top: `${pitch.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`absolute w-4 h-4 rounded-full border-2 flex items-center justify-center font-mono text-[8px] font-bold select-none transition-all cursor-pointer shadow-lg ${getPitchColor(pitch.type)} ${
                  isHovered ? 'scale-150 ring-4 ring-sky-400/50 z-20 shadow-sky-500/30' : 'z-10'
                }`}
                title={`${pitch.type}, ${pitch.velocity} MPH - ${pitch.zone}`}
              >
                {pitch.number}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 mt-3 text-[10px] text-slate-400 w-full bg-slate-950/40 p-2 rounded border border-slate-800/60">
          {PITCH_TYPES.slice(0, 6).map((type) => (
            <div key={type} className="flex items-center gap-1.5 truncate">
              <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: getPitchHexColor(type) }}></span>
              <span className="truncate">{type}</span>
            </div>
          ))}
        </div>
      </div>

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
}

export function PitchLog({
  pitches,
  onRemovePitch,
  onClearPitches,
  selectedPitchId,
  setSelectedPitchId,
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
              Click on the main video feed or the Interactive PitchCast map to log a pitch.
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
              {pitches.map((pitch) => {
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
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider font-sans uppercase whitespace-nowrap ${getPitchColor(pitch.type)}`}>
                        {pitch.type}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 font-bold text-white">{pitch.velocity}</td>
                    <td className="py-2.5 px-2 truncate max-w-[90px] text-slate-300 font-sans" title={pitch.zone}>
                      <span className={pitch.isStrike ? 'text-red-400' : 'text-emerald-400'}>
                        ●
                      </span>{' '}
                      {pitch.zone.split(' (')[0]}
                    </td>
                    <td className="py-2.5 px-3 text-right">
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
