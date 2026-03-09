import type { AgentMessage } from '../hooks/useExtensionMessages.js';

function getAgentRole(name: string): 'commander' | 'dispatcher' | 'worker' {
  const lower = name.toLowerCase();
  if (lower === 'nova') return 'commander';
  if (lower.includes('dispatch')) return 'dispatcher';
  return 'worker';
}

const ROLE_COLORS: Record<string, string> = {
  commander: '#ffd700',
  dispatcher: '#4a9eff',
  worker: '#4ade80',
};

const ROLE_ICONS: Record<string, string> = {
  commander: '★',
  dispatcher: '⚙',
  worker: '▸',
};

interface ConversationFeedProps {
  messages: AgentMessage[];
}

export function ConversationFeed({ messages }: ConversationFeedProps) {
  if (messages.length === 0) return null;

  const now = Date.now();
  // Show newest-first (messages[0] is newest), up to 6 entries
  const visible = messages.slice(0, 6);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: 'rgba(8,10,18,0.88)',
        borderBottom: '1px solid rgba(74,158,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '0 8px',
        height: 26,
        overflowX: 'auto',
        overflowY: 'hidden',
        pointerEvents: 'none',
        scrollbarWidth: 'none',
      }}
    >
      {visible.map((msg, i) => {
        const fromRole = getAgentRole(msg.fromName);
        const toRole = msg.toName ? getAgentRole(msg.toName) : null;
        const fromColor = ROLE_COLORS[fromRole];
        const toColor = toRole ? ROLE_COLORS[toRole] : null;
        const ageSec = Math.floor((now - msg.timestamp) / 1000);
        const ageText = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
        // Fade older messages
        const opacity = Math.max(0.35, 1 - i * 0.12);

        const shortText =
          msg.text.length > 40 ? msg.text.slice(0, 39) + '…' : msg.text;

        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
              opacity,
              padding: '0 8px',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              height: '100%',
            }}
          >
            <span style={{ color: fromColor, fontSize: 10, fontWeight: 'bold' }}>
              {ROLE_ICONS[fromRole]}
            </span>
            <span style={{ color: fromColor, fontSize: 10 }}>{msg.fromName}</span>
            {msg.toName && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>→</span>
                <span style={{ color: toColor!, fontSize: 10, fontWeight: 'bold' }}>
                  {ROLE_ICONS[toRole!]}
                </span>
                <span style={{ color: toColor!, fontSize: 10 }}>{msg.toName}</span>
              </>
            )}
            <span style={{ color: 'rgba(200,220,255,0.7)', fontSize: 10, fontStyle: 'italic' }}>
              "{shortText}"
            </span>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>{ageText}</span>
          </div>
        );
      })}
    </div>
  );
}
