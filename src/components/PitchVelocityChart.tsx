import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from 'recharts';
import { TrendingUp, Target } from 'lucide-react';
import { Pitch, PitchType, PITCH_TYPE_INFO } from '../types';

interface PitchVelocityChartProps {
  pitches: Pitch[];
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: { number: number; velocity: number; type: PitchType; isStrike: boolean; zone: string } }[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-900 border border-slate-800 p-2.5 rounded shadow-2xl font-sans">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Pitch #{d.number}</p>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-3 justify-between">
          <span className="text-slate-300">{d.type}</span>
          <span className="font-mono font-bold text-white">{d.velocity} mph</span>
        </div>
        <p className={`text-[10px] font-bold uppercase tracking-wider ${d.isStrike ? 'text-red-400' : 'text-emerald-400'}`}>
          {d.isStrike ? 'Strike' : 'Ball'} - {d.zone.split(' (')[0]}
        </p>
      </div>
    </div>
  );
}

// Session velocity trend, replacing the Interactive PitchCast mini-map -
// pitch location is already plotted live on the video canvas itself, so this
// panel is more useful showing something the canvas doesn't: how velocity is
// holding up (or fading) across the outing, at a glance.
export function PitchVelocityChart({ pitches }: PitchVelocityChartProps) {
  if (pitches.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2 h-56">
        <Target className="w-8 h-8 text-slate-700 animate-pulse" />
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">No pitches yet</p>
        <p className="text-[10px] text-slate-600 max-w-[200px]">
          Velocity trend will appear here once you log pitches on the video canvas.
        </p>
      </div>
    );
  }

  const data = pitches.map((p) => ({
    number: p.number,
    velocity: p.velocity,
    type: p.type,
    isStrike: p.isStrike,
    zone: p.zone,
  }));

  const avgVelocity = Math.round(data.reduce((sum, d) => sum + d.velocity, 0) / data.length);
  const minVelocity = Math.min(...data.map((d) => d.velocity));
  const maxVelocity = Math.max(...data.map((d) => d.velocity));
  const typesThrown = Array.from(new Set(data.map((d) => d.type)));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-sky-400" />
          Velocity Trend
        </span>
        <span className="text-[9px] text-slate-500 font-mono">avg {avgVelocity} mph</span>
      </div>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="number" stroke="#64748b" fontSize={9} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#64748b"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              domain={[Math.max(0, minVelocity - 5), maxVelocity + 5]}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(56, 189, 248, 0.08)' }} />
            <ReferenceLine
              y={avgVelocity}
              stroke="#38bdf8"
              strokeDasharray="4 4"
              label={{ value: `avg ${avgVelocity}`, fill: '#38bdf8', fontSize: 9, position: 'insideTopRight' }}
            />
            <Bar dataKey="velocity" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.number} fill={PITCH_TYPE_INFO[d.type].hexColor} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-3 border-t border-slate-800/60 text-[9px] text-slate-400">
        {typesThrown.map((type) => (
          <div key={type} className="flex items-center gap-1" title={type}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PITCH_TYPE_INFO[type].hexColor }} />
            <span>{PITCH_TYPE_INFO[type].abbreviation}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
