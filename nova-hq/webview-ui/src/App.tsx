import { useCallback, useEffect, useRef, useState } from 'react';

import { BottomToolbar } from './components/BottomToolbar.js';
import { DebugView } from './components/DebugView.js';
import { HelpModal } from './components/HelpModal.js';
import { AgentSidebar } from './components/AgentSidebar.js';
import { ConversationFeed } from './components/ConversationFeed.js';
import { StatsBar } from './components/StatsBar.js';
import { ThemeSwitcher, useTheme } from './components/ThemeSwitcher.js';
import { ZoomControls } from './components/ZoomControls.js';
import { PULSE_ANIMATION_DURATION_SEC } from './constants.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { useSoundEffects } from './hooks/useSoundEffects.js';
import { useDesktopNotifications } from './hooks/useDesktopNotifications.js';
import { isSoundEnabled, setSoundEnabled } from './notificationSound.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { getCharacterSprites } from './office/sprites/spriteData.js';
import { EditTool } from './office/types.js';
import { Direction } from './office/types.js';
import { SpriteCanvas } from './components/SpriteCanvas.js';
import { vscode } from './vscodeApi.js';
import { ZoneOverlay } from './zones/ZoneOverlay.js';
import { useZoneState } from './zones/useZoneState.js';
import { CharacterSelector } from './components/CharacterSelector.js';
import { zoneManager } from './zones/ZoneManager.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '22px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const actionBarBtnDisabled: React.CSSProperties = {
  ...actionBarBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
};

function EditActionBar({
  editor,
  editorState: es,
}: {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        style={redoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title="Redo (Ctrl+Y)"
      >
        Redo
      </button>
      <button style={actionBarBtnStyle} onClick={editor.handleSave} title="Save layout">
        Save
      </button>
      {!showResetConfirm ? (
        <button
          style={actionBarBtnStyle}
          onClick={() => setShowResetConfirm(true)}
          title="Reset to last saved layout"
        >
          Reset
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-reset-text)' }}>Reset?</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => {
              setShowResetConfirm(false);
              editor.handleReset();
            }}
          >
            Yes
          </button>
          <button style={actionBarBtnStyle} onClick={() => setShowResetConfirm(false)}>
            No
          </button>
        </div>
      )}
    </div>
  );
}

/** Compute the day/night tint overlay based on current hour */
function getDayNightTint(): { color: string; opacity: number } {
  const h = new Date().getHours();
  if (h >= 6 && h < 9) return { color: 'rgba(255,160,50,1)', opacity: 0.15 };
  if (h >= 9 && h < 17) return { color: 'transparent', opacity: 0 };
  if (h >= 17 && h < 20) return { color: 'rgba(255,120,20,1)', opacity: 0.12 };
  if (h >= 20 && h < 23) return { color: 'rgba(20,40,100,1)', opacity: 0.2 };
  return { color: 'rgba(0,10,40,1)', opacity: 0.4 }; // 11pm–6am
}

/** Format duration from ms */
function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function App() {
  const editor = useEditorActions(getOfficeState, editorState);
  const sounds = useSoundEffects();
  const zoneState = useZoneState();

  // Refs for canvas-based zone chrome (read imperatively in render loop)
  const activeZonesRef = useRef(new Set<string>());
  const agentCountsRef = useRef<Record<string, { active: number; total: number }>>({});
  const agentStatusListRef = useRef<import('./zones/ZoneRenderer.js').ZoneAgentStatus[]>([]);

  // Sync refs when zoneState changes
  useEffect(() => {
    activeZonesRef.current = zoneState.activeZones;
    agentCountsRef.current = zoneState.agentCounts;
    // Build status list from knownAgentIds + activeAgentIds
    const list: import('./zones/ZoneRenderer.js').ZoneAgentStatus[] = [];
    const config = zoneManager.config;
    if (config) {
      for (const zone of config.zones) {
        const known = zoneState.knownAgentIds[zone.id] ?? new Set<number>();
        const active = zoneState.activeAgentIds[zone.id] ?? new Set<number>();
        for (const agent of zone.agents ?? []) {
          if (!known.has(agent.agentId)) continue;
          list.push({ name: agent.name, isActive: active.has(agent.agentId), zoneId: zone.id });
        }
      }
    }
    agentStatusListRef.current = list;
  }, [zoneState.activeZones, zoneState.agentCounts, zoneState.knownAgentIds, zoneState.activeAgentIds, zoneState.tick]);

  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem('pixelagent-notif-enabled') !== '0'; } catch { return true; }
  });
  const notif = useDesktopNotifications(notifEnabled);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    loadedAssets,
    workspaceFolders,
    agentNames,
    agentActionHistory,
    agentLastAction,
    agentLastFile,
    agentTaskStartTime,
    agentTaskCount,
    globalStats,
    conversationLog,
  } = useExtensionMessages(
    getOfficeState,
    editor.setLastSavedLayout,
    isEditDirty,
    sounds.onAgentArrived,
    sounds.onAgentLeft,
    notif.onAgentWaiting,
    notif.onAgentTaskComplete,
    notif.onAgentConnected,
    sounds.onTypingTick,
    sounds.onAgentTaskComplete,
  );

  const [isDebugMode, setIsDebugMode] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState<boolean | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCharSelector, setShowCharSelector] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const [theme, cycleTheme] = useTheme();

  // Hover tooltip state
  const [hoveredAgentId, setHoveredAgentId] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const tooltipHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHoverAgentChange = useCallback((id: number | null, x: number, y: number) => {
    if (tooltipHideTimer.current) {
      clearTimeout(tooltipHideTimer.current);
      tooltipHideTimer.current = null;
    }
    if (id === null) {
      tooltipHideTimer.current = setTimeout(() => setHoveredAgentId(null), 150);
    } else {
      setHoveredAgentId(id);
      setTooltipPos({ x, y });
    }
  }, []);

  // Day/night tint — update every 5 minutes
  const [dayNightTint, setDayNightTint] = useState(getDayNightTint);
  useEffect(() => {
    const id = setInterval(() => setDayNightTint(getDayNightTint()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Gateway status — handle both single and multi-zone status messages
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'gatewayStatus') {
        const connected = e.data.connected as boolean;
        setGatewayConnected(connected);
        if (connected) notif.onGatewayConnected();
        else notif.onGatewayDisconnected();
      }
      // Multi-zone: any zone gateway connected = overall connected
      if (e.data?.type === 'zoneGatewayStatuses') {
        const statuses = e.data.statuses as Record<string, boolean>;
        const anyConnected = Object.values(statuses).some(v => v);
        setGatewayConnected(anyConnected);
        if (anyConnected) notif.onGatewayConnected();
      }
      if (e.data?.type === 'zoneGatewayStatus') {
        // Individual zone connected — mark overall as connected
        if (e.data.connected) {
          setGatewayConnected(true);
          notif.onGatewayConnected();
        }
      }
      // sourcesConfig arriving means server is alive — mark connected
      if (e.data?.type === 'sourcesConfig') {
        setGatewayConnected(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [notif]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);

  const handleSelectAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'focusAgent', id });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback((agentId: number) => {
    const os = getOfficeState();
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    vscode.postMessage({ type: 'focusAgent', id: focusId });
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Ignore modifier combos (handled by useEditorKeyboard)
      if (e.ctrlKey || e.metaKey) return;

      switch (e.key.toLowerCase()) {
        case 'm':
          e.preventDefault();
          setSoundOn((prev) => {
            const next = !prev;
            setSoundEnabled(next);
            try { localStorage.setItem('pixelagent-sounds-enabled', next ? '1' : '0'); } catch {}
            return next;
          });
          break;
        case 't':
          if (!editor.isEditMode) { e.preventDefault(); cycleTheme(); }
          break;
        case 'h':
          e.preventDefault();
          setSidebarVisible((prev) => !prev);
          break;
        case 'f':
          e.preventDefault();
          setIsFullscreen((prev) => !prev);
          break;
        case 'n':
          e.preventDefault();
          setNotifEnabled((prev) => {
            const next = !prev;
            try { localStorage.setItem('pixelagent-notif-enabled', next ? '1' : '0'); } catch {}
            return next;
          });
          break;
        case '?':
          e.preventDefault();
          setShowHelp((prev) => !prev);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editor.isEditMode, cycleTheme]);

  const officeState = getOfficeState();

  void editorTickForKeyboard;

  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  // Compute theme canvas filter
  const themeFilter =
    theme === 'night' ? 'brightness(0.6)' : theme === 'retro' ? 'grayscale(1)' : 'none';
  const themeOverlayColor =
    theme === 'night'
      ? 'rgba(0,20,60,0.3)'
      : theme === 'retro'
        ? 'rgba(0,255,70,0.15)'
        : 'transparent';

  // Hover tooltip data
  const hoveredCh = hoveredAgentId !== null ? officeState.characters.get(hoveredAgentId) : null;
  const hoveredName = hoveredAgentId !== null ? (agentNames[hoveredAgentId] || `Agent ${hoveredAgentId}`) : '';
  const hoveredTools = hoveredAgentId !== null ? (agentTools[hoveredAgentId] || []) : [];
  const activeTool = hoveredTools.find((t) => !t.done);
  const taskStart = hoveredAgentId !== null ? agentTaskStartTime[hoveredAgentId] : undefined;
  const taskDuration = taskStart ? fmtDuration(Date.now() - taskStart) : null;

  if (!layoutReady) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: 'var(--pixel-bg, #1e1e2e)',
          color: '#cdd6f4',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ fontSize: 20 }}>
          {gatewayConnected === false
            ? 'Nova HQ — Loading zones...'
            : 'Loading...'}
        </div>
        {gatewayConnected === false && (
          <div
            style={{
              width: 24,
              height: 24,
              border: '3px solid #89b4fa',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#1e1e2e' }}
    >
      <style>{`
        @keyframes pixel-agents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }

        /* Retro scanline effect */
        .theme-retro .canvas-scanlines::after {
          content: '';
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.12) 2px,
            rgba(0,0,0,0.12) 4px
          );
          pointer-events: none;
          z-index: 41;
        }
      `}</style>

      {/* Main content area: canvas + sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Canvas area */}
        <div
          className="canvas-scanlines"
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            filter: themeFilter,
          }}
        >
          {/* Multi-zone HUD + zone overlays */}
          {zoneState.configLoaded && (
            <ZoneOverlay
              hudMessages={zoneState.hudMessages}
              maxHudMessages={zoneState.maxHudMessages}
            />
          )}
          {/* Conversation feed top bar */}
          {!zoneState.configLoaded && <ConversationFeed messages={conversationLog} />}
          <OfficeCanvas
            officeState={officeState}
            onClick={handleClick}
            isEditMode={editor.isEditMode}
            editorState={editorState}
            onEditorTileAction={editor.handleEditorTileAction}
            onEditorEraseAction={editor.handleEditorEraseAction}
            onEditorSelectionChange={editor.handleEditorSelectionChange}
            onDeleteSelected={editor.handleDeleteSelected}
            onRotateSelected={editor.handleRotateSelected}
            onDragMove={editor.handleDragMove}
            editorTick={editor.editorTick}
            zoom={editor.zoom}
            onZoomChange={editor.handleZoomChange}
            panRef={editor.panRef}
            onHoverAgentChange={handleHoverAgentChange}
            zoneManager={zoneState.configLoaded ? zoneManager : undefined}
            zoneTick={zoneState.tick}
            activeZonesRef={activeZonesRef}
            agentCountsRef={agentCountsRef}
            agentStatusListRef={agentStatusListRef}
          />

          <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

          {/* Character selector button */}
          {zoneState.configLoaded && (
            <button
              onClick={() => setShowCharSelector(s => !s)}
              title="Agent Characters"
              style={{
                position: 'absolute',
                bottom: 48,
                right: 12,
                zIndex: 46,
                background: 'rgba(10,10,20,0.85)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                cursor: 'pointer',
                padding: '4px 8px',
                fontFamily: 'monospace',
                fontSize: 11,
                borderRadius: 3,
              }}
            >
              Agents
            </button>
          )}

          {/* Character selector modal */}
          {showCharSelector && zoneState.configLoaded && (
            <CharacterSelector
              zoneManager={zoneManager}
              onClose={() => setShowCharSelector(false)}
            />
          )}

          {/* Theme color overlay */}
          {themeOverlayColor !== 'transparent' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: themeOverlayColor,
                pointerEvents: 'none',
                zIndex: 39,
              }}
            />
          )}

          {/* Day/night overlay */}
          {dayNightTint.opacity > 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: dayNightTint.color,
                opacity: dayNightTint.opacity,
                pointerEvents: 'none',
                zIndex: 38,
                transition: 'opacity 5s ease, background 5s ease',
              }}
            />
          )}

          {/* Vignette overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--pixel-vignette)',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          />

          <BottomToolbar
            isEditMode={editor.isEditMode}
            onOpenClaude={editor.handleOpenClaude}
            onToggleEditMode={editor.handleToggleEditMode}
            isDebugMode={isDebugMode}
            onToggleDebugMode={handleToggleDebugMode}
            workspaceFolders={workspaceFolders}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {showRotateHint && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: '50%',
                transform: editor.isDirty ? 'translateX(calc(-50% + 100px))' : 'translateX(-50%)',
                zIndex: 49,
                background: 'var(--pixel-hint-bg)',
                color: '#fff',
                fontSize: '20px',
                padding: '3px 8px',
                borderRadius: 0,
                border: '2px solid var(--pixel-accent)',
                boxShadow: 'var(--pixel-shadow)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Press <b>R</b> to rotate
            </div>
          )}

          {editor.isEditMode &&
            (() => {
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              return (
                <EditorToolbar
                  activeTool={editorState.activeTool}
                  selectedTileType={editorState.selectedTileType}
                  selectedFurnitureType={editorState.selectedFurnitureType}
                  selectedFurnitureUid={selUid}
                  selectedFurnitureColor={selColor}
                  floorColor={editorState.floorColor}
                  wallColor={editorState.wallColor}
                  onToolChange={editor.handleToolChange}
                  onTileTypeChange={editor.handleTileTypeChange}
                  onFloorColorChange={editor.handleFloorColorChange}
                  onWallColorChange={editor.handleWallColorChange}
                  onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                  onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                  loadedAssets={loadedAssets}
                />
              );
            })()}

          <ToolOverlay
            officeState={officeState}
            agents={agents}
            agentTools={agentTools}
            subagentCharacters={subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={handleCloseAgent}
          />

          {isDebugMode && (
            <DebugView
              agents={agents}
              selectedAgent={selectedAgent}
              agentTools={agentTools}
              agentStatuses={agentStatuses}
              subagentTools={subagentTools}
              onSelectAgent={handleSelectAgent}
            />
          )}

          {/* Top-left controls cluster */}
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              zIndex: 55,
              display: 'flex',
              gap: 6,
              alignItems: 'center',
            }}
          >
            {/* Theme switcher */}
            <ThemeSwitcher theme={theme} onCycle={cycleTheme} />

            {/* Sound toggle */}
            <button
              title={soundOn ? 'Sound on (M to toggle)' : 'Sound off (M to toggle)'}
              onClick={() => {
                setSoundOn((prev) => {
                  const next = !prev;
                  setSoundEnabled(next);
                  try { localStorage.setItem('pixelagent-sounds-enabled', next ? '1' : '0'); } catch {}
                  return next;
                });
              }}
              style={{
                background: 'rgba(0,0,0,0.6)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 2,
                color: soundOn ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
                fontSize: 16,
                padding: '4px 8px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              {soundOn ? '🔊' : '🔇'}
            </button>

            {/* Notifications toggle */}
            <button
              title={notifEnabled ? 'Notifications on (N to toggle)' : 'Notifications off (N to toggle)'}
              onClick={() => {
                setNotifEnabled((prev) => {
                  const next = !prev;
                  try { localStorage.setItem('pixelagent-notif-enabled', next ? '1' : '0'); } catch {}
                  return next;
                });
              }}
              style={{
                background: 'rgba(0,0,0,0.6)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 2,
                color: notifEnabled ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
                fontSize: 16,
                padding: '4px 8px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              {notifEnabled ? '🔔' : '🔕'}
            </button>

            {/* Sidebar toggle */}
            <button
              title="Toggle sidebar (H)"
              onClick={() => setSidebarVisible((v) => !v)}
              style={{
                background: 'rgba(0,0,0,0.6)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 2,
                color: sidebarVisible ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
                fontSize: 16,
                padding: '4px 8px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              ☰
            </button>

            {/* Help button */}
            <button
              title="Keyboard shortcuts & features"
              onClick={() => setShowHelp(true)}
              style={{
                background: 'rgba(0,0,0,0.6)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 2,
                color: 'rgba(255,255,255,0.5)',
                fontSize: 13,
                padding: '4px 7px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              ?
            </button>
          </div>

          {/* OpenClaw gateway dot (top-right of canvas) */}
          {gatewayConnected !== null && (
            <div
              title={gatewayConnected ? 'OpenClaw gateway connected' : 'OpenClaw gateway offline'}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 55,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: gatewayConnected ? '#a6e3a1' : '#f38ba8',
                border: '1px solid rgba(0,0,0,0.4)',
                boxShadow: gatewayConnected ? '0 0 6px #a6e3a1' : '0 0 6px #f38ba8',
              }}
            />
          )}

          {/* Hover tooltip */}
          {hoveredAgentId !== null && hoveredCh && (
            <HoverTooltip
              name={hoveredName}
              activeTool={activeTool?.status}
              taskDuration={taskDuration}
              lastFile={agentLastFile[hoveredAgentId]}
              taskCount={agentTaskCount[hoveredAgentId] || 0}
              palette={hoveredCh.palette}
              hueShift={hoveredCh.hueShift}
              x={tooltipPos.x}
              y={tooltipPos.y}
            />
          )}
        </div>

        {/* Sidebar */}
        {!isFullscreen && (
          <AgentSidebar
            agents={agents}
            agentNames={agentNames}
            agentTools={agentTools}
            agentStatuses={agentStatuses}
            agentActionHistory={agentActionHistory}
            agentLastAction={agentLastAction}
            agentLastFile={agentLastFile}
            agentTaskStartTime={agentTaskStartTime}
            agentTaskCount={agentTaskCount}
            gatewayConnected={gatewayConnected}
            characters={officeState.characters}
            isVisible={sidebarVisible}
          />
        )}

        {/* Fullscreen sidebar overlay */}
        {isFullscreen && sidebarVisible && (
          <div style={{ position: 'absolute', top: 0, right: 0, height: '100%', zIndex: 60, pointerEvents: 'auto' }}>
            <AgentSidebar
              agents={agents}
              agentNames={agentNames}
              agentTools={agentTools}
              agentStatuses={agentStatuses}
              agentActionHistory={agentActionHistory}
              agentLastAction={agentLastAction}
              agentLastFile={agentLastFile}
              agentTaskStartTime={agentTaskStartTime}
              agentTaskCount={agentTaskCount}
              gatewayConnected={gatewayConnected}
              characters={officeState.characters}
              isVisible={true}
            />
          </div>
        )}
      </div>

      {/* Stats bar at bottom */}
      <StatsBar stats={globalStats} />

      {/* Help modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// ── Hover Tooltip ────────────────────────────────────────────────
const PALETTE_HUES = [210, 120, 0, 270, 30, 180];

interface HoverTooltipProps {
  name: string;
  activeTool?: string;
  taskDuration: string | null;
  lastFile?: string;
  taskCount: number;
  palette: number;
  hueShift: number;
  x: number;
  y: number;
}

function HoverTooltip({ name, activeTool, taskDuration, lastFile, taskCount, palette, hueShift, x, y }: HoverTooltipProps) {
  const base = PALETTE_HUES[palette % PALETTE_HUES.length];
  const hue = (base + hueShift) % 360;
  const color = `hsl(${hue}, 60%, 65%)`;

  // Get idle sprite for tooltip
  let sprite: string[][] | null = null;
  try {
    const sprites = getCharacterSprites(palette, hueShift);
    sprite = sprites.walk[Direction.DOWN][0];
  } catch { sprite = null; }

  // Keep tooltip on screen (flip left if near right edge)
  const W = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const H = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const TW = 200, TH = 120;
  const left = x + TW + 12 > W ? x - TW - 12 : x + 12;
  const top = Math.min(y - 20, H - TH - 8);

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 200,
        background: 'rgba(10,10,20,0.95)',
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: '8px 10px',
        minWidth: TW,
        pointerEvents: 'none',
        boxShadow: `0 0 10px ${color}40`,
      }}
    >
      {/* Header with color bar */}
      <div
        style={{
          background: `${color}20`,
          borderBottom: `1px solid ${color}40`,
          margin: '-8px -10px 6px',
          padding: '4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        {sprite && <SpriteCanvas sprite={sprite} scale={2} />}
        <span style={{ color, fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase' }}>
          {name}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {activeTool && (
          <div>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>tool: </span>
            {activeTool.length > 30 ? activeTool.slice(0, 30) + '…' : activeTool}
          </div>
        )}
        {taskDuration && (
          <div>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>duration: </span>
            {taskDuration}
          </div>
        )}
        {lastFile && (
          <div>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>last file: </span>
            {lastFile}
          </div>
        )}
        <div>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>tasks: </span>
          {taskCount}
        </div>
      </div>
    </div>
  );
}

export default App;
