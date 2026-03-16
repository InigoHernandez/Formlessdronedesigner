// LeftSidebar — FORMLESS control panel
// Oscilloscope, play mode, scale/root/oct at top; record + actions pinned to bottom
// Collapsible with chevron toggle on right edge (mirrors right FX panel pattern)

import React from 'react';
import { WaveformVisualizer } from './WaveformVisualizer';
import { RecordButton } from './RecordButton';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import {
  Eye, EyeOff, Sun, Moon, Trash2, Undo2, Redo2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { AudioEngine, PlayMode } from '../utils/audioEngine';
import type { RootNote, ScaleType } from './ScaleSelector';

type RecordState = 'idle' | 'recording' | 'recorded';

interface LeftSidebarProps {
  audioEngine: AudioEngine;
  // Open/close
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  // Play mode
  playMode: PlayMode;
  onPlayModeChange: (mode: PlayMode) => void;
  // Scale
  rootNote: RootNote;
  scale: ScaleType;
  octave: number;
  onRootChange: (note: RootNote) => void;
  onScaleChange: (scale: ScaleType) => void;
  onOctaveChange: (octave: number) => void;
  // Actions
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Recording
  recordState: RecordState;
  recordSeconds: number;
  maxRecordSeconds: number;
  isGateMode: boolean;
  onRecordStart: () => void;
  onRecordStop: () => void;
  onRecordDownload: () => void;
  onRecordClear: () => void;
  // Theme & UI
  isDark: boolean;
  onToggleTheme: () => void;
  performanceMode: boolean;
  onTogglePerformanceMode: () => void;
  // Layout
  isTouch: boolean;
  isMobile: boolean;
}

const SCALE_OPTIONS: ScaleType[] = ['CHROMATIC', 'MINOR', 'MAJOR', 'PENTATONIC', 'DORIAN', 'PHRYGIAN', 'LYDIAN', 'LOCRIAN', 'WHOLE TONE', 'DIMINISHED'];
const ROOT_OPTIONS: RootNote[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVE_OPTIONS = [6, 5, 4, 3, 2, 1]; // highest pitch first

export function LeftSidebar({
  audioEngine,
  isOpen,
  onToggle,
  playMode,
  onPlayModeChange,
  rootNote,
  scale,
  octave,
  onRootChange,
  onScaleChange,
  onOctaveChange,
  onClear,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  recordState,
  recordSeconds,
  maxRecordSeconds,
  isGateMode,
  onRecordStart,
  onRecordStop,
  onRecordDownload,
  onRecordClear,
  isDark,
  onToggleTheme,
  performanceMode,
  onTogglePerformanceMode,
  isTouch,
  isMobile,
}: LeftSidebarProps) {
  return (
    <div className="fixed top-0 left-0 bottom-0 z-20 flex items-center" style={{ pointerEvents: 'none', padding: '16px 0' }}>
      <style>{`
        .fm-select-item[data-highlighted] {
          background-color: rgba(var(--fm-accent-rgb), 0.15) !important;
          color: var(--fm-accent) !important;
        }
      `}</style>
      {/* Panel content - floating with rounded corners */}
      <div
        className="h-full flex flex-col transition-all duration-300 ease-out overflow-hidden"
        style={{
          width: isOpen ? '220px' : '0px',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          backgroundColor: 'var(--fm-panel-bg)',
          border: '1px solid var(--fm-panel-border)',
          borderRadius: 'var(--fm-radius-lg)',
          marginLeft: '16px',
          marginRight: '0px',
          boxShadow: 'var(--fm-shadow-floating)',
          transition: 'width 300ms ease-out, opacity 300ms ease-out, background-color 300ms ease',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 shrink-0" style={{ height: '48px', minWidth: '220px', borderBottom: '1px solid var(--fm-panel-border)' }}>
          <span
            className="select-none tracking-widest"
            style={{ fontSize: '10px', color: 'var(--fm-accent)', opacity: 0.7 }}
          >
            FORMLESS
          </span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleTheme}
                  className="h-7 w-7"
                  style={{
                    color: 'var(--fm-text-secondary)',
                    backgroundColor: 'var(--fm-section-btn-bg)',
                    border: '1px solid var(--fm-section-btn-border)',
                    borderRadius: 'var(--fm-radius-sm)',
                  }}
                >
                  {isDark ? <Sun size={14} /> : <Moon size={14} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs" style={{ borderRadius: 'var(--fm-radius-sm)' }}>
                {isDark ? 'Light mode' : 'Dark mode'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onTogglePerformanceMode}
                  className="h-7 w-7"
                  style={{
                    color: 'var(--fm-text-secondary)',
                    backgroundColor: 'var(--fm-section-btn-bg)',
                    border: '1px solid var(--fm-section-btn-border)',
                    borderRadius: 'var(--fm-radius-sm)',
                  }}
                >
                  {performanceMode ? <Eye size={14} /> : <EyeOff size={14} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs" style={{ borderRadius: 'var(--fm-radius-sm)' }}>
                {performanceMode ? 'Show UI' : 'Hide UI'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Top scrollable content */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{
            minWidth: '220px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--fm-scrollbar-thumb) var(--fm-scrollbar-track)',
          }}
        >
          {/* Oscilloscope */}
          <div className="px-4 pt-4 pb-2">
            <div className="mb-2">
              <WaveformVisualizer audioEngine={audioEngine} />
            </div>
          </div>

          <div className="px-4"><Separator className="opacity-50" style={{ backgroundColor: 'var(--fm-divider)' }} /></div>

          {/* Play Mode */}
          <div className="px-4 py-3">
            <div
              className="tracking-widest mb-2 select-none"
              style={{ fontSize: '9px', color: 'var(--fm-text-muted)' }}
            >
              MODE
            </div>
            <Tabs value={playMode} onValueChange={(v) => onPlayModeChange(v as PlayMode)}>
              <TabsList className="w-full h-8 p-0 gap-0" style={{ backgroundColor: 'var(--fm-btn-bg)', border: '1px solid var(--fm-panel-border)', borderRadius: 'var(--fm-radius-md)' }}>
                {(['drone', 'pulse', 'gate'] as PlayMode[]).map((mode) => (
                  <TabsTrigger
                    key={mode}
                    value={mode}
                    className="flex-1 text-xs tracking-wider h-full data-[state=active]:shadow-none"
                    style={{
                      fontSize: '10px',
                      letterSpacing: '0.12em',
                      color: playMode === mode ? 'var(--fm-accent)' : 'var(--fm-text-muted)',
                      backgroundColor: playMode === mode ? 'var(--fm-btn-bg-active)' : 'transparent',
                      border: 'none',
                      borderRadius: 'var(--fm-radius-md)',
                    }}
                  >
                    {mode.toUpperCase()}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="px-4"><Separator className="opacity-50" style={{ backgroundColor: 'var(--fm-divider)' }} /></div>

          {/* Scale Controls */}
          <div className="px-4 py-3">
            <div
              className="tracking-widest mb-2 select-none"
              style={{ fontSize: '9px', color: 'var(--fm-text-muted)' }}
            >
              SCALE
            </div>
            <div className="flex flex-col gap-2">
              {/* Root */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 tracking-wider select-none" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', width: '32px' }}>ROOT</span>
                <Select value={rootNote} onValueChange={(v) => onRootChange(v as RootNote)}>
                  <SelectTrigger
                    size="sm"
                    className="flex-1 h-7 text-xs tracking-wider"
                    style={{
                      fontSize: '10px',
                      color: 'var(--fm-text-secondary)',
                      backgroundColor: 'var(--fm-btn-bg)',
                      borderColor: 'var(--fm-panel-border)',
                      borderRadius: 'var(--fm-radius-sm)',
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100]" style={{ backgroundColor: 'var(--fm-panel-bg)', borderColor: 'var(--fm-panel-border)', borderRadius: 'var(--fm-radius-md)' }}>
                    {ROOT_OPTIONS.map((n) => (
                      <SelectItem key={n} value={n} className="fm-select-item text-xs" style={{ color: 'var(--fm-text-primary)', borderRadius: 'var(--fm-radius-sm)' }}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Scale */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 tracking-wider select-none" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', width: '32px' }}>TYPE</span>
                <Select value={scale} onValueChange={(v) => onScaleChange(v as ScaleType)}>
                  <SelectTrigger
                    size="sm"
                    className="flex-1 h-7 text-xs tracking-wider"
                    style={{
                      fontSize: '10px',
                      color: 'var(--fm-text-secondary)',
                      backgroundColor: 'var(--fm-btn-bg)',
                      borderColor: 'var(--fm-panel-border)',
                      borderRadius: 'var(--fm-radius-sm)',
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100]" style={{ backgroundColor: 'var(--fm-panel-bg)', borderColor: 'var(--fm-panel-border)', borderRadius: 'var(--fm-radius-md)' }}>
                    {SCALE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="fm-select-item text-xs" style={{ color: 'var(--fm-text-primary)', borderRadius: 'var(--fm-radius-sm)' }}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Octave — 6 to 1, higher pitch first */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 tracking-wider select-none" style={{ fontSize: '9px', color: 'var(--fm-text-muted)', width: '32px' }}>OCT</span>
                <Select value={String(octave)} onValueChange={(v) => onOctaveChange(Number(v))}>
                  <SelectTrigger
                    size="sm"
                    className="flex-1 h-7 text-xs tracking-wider"
                    style={{
                      fontSize: '10px',
                      color: 'var(--fm-text-secondary)',
                      backgroundColor: 'var(--fm-btn-bg)',
                      borderColor: 'var(--fm-panel-border)',
                      borderRadius: 'var(--fm-radius-sm)',
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[100]" style={{ backgroundColor: 'var(--fm-panel-bg)', borderColor: 'var(--fm-panel-border)', borderRadius: 'var(--fm-radius-md)' }}>
                    {OCTAVE_OPTIONS.map((o) => (
                      <SelectItem key={o} value={String(o)} className="fm-select-item text-xs" style={{ color: 'var(--fm-text-primary)', borderRadius: 'var(--fm-radius-sm)' }}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom-pinned: Record + Actions */}
        <div className="shrink-0" style={{ minWidth: '220px', borderTop: '1px solid var(--fm-panel-border)' }}>
          {/* Recording */}
          <div className="px-4 py-3">
            <div
              className="tracking-widest mb-2 select-none"
              style={{ fontSize: '9px', color: 'var(--fm-text-muted)' }}
            >
              RECORD
            </div>
            <RecordButton
              recordState={recordState}
              recordSeconds={recordSeconds}
              maxSeconds={maxRecordSeconds}
              isMobile={isMobile}
              isGateMode={isGateMode}
              onStart={onRecordStart}
              onStop={onRecordStop}
              onDownload={onRecordDownload}
              onClear={onRecordClear}
            />
          </div>

          <div className="px-4"><Separator className="opacity-50" style={{ backgroundColor: 'var(--fm-divider)' }} /></div>

          {/* Actions */}
          <div className="px-4 py-3">
            <div
              className="tracking-widest mb-2 select-none"
              style={{ fontSize: '9px', color: 'var(--fm-text-muted)' }}
            >
              ACTIONS
            </div>
            <div className="flex flex-col gap-1.5">
              {/* Clear */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={onClear}
                    className="w-full h-8 text-xs tracking-wider justify-center gap-2"
                    style={{
                      fontSize: '10px',
                      color: 'var(--fm-text-muted)',
                      backgroundColor: 'var(--fm-btn-bg)',
                      borderColor: 'var(--fm-panel-border)',
                      borderRadius: 'var(--fm-radius-sm)',
                    }}
                  >
                    <Trash2 size={13} />
                    CLEAR
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs" style={{ borderRadius: 'var(--fm-radius-sm)' }}>
                  Clear all strokes
                </TooltipContent>
              </Tooltip>

              {/* Undo / Redo row */}
              <div className="flex gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={onUndo}
                      disabled={!canUndo}
                      className="flex-1 h-8 text-xs tracking-wider justify-center gap-1.5"
                      style={{
                        fontSize: '10px',
                        color: canUndo ? 'var(--fm-text-secondary)' : 'var(--fm-text-muted)',
                        backgroundColor: 'var(--fm-btn-bg)',
                        borderColor: 'var(--fm-panel-border)',
                        opacity: canUndo ? 1 : 0.4,
                        borderRadius: 'var(--fm-radius-sm)',
                      }}
                    >
                      <Undo2 size={13} />
                      UNDO
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs" style={{ borderRadius: 'var(--fm-radius-sm)' }}>
                    Undo last stroke
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={onRedo}
                      disabled={!canRedo}
                      className="flex-1 h-8 text-xs tracking-wider justify-center gap-1.5"
                      style={{
                        fontSize: '10px',
                        color: canRedo ? 'var(--fm-text-secondary)' : 'var(--fm-text-muted)',
                        backgroundColor: 'var(--fm-btn-bg)',
                        borderColor: 'var(--fm-panel-border)',
                        opacity: canRedo ? 1 : 0.4,
                        borderRadius: 'var(--fm-radius-sm)',
                      }}
                    >
                      <Redo2 size={13} />
                      REDO
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs" style={{ borderRadius: 'var(--fm-radius-sm)' }}>
                    Redo stroke
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toggle chevron button — vertical oval pill at panel edge */}
      <button
        onClick={() => onToggle(!isOpen)}
        className="relative transition-all duration-300"
        style={{
          pointerEvents: 'auto',
          width: '16px',
          height: '48px',
          backgroundColor: 'var(--fm-panel-bg)',
          border: '1px solid var(--fm-panel-border)',
          borderLeft: 'none',
          borderRadius: '0 8px 8px 0',
          marginLeft: isOpen ? '0px' : '0px',
          boxShadow: 'var(--fm-shadow-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          outline: 'none',
        }}
        aria-label={isOpen ? 'Collapse left panel' : 'Expand left panel'}
      >
        {isOpen
          ? <ChevronLeft size={12} style={{ color: 'var(--fm-text-muted)' }} />
          : <ChevronRight size={12} style={{ color: 'var(--fm-text-muted)' }} />
        }
      </button>
    </div>
  );
}