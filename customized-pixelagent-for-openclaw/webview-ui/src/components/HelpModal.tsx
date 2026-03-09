interface HelpModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'M', desc: 'Toggle sound on/off' },
  { key: 'T', desc: 'Cycle through themes (Default → Night → Retro)' },
  { key: 'H', desc: 'Toggle sidebar show/hide' },
  { key: 'F', desc: 'Toggle fullscreen mode' },
  { key: 'N', desc: 'Toggle desktop notifications on/off' },
  { key: 'E', desc: 'Toggle layout edit mode' },
  { key: 'Ctrl+Z', desc: 'Undo (in edit mode)' },
  { key: 'Ctrl+Y', desc: 'Redo (in edit mode)' },
  { key: 'Delete', desc: 'Delete selected furniture (in edit mode)' },
  { key: 'R', desc: 'Rotate selected furniture (in edit mode)' },
  { key: 'Scroll', desc: 'Zoom in/out' },
  { key: 'Middle drag', desc: 'Pan the canvas' },
];

const FEATURES = [
  { icon: '📋', name: 'Live Task Feed', desc: 'Sidebar shows each agent\'s current status, actions, and micro-log' },
  { icon: '🖱', name: 'Hover Tooltip', desc: 'Hover over a character for detailed info and task duration' },
  { icon: '🎨', name: 'Agent Colors', desc: 'Each agent gets a unique color; freed when they disconnect' },
  { icon: '🔊', name: 'Sound Effects', desc: 'Subtle audio for typing, waiting, arrivals, and completions' },
  { icon: '🔔', name: 'Notifications', desc: 'Desktop alerts when agents need input or finish tasks' },
  { icon: '🌙', name: 'Themes', desc: 'Default, Night Mode, and Retro Terminal themes' },
  { icon: '📊', name: 'Stats Bar', desc: 'Live stats at the bottom: tasks, files, commands, uptime' },
  { icon: '🌅', name: 'Day/Night Cycle', desc: 'Office lighting shifts based on real wall-clock time' },
  { icon: '🎭', name: 'Idle Animations', desc: 'Characters bounce and look around after 30s of inactivity' },
];

export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1a2e',
          border: '2px solid rgba(255,255,255,0.15)',
          borderRadius: 4,
          padding: '20px 24px',
          maxWidth: 560,
          maxHeight: '80vh',
          overflowY: 'auto',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase' }}>
            Pixel Agents — OpenClaw
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
          Features
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
          {FEATURES.map((f) => (
            <div key={f.name} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14, flexShrink: 0, width: 20 }}>{f.icon}</span>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 'bold' }}>{f.name}</span>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}> — {f.desc}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
          Keyboard Shortcuts
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SHORTCUTS.map((s) => (
            <div key={s.key} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <kbd
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 2,
                  padding: '1px 6px',
                  fontSize: 10,
                  minWidth: 60,
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.9)',
                  flexShrink: 0,
                }}
              >
                {s.key}
              </kbd>
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{s.desc}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
          Press ? or click outside to close
        </div>
      </div>
    </div>
  );
}
