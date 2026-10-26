// Ctrl + left click on the pet brings DSH's window forward. DSH holds a single-instance lock: starting
// its executable again makes the new process exit at once while the running DSH restores, shows (also
// from the tray) and focuses its window. The pet starts it because the pet is the foreground process
// right after the click, so Windows lets DSH take the foreground instead of only flashing in the taskbar.

// Variables that would change how the started executable runs (as Node, with the pet's pipe token, with
// DSH's development switches, or attached to this process's crash reporter) are left out.
const DROPPED = /^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$|^(DSH_WHALE_|DSH_DESKTOP_|CHROME_)/i;

/** The command that brings DSH forward, or null when the Host did not say where DSH is. */
function dshLaunch(env = process.env, exists = require('node:fs').existsSync) {
  const command = env.DSH_WHALE_DSH_EXE;
  if (typeof command !== 'string' || !command || !exists(command)) return null;
  return { command, env: Object.fromEntries(Object.entries(env).filter(([key]) => !DROPPED.test(key))) };
}

module.exports = { dshLaunch };
