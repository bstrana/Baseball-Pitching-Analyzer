import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from 'recharts';
import { TrendingUp, Target, BarChart3 } from 'lucide-react';
import { Pitch, PitchType, PITCH_TYPE_INFO } from '../types';

interface PitchVelocityChartProps {
  pitches: Pitch[];
  // Mirrors the Speed On/Off toggle in the Pitch Calibration panel above -
  // velocity isn't being recorded meaningfully while it's off (every pitch
  // logs whatever the slider was last left at), so a trend-by-velocity chart
  // would be misleading. Swap to something that's always meaningful instead:
  // how the strike/ball mix breaks down by pitch type.
  showSpeeds: boolean;
}

interface VelocityTooltipProps {
  active?: boolean;
  payload?: { payload: { number: number; velocity: number; type: PitchType; isStrike: boolean; zone: string } }[];
}

function VelocityTooltip({ active, payload }: VelocityTooltipProps) {
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

interface ZoneMixTooltipProps {
  active?: boolean;
  payload?: { payload: { type: PitchType; strikes: number; balls: number } }[];
}

function ZoneMixTooltip({ active, payload }: ZoneMixTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-900 border border-slate-800 p-2.5 rounded shadow-2xl font-sans">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{d.type}</p>
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-3 justify-between">
          <span className="text-red-400">Strikes</span>
          <span className="font-mono font-bold text-white">{d.strikes}</span>
        </div>
        <div className="flex items-center gap-3 justify-between">
          <span className="text-emerald-400">Balls</span>
          <span className="font-mono font-bold text-white">{d.balls}</span>
        </div>
      </div>
    </div>
  );
}

// Session velocity trend, replacing the Interactive PitchCast mini-map -
// pitch location is already plotted live on the video canvas itself, so this
// panel is more useful showing something the canvas doesn't. With Speed on,
// that's how velocity is holding up (or fading) across the outing; with
// Speed off (velocity isn't being tracked), it's the strike/ball mix by
// pitch type instead.
export function PitchVelocityChart({ pitches, showSpeeds }: PitchVelocityChartProps) {
  if (pitches.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2 h-56">
        <Target className="w-8 h-8 text-slate-700 animate-pulse" />
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">No pitches yet</p>
        <p className="text-[10px] text-slate-600 max-w-[200px]">
          {showSpeeds ? 'Velocity trend' : 'Strike/ball mix'} will appear here once you log pitches on the video canvas.
        </p>
      </div>
    );
  }

  if (!showSpeeds) {
    const zoneMixData = Object.entries(
      pitches.reduce((acc, p) => {
        if (!acc[p.type]) acc[p.type] = { strikes: 0, balls: 0 };
        if (p.isStrike) acc[p.type].strikes += 1;
        else acc[p.type].balls += 1;
        return acc;
      }, {} as Record<string, { strikes: number; balls: number }>)
    )
      .map(([type, s]) => ({ type: type as PitchType, ...s, total: s.strikes + s.balls }))
      .sort((a, b) => b.total - a.total);

    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-sky-400" />
            Strikes vs Balls by Type
          </span>
          <span className="text-[9px] text-slate-500 font-mono">{pitches.length} pitches</span>
        </div>

        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={zoneMixData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="type"
                stroke="#64748b"
                fontSize={9}
                tickLine={false}
                axisLine={false}
                tickFormatter={(type: PitchType) => PITCH_TYPE_INFO[type].abbreviation}
              />
              <YAxis stroke="#64748b" fontSize={9} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ZoneMixTooltip />} cursor={{ fill: 'rgba(56, 189, 248, 0.08)' }} />
              <Bar dataKey="strikes" stackId="pitches" fill="#f87171" radius={[0, 0, 0, 0]} />
              <Bar dataKey="balls" stackId="pitches" fill="#34d399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-800/60 text-[9px] text-slate-400">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0 bg-red-400" />
            <span>Strikes</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0 bg-emerald-400" />
            <span>Balls</span>
          </div>
        </div>
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
          <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="number" stroke="#64748b" fontSize={9} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#64748b"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              domain={[Math.max(0, minVelocity - 5), maxVelocity + 5]}
            />
            <Tooltip content={<VelocityTooltip />} cursor={{ stroke: '#38bdf8', strokeWidth: 1, strokeDasharray: '3 3' }} />
            <ReferenceLine
              y={avgVelocity}
              stroke="#38bdf8"
              strokeDasharray="4 4"
              label={{ value: `avg ${avgVelocity}`, fill: '#38bdf8', fontSize: 9, position: 'insideTopRight' }}
            />
            <Line
              type="monotone"
              dataKey="velocity"
              stroke="#94a3b8"
              strokeWidth={1.5}
              dot={(props: { cx: number; cy: number; payload: { type: PitchType; number: number } }) => (
                <circle
                  key={props.payload.number}
                  cx={props.cx}
                  cy={props.cy}
                  r={3.5}
                  fill={PITCH_TYPE_INFO[props.payload.type].hexColor}
                  stroke="#0f172a"
                  strokeWidth={1}
                />
              )}
              activeDot={{ r: 5, strokeWidth: 1, stroke: '#0f172a' }}
              isAnimationActive={false}
            />
          </LineChart>
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
