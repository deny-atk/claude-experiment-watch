export type Alert = { sig: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'experiment-watch': { alert: Alert | null; dismissed: string | null }
  }
}
