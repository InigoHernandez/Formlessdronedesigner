// RecordButton.tsx — Standalone recording control component
// Must live OUTSIDE DrawingCanvas to avoid remount-on-every-render bug.
// All state lives in DrawingCanvas and is passed via props.

import React from 'react';

type RecordState = 'idle' | 'recording' | 'recorded';

interface RecordButtonProps {
  recordState: RecordState;
  recordSeconds: number;
  maxSeconds: number;
  isMobile: boolean;
  isDark?: boolean;
  isGateMode: boolean;
  onStart: () => void;
  onStop: () => void;
  onDownload: () => void;
  onClear: () => void;
}

export function RecordButton({
  recordState,
  recordSeconds,
  maxSeconds,
  isMobile,
  isDark = true,
  isGateMode,
  onStart,
  onStop,
  onDownload,
  onClear,
}: RecordButtonProps) {
  if (typeof window !== 'undefined' && !window.MediaRecorder) return null;

  const progressPct = (recordSeconds / maxSeconds) * 100;
  const h = isMobile ? '52px' : '36px';

  // ── IDLE ──
  if (recordState === 'idle') {
    return (
      <button
        onClick={isGateMode ? undefined : onStart}
        style={{
          width: '100%',
          height: h,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          fontSize: '10px',
          letterSpacing: '0.12em',
          color: isGateMode ? 'var(--fm-text-muted)' : 'var(--fm-accent)',
          border: '1px solid var(--fm-panel-border)',
          backgroundColor: 'var(--fm-panel-bg)',
          opacity: isGateMode ? 0.4 : 1,
          cursor: isGateMode ? 'not-allowed' : 'pointer',
          pointerEvents: isGateMode ? 'none' : 'auto',
        }}
        title={isGateMode ? 'Recording not available in Gate mode' : 'Record audio loop (max 20s)'}
      >
        <span style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: isGateMode ? 'var(--fm-text-muted)' : 'var(--fm-accent)',
        }} />
        REC
      </button>
    );
  }

  // ── RECORDING ──
  if (recordState === 'recording') {
    return (
      <div
        style={{
          width: '100%',
          height: h,
          position: 'relative',
          display: 'flex',
          border: '1px solid var(--fm-accent)',
          overflow: 'hidden',
          animation: 'formless-rec-pulse 1.4s ease-in-out infinite',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute',
          inset: 0,
          width: `${progressPct}%`,
          backgroundColor: 'rgba(var(--fm-accent-rgb),0.15)',
          transition: 'width 1s linear',
          pointerEvents: 'none',
        }} />
        <button
          onClick={onStop}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--fm-accent)',
            cursor: 'pointer',
            position: 'relative',
            zIndex: 1,
          }}
          title="Stop recording"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="var(--fm-accent)" />
          </svg>
        </button>
        <div style={{
          width: '1px',
          height: '50%',
          alignSelf: 'center',
          backgroundColor: 'rgba(var(--fm-accent-rgb),0.3)',
          flexShrink: 0,
          zIndex: 1,
        }} />
        <button
          onClick={onClear}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'rgba(var(--fm-accent-rgb),0.5)',
            cursor: 'pointer',
            fontSize: '14px',
            lineHeight: 1,
            position: 'relative',
            zIndex: 1,
          }}
          title="Cancel recording"
        >
          ×
        </button>
      </div>
    );
  }

  // ── RECORDED ──
  return (
    <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
      <button
        onClick={onDownload}
        style={{
          flex: 1,
          height: h,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          fontSize: '10px',
          letterSpacing: '0.1em',
          color: 'var(--fm-accent)',
          border: '1px solid var(--fm-accent)',
          backgroundColor: 'rgba(var(--fm-accent-rgb), 0.08)',
          cursor: 'pointer',
        }}
        title="Download WAV"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
          <path
            d="M5.5 1v6M2.5 5.5l3 3 3-3M1 10h9"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        WAV
      </button>
      <button
        onClick={onClear}
        style={{
          width: isMobile ? '44px' : '36px',
          height: h,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          lineHeight: 1,
          color: 'var(--fm-text-muted)',
          border: '1px solid var(--fm-panel-border)',
          backgroundColor: 'var(--fm-panel-bg)',
          cursor: 'pointer',
        }}
        title="Discard recording"
      >
        ×
      </button>
    </div>
  );
}
