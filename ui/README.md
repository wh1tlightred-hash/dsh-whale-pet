# Renderer contract

Load `index.html` through Electron `loadFile`, with context isolation, sandbox and no Node integration. Host window sizes: collapsed **300 × 180**; the pet is the same size in both layouts. Expanded is **300** wide and as tall as the renderer reports (at least 300, at most the work area). The panel itself is a fixed 276px wide, so its height can be measured before the window resizes. Keep the window bottom edge anchored when resizing. Only the top header and character image region are draggable. The status bubble opens and closes the panel. Right-clicking the pet asks the host for its menu (`showMenu()`). No calls request focus or create audio.

Preload supplies `window.whale`:

- `onState(callback)` subscribes and delivers the current state immediately; optionally returns an unsubscribe function.
- `decide(id, decision)` resolves `{ok, error?}`. Decision is `allowed-once` or `rejected`.
- `setExpanded(boolean, height?)` resizes the host window; when expanded, `height` is the window height the open panel needs. The renderer re-reports it after every render.
- `setAlwaysOnTop(boolean)` toggles always-on-top (initially true).
- `hide()` hides to tray; host must provide a way to restore it.

State: `{connected, projects:[{id,name,status,detail,updatedAt}], approvals:[{id,projectId,projectName,tool,reason,operation}], notice:{id,kind,title,body}|null}`. Optional state fields: `forceExpanded: true` expands the panel (idempotent); `alwaysOnTop: boolean` synchronizes the pin control; `demo: true` labels host-provided sample data as demonstration. Status values: `idle`, `thinking`, `working`, `approval`, `completed`, `error`, `aborted`, `disconnected`. `operation` may be a string or serializable object. The UI uses `textContent` or text nodes for all dynamic content. New approvals expand the panel without focusing the host window. Missing operation details disable approval but allow rejection. Notices remain until dismissed or replaced by the host.

Opening the HTML without `window.whale` displays a clearly labeled, interactive demo with no external actions. Approval buttons then affect only local sample state.
