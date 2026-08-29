import React, { useState } from 'react';
import { SplitTestGroup, SplitTestPitch } from '../types';
import { FlaskConical, Plus, Trash2, X, TrendingUp, RotateCcw, Gauge } from 'lucide-react';

interface SplitTestTrackerProps {
  groups: SplitTestGroup[];
  onAddGroup: (name: string) => void;
  onDeleteGroup: (id: string) => void;
  onAddSet: (groupId: string, name: string) => void;
  onDeleteSet: (groupId: string, setId: string) => void;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  activeSetId: string | null;
  setActiveSetId: (id: string | null) => void;
  velocity: number;
  setVelocity: (v: number) => void;
  onLogPitch: () => void;
}

function SplitTestTrackerBase({
  groups,
  onAddGroup,
  onDeleteGroup,
  onAddSet,
  onDeleteSet,
  activeGroupId,
  setActiveGroupId,
  activeSetId,
  setActiveSetId,
  velocity,
  setVelocity,
  onLogPitch,
}: SplitTestTrackerProps) {
  const [newGroupName, setNewGroupName] = useState('');
  const [newSetNameByGroup, setNewSetNameByGroup] = useState<Record<string, string>>({});

  const activeGroup = groups.find(g => g.id === activeGroupId) || null;
  const canLog = !!activeGroup && !!activeGroup.sets.find(s => s.id === activeSetId);

  const submitNewGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    onAddGroup(name);
    setNewGroupName('');
  };

  const submitNewSet = (groupId: string) => {
    const name = (newSetNameByGroup[groupId] || '').trim();
    if (!name) return;
    onAddSet(groupId, name);
    setNewSetNameByGroup(prev => ({ ...prev, [groupId]: '' }));
  };

  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto pr-1">
      {/* Group / Set management */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical className="w-5 h-5 text-violet-400" />
          <h3 className="font-semibold text-sm text-white">TEST GROUPS</h3>
        </div>

        <div className="space-y-3">
          {groups.length === 0 && (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              A group is a mechanical variable you want to isolate (e.g.
              "Foot on Rubber"). Add one, then add the tweaks being compared
              as its sets (e.g. "Inward", "Neutral", "Outward").
            </p>
          )}

          {groups.map((group) => (
            <div key={group.id} className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-white truncate">{group.name}</span>
                <button
                  onClick={() => onDeleteGroup(group.id)}
                  title="Delete group"
                  className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-2">
                {group.sets.map((set) => (
                  <span
                    key={set.id}
                    className="flex items-center gap-1 pl-2 pr-1 py-1 rounded text-[10px] font-semibold bg-slate-800 border border-slate-700 text-slate-300"
                  >
                    {set.name}
                    <button
                      onClick={() => onDeleteSet(group.id, set.id)}
                      title="Delete set"
                      className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {group.sets.length === 0 && (
                  <span className="text-[10px] text-slate-600 italic">No sets yet</span>
                )}
              </div>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newSetNameByGroup[group.id] || ''}
                  onChange={(e) => setNewSetNameByGroup(prev => ({ ...prev, [group.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitNewSet(group.id); }}
                  placeholder="New set name..."
                  className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={() => submitNewSet(group.id)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
                  title="Add set"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          <div className="flex gap-1.5 pt-1">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitNewGroup(); }}
              placeholder="New group name..."
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={submitNewGroup}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Group
            </button>
          </div>
        </div>
      </div>

      {/* Active test + log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="w-5 h-5 text-violet-400" />
          <h3 className="font-semibold text-sm text-white">LOG A PITCH</h3>
        </div>

        {groups.length === 0 ? (
          <p className="text-[11px] text-slate-500">Add a test group above to start logging.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1.5">Group</label>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => {
                      setActiveGroupId(group.id);
                      if (!group.sets.find(s => s.id === activeSetId)) setActiveSetId(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                      activeGroupId === group.id
                        ? 'bg-violet-600 border-violet-400 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>

            {activeGroup && (
              <div>
                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1.5">Set</label>
                {activeGroup.sets.length === 0 ? (
                  <p className="text-[11px] text-slate-600 italic">This group has no sets yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {activeGroup.sets.map((set) => (
                      <button
                        key={set.id}
                        onClick={() => setActiveSetId(set.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                          activeSetId === set.id
                            ? 'bg-violet-600 border-violet-400 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {set.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Pitch Velocity (MPH)</label>
                <span className="text-sm font-mono text-violet-400 font-bold">{velocity} MPH</span>
              </div>
              <input
                type="range"
                min="50"
                max="105"
                value={velocity}
                onChange={(e) => setVelocity(Number(e.target.value))}
                className="w-full accent-violet-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <button
              onClick={onLogPitch}
              disabled={!canLog}
              className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:pointer-events-none text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-lg shadow-violet-600/20"
            >
              Log Pitch
            </button>
            {!canLog && (
              <p className="text-[10px] text-slate-600 text-center">Pick a group and a set to log a pitch.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const SplitTestTracker = React.memo(SplitTestTrackerBase);

interface SetStats {
  setId: string;
  setName: string;
  count: number;
  avgVelo: number;
  maxVelo: number;
}

function computeGroupStats(group: SplitTestGroup, pitches: SplitTestPitch[]): SetStats[] {
  return group.sets.map((set) => {
    const setPitches = pitches.filter(p => p.groupId === group.id && p.setId === set.id);
    const count = setPitches.length;
    const avgVelo = count ? Math.round(setPitches.reduce((sum, p) => sum + p.velocity, 0) / count) : 0;
    const maxVelo = count ? Math.max(...setPitches.map(p => p.velocity)) : 0;
    return { setId: set.id, setName: set.name, count, avgVelo, maxVelo };
  });
}

interface SplitTestLogProps {
  groups: SplitTestGroup[];
  pitches: SplitTestPitch[];
  onRemovePitch: (id: string) => void;
  onClearPitches: () => void;
}

function SplitTestLogBase({ groups, pitches, onRemovePitch, onClearPitches }: SplitTestLogProps) {
  const groupsWithData = groups.filter(g => g.sets.length > 0);

  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto pr-1">
      {/* Results by group */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-5 h-5 text-violet-400" />
          <h3 className="font-semibold text-sm text-white">RESULTS</h3>
        </div>

        {groupsWithData.length === 0 ? (
          <p className="text-[11px] text-slate-500">Log pitches against at least one group's sets to see a comparison here.</p>
        ) : (
          <div className="space-y-4">
            {groupsWithData.map((group) => {
              const stats = computeGroupStats(group, pitches);
              const withData = stats.filter(s => s.count > 0);
              const bestAvg = withData.length >= 2 ? Math.max(...withData.map(s => s.avgVelo)) : null;
              const groupAvg = withData.length
                ? withData.reduce((sum, s) => sum + s.avgVelo * s.count, 0) / withData.reduce((sum, s) => sum + s.count, 0)
                : null;

              return (
                <div key={group.id}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{group.name}</p>
                  <div className="space-y-1.5">
                    {stats.map((s) => {
                      const isBest = bestAvg !== null && s.count > 0 && s.avgVelo === bestAvg;
                      const delta = s.count > 0 && groupAvg !== null ? s.avgVelo - groupAvg : null;
                      return (
                        <div
                          key={s.setId}
                          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs ${
                            isBest ? 'bg-emerald-950/30 border-emerald-500/40' : 'bg-slate-950/40 border-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isBest && <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                            <span className={`font-semibold truncate ${isBest ? 'text-emerald-300' : 'text-slate-300'}`}>{s.setName}</span>
                          </div>
                          {s.count === 0 ? (
                            <span className="text-slate-600 text-[10px] shrink-0">No data</span>
                          ) : (
                            <div className="flex items-center gap-2.5 font-mono text-[11px] shrink-0">
                              <span className="text-slate-500">{s.count}p</span>
                              <span className="text-white font-bold">{s.avgVelo} avg</span>
                              <span className="text-sky-400">{s.maxVelo} max</span>
                              {delta !== null && (
                                <span className={delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-slate-500'}>
                                  {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Raw pitch log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col flex-1 min-h-[220px]">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-sm text-white">SESSION LOG</h3>
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

        <div className="flex-1 overflow-y-auto pr-0.5 border border-slate-800 bg-slate-950/20 rounded-lg min-h-0">
          {pitches.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <FlaskConical className="w-8 h-8 text-slate-700 mb-2 animate-pulse" />
              <p className="text-xs font-semibold uppercase tracking-wider">No pitches logged</p>
              <p className="text-[10px] text-slate-600 mt-1 max-w-[180px]">
                Pick a group and set, then log a pitch.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-[10px] text-slate-500 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-2">Group</th>
                  <th className="py-2 px-2">Set</th>
                  <th className="py-2 px-2">MPH</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {[...pitches].reverse().map((pitch) => (
                  <tr key={pitch.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-slate-400">{pitch.number}</td>
                    <td className="py-2.5 px-2 truncate max-w-[90px] text-slate-300 font-sans" title={pitch.groupName}>{pitch.groupName}</td>
                    <td className="py-2.5 px-2 truncate max-w-[90px] text-slate-300 font-sans" title={pitch.setName}>{pitch.setName}</td>
                    <td className="py-2.5 px-2 font-bold text-white">{pitch.velocity}</td>
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
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export const SplitTestLog = React.memo(SplitTestLogBase);
