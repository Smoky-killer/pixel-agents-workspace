import { useCallback, useEffect, useState } from 'react';

export type Theme = 'default' | 'night' | 'retro';

const THEMES: Theme[] = ['default', 'night', 'retro'];
const THEME_LABELS: Record<Theme, string> = {
  default: 'Default',
  night: 'Night Mode',
  retro: 'Retro Terminal',
};
const THEME_ICONS: Record<Theme, string> = {
  default: '🌞',
  night: '🌙',
  retro: '📺',
};

const STORAGE_KEY = 'pixelagent-theme';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme;
      if (THEMES.includes(saved)) return saved;
    } catch { /* ignore */ }
    return 'default';
  });

  // Apply theme class to document body
  useEffect(() => {
    document.body.classList.remove('theme-default', 'theme-night', 'theme-retro');
    document.body.classList.add(`theme-${theme}`);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) => {
      const idx = THEMES.indexOf(prev);
      return THEMES[(idx + 1) % THEMES.length];
    });
  }, []);

  return [theme, cycleTheme];
}

interface ThemeSwitcherProps {
  theme: Theme;
  onCycle: () => void;
}

export function ThemeSwitcher({ theme, onCycle }: ThemeSwitcherProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onCycle}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={`Theme: ${THEME_LABELS[theme]}`}
        style={{
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 2,
          color: 'rgba(255,255,255,0.8)',
          fontSize: 16,
          padding: '4px 8px',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {THEME_ICONS[theme]}
      </button>
      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: 'rgba(0,0,0,0.9)',
            color: 'rgba(255,255,255,0.85)',
            fontSize: 10,
            padding: '3px 7px',
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.15)',
            whiteSpace: 'nowrap',
            zIndex: 200,
          }}
        >
          {THEME_LABELS[theme]}
        </div>
      )}
    </div>
  );
}
