import React, { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from 'recharts';
import { Target, ShieldCheck, AlertCircle, Info, Zap } from 'lucide-react';
import { KinematicFrame } from '../types';

interface KinematicChartProps {
  pitchNumber: number | null;
  pitchType: string | null;
  velocity: number | null;
  kinematicsData: KinematicFrame[];
  isSimulated?: boolean;
}

// Highly optimized professional MLB pitcher reference curve
const PROFESSIONAL_REFERENCE: KinematicFrame[] = Array.from({ length: 41 }, (_, i) => {
  const t = parseFloat(((i - 25) / 30).toFixed(2)); // center release at t = 0 (frame 25 is peak)
  
  // Pelvis peaks first (around t = -0.3s, frame 16)
  const hipPeak = 650;
  const hipCenter = 16;
  const hipSpeed = Math.round(hipPeak * Math.exp(-Math.pow(i - hipCenter, 2) / 45));

  // Torso peaks second (around t = -0.13s, frame 21)
  const shoulderPeak = 950;
  const shoulderCenter = 21;
  const shoulderSpeed = Math.round(shoulderPeak * Math.exp(-Math.pow(i - shoulderCenter, 2) / 35));

  // Hand/Wrist peaks last at release (around t = 0s, frame 25)
  const wristPeak = 1600;
  const wristCenter = 25;
  const wristSpeed = Math.round(wristPeak * Math.exp(-Math.pow(i - wristCenter, 2) / 25));

  return {
    time: t,
    hip: hipSpeed,
    shoulder: shoulderSpeed,
    wrist: wristSpeed
  };
});

export function KinematicChart({
  pitchNumber,
  pitchType,
  velocity,
  kinematicsData,
  isSimulated = false
}: KinematicChartProps) {
  const [showReference, setShowReference] = useState(false);

  // Use either custom kinematicsData or fall back to professional reference if empty
  const activeData = kinematicsData && kinematicsData.length > 5 
    ? kinematicsData 
    : PROFESSIONAL_REFERENCE;

  const dataIsFallback = !kinematicsData || kinematicsData.length <= 5;

  // Find peak values and their timings in the current data
  let peakHip = { val: 0, time: 0, frame: 0 };
  let peakShoulder = { val: 0, time: 0, frame: 0 };
  let peakWrist = { val: 0, time: 0, frame: 0 };

  activeData.forEach((d, idx) => {
    if (d.hip > peakHip.val) peakHip = { val: d.hip, time: d.time, frame: idx };
    if (d.shoulder > peakShoulder.val) peakShoulder = { val: d.shoulder, time: d.time, frame: idx };
    if (d.wrist > peakWrist.val) peakWrist = { val: d.wrist, time: d.time, frame: idx };
  });

  // Calculate Kinematic Sequencing Efficiency
  // Correct sequence: Pelvis Peak Frame < Torso Peak Frame < Hand Peak Frame
  const isPelvisBeforeTorso = peakHip.frame < peakShoulder.frame;
  const isTorsoBeforeWrist = peakShoulder.frame < peakWrist.frame;
  const isSequenceCorrect = isPelvisBeforeTorso && isTorsoBeforeWrist;

  // Calculate gaps
  const hipToShoulderGapMs = Math.round((peakShoulder.time - peakHip.time) * 1000);
  const shoulderToWristGapMs = Math.round((peakWrist.time - peakShoulder.time) * 1000);

  let sequenceStatusText = '';
  let sequenceStatusColor = '';
  let coachingAdvice = '';

  if (isSequenceCorrect) {
    sequenceStatusText = 'OPTIMAL KINEMATIC CHAIN (Excellent)';
    sequenceStatusColor = 'text-emerald-400 border-emerald-500/30 bg-emerald-950/20';
    coachingAdvice = `Perfect kinetic sequence! Power is building correctly from the ground up: Pelvis peaks first (${peakHip.val} deg/s), transferring energy to the Torso (${peakShoulder.val} deg/s) +${hipToShoulderGapMs}ms later, and unleashing max Hand speed (${peakWrist.val} units) at release.`;
  } else if (isPelvisBeforeTorso && !isTorsoBeforeWrist) {
    sequenceStatusText = 'PUSHING / EARLY HAND RELEASE (Sub-optimal)';
    sequenceStatusColor = 'text-amber-400 border-amber-500/30 bg-amber-950/20';
    coachingAdvice = 'Your hand/wrist is peaking too early or at the same time as your torso. This indicates "pushing" the ball rather than whipping it. Focus on delaying your arm acceleration until your chest rotates fully forward.';
  } else {
    sequenceStatusText = 'OUT OF ORDER SEQUENCE (Needs Correction)';
    sequenceStatusColor = 'text-red-400 border-red-500/30 bg-red-950/20';
    coachingAdvice = 'The pelvis is not leading the rotation, which severely limits torque and increases shoulder strain. Focus on hip-shoulder separation: drive your hips open toward the plate while keeping your shoulders closed at stride landing.';
  }

  // Custom tooltips matching deep theme
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 border border-slate-800 p-2.5 rounded shadow-2xl font-sans">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Time: {label >= 0 ? `+${label}s` : `${label}s`}
          </p>
          <div className="space-y-1 text-xs">
            {payload.map((p: any) => (
              <div key={p.name} className="flex items-center gap-2 justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="text-slate-300 font-medium">{p.name}:</span>
                </span>
                <span className="font-mono font-bold text-white">
                  {p.value} {p.name.includes('Wrist') ? '' : 'deg/s'}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-4 w-full h-full">
      {/* Header with information */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white uppercase tracking-wider">
              {pitchNumber 
                ? `Kinematic Sequence — Pitch #${pitchNumber}` 
                : 'Kinematic Sequence Analysis'}
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {pitchNumber 
              ? `Real-time velocity transfer for ${pitchType} at ${velocity} MPH`
              : 'Interactive whip sequencing curve (Pelvis ➔ Torso ➔ Hand)'}
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setShowReference(!showReference)}
            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-colors ${
              showReference 
                ? 'bg-sky-600 border-sky-500 text-white shadow-lg shadow-sky-600/10' 
                : 'bg-slate-950 border-slate-800 hover:bg-slate-800 text-slate-400'
            }`}
          >
            {showReference ? 'Hide Pro Reference' : 'Show Pro Reference'}
          </button>
        </div>
      </div>

      {/* Recharts Container */}
      <div className="h-64 sm:h-72 w-full bg-slate-950/40 rounded-xl border border-slate-800/60 p-2 sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={showReference ? PROFESSIONAL_REFERENCE : activeData}
            margin={{ top: 15, right: 10, left: -25, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis 
              dataKey="time" 
              stroke="#64748b" 
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v === 0 ? 'Release' : `${v}s`}
            />
            <YAxis 
              stroke="#64748b" 
              fontSize={10}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Velocity', angle: -90, position: 'insideLeft', offset: 10, fill: '#64748b', fontSize: 10, fontWeight: 'bold' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              verticalAlign="top" 
              height={36} 
              iconType="circle"
              iconSize={6}
              wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}
            />
            
            {/* Release line */}
            <ReferenceLine x={0} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: 'RELEASE', fill: '#f43f5e', fontSize: 8, fontWeight: 'bold', position: 'top' }} />

            {/* Pelvis speed line (Amber) */}
            <Line
              type="monotone"
              dataKey="hip"
              name="Pelvis / Hip"
              stroke="#f59e0b"
              strokeWidth={showReference ? 1.5 : 2.5}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />

            {/* Torso speed line (Indigo) */}
            <Line
              type="monotone"
              dataKey="shoulder"
              name="Torso / Shoulder"
              stroke="#6366f1"
              strokeWidth={showReference ? 1.5 : 2.5}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />

            {/* Hand speed line (Emerald/Cyan) */}
            <Line
              type="monotone"
              dataKey="wrist"
              name="Hand / Wrist"
              stroke="#10b981"
              strokeWidth={showReference ? 1.5 : 2.5}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics breakdown & sequence verdict */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Peak Pelvis */}
        <div className="bg-slate-950/30 border border-slate-800 p-3 rounded-lg flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-amber-500 text-[10px] uppercase font-bold tracking-wider">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            Pelvis (Hips) Peak
          </div>
          <div className="my-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">
              {peakHip.val}
            </span>
            <span className="text-[10px] text-slate-500 ml-1">deg/s</span>
          </div>
          <p className="text-[10px] text-slate-400">
            Peaked at <span className="font-mono text-amber-400">{peakHip.time >= 0 ? `+${peakHip.time}` : peakHip.time}s</span>
          </p>
        </div>

        {/* Peak Torso */}
        <div className="bg-slate-950/30 border border-slate-800 p-3 rounded-lg flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-indigo-400 text-[10px] uppercase font-bold tracking-wider">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            Torso (Shoulder) Peak
          </div>
          <div className="my-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">
              {peakShoulder.val}
            </span>
            <span className="text-[10px] text-slate-500 ml-1">deg/s</span>
          </div>
          <p className="text-[10px] text-slate-400">
            Peaked at <span className="font-mono text-indigo-400">{peakShoulder.time >= 0 ? `+${peakShoulder.time}` : peakShoulder.time}s</span> 
            {isPelvisBeforeTorso ? (
              <span className="text-emerald-400 font-bold ml-1">✓ (+{hipToShoulderGapMs}ms)</span>
            ) : (
              <span className="text-red-400 font-bold ml-1">✗ Out of order</span>
            )}
          </p>
        </div>

        {/* Peak Hand */}
        <div className="bg-slate-950/30 border border-slate-800 p-3 rounded-lg flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] uppercase font-bold tracking-wider">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Hand (Wrist) Peak
          </div>
          <div className="my-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">
              {peakWrist.val}
            </span>
            <span className="text-[10px] text-slate-500 ml-1">units</span>
          </div>
          <p className="text-[10px] text-slate-400">
            Peaked at <span className="font-mono text-emerald-400">{peakWrist.time >= 0 ? `+${peakWrist.time}` : peakWrist.time}s</span>
            {isTorsoBeforeWrist ? (
              <span className="text-emerald-400 font-bold ml-1">✓ (+{shoulderToWristGapMs}ms)</span>
            ) : (
              <span className="text-red-400 font-bold ml-1">✗ Out of order</span>
            )}
          </p>
        </div>
      </div>

      {/* Analysis Panel */}
      <div className={`p-3.5 rounded-lg border flex flex-col sm:flex-row gap-3 items-start ${sequenceStatusColor}`}>
        {isSequenceCorrect ? (
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider mb-1">
            {sequenceStatusText}
            {showReference && <span className="text-slate-400 ml-1.5 font-normal normal-case">(Professional Baseline displayed)</span>}
          </p>
          <p className="text-xs text-slate-300 leading-relaxed">
            {coachingAdvice}
          </p>
        </div>
      </div>

      {dataIsFallback && !showReference && (
        <div className="flex items-start gap-2 bg-slate-950/50 border border-slate-800/80 p-2.5 rounded-lg">
          <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
          <p className="text-[10px] text-slate-500 leading-normal">
            <strong>Simulation Note:</strong> Currently showing the standard 3-segment reference curve. 
            Connect your webcam or upload a throwing video to map your live joint acceleration velocities! 
            Whenever you click on the video or PitchCast map to log a pitch, your live kinematic sequencing curve will be saved and linked directly to that specific pitch.
          </p>
        </div>
      )}
    </div>
  );
}
