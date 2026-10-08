export type Place = {
  runsOn: string
  cwd: string
  dirs: string[]
  worktree: string
  git: string
}

export type Activity = {
  startedAt: number | null
  endedAt: number | null
  turnId: string | null
  outcome: string
}

export type Entry = {
  id: string
  label: string
  startedAt: number
  endedAt: number | null
  failed: boolean
}

export type Step = { id: string; subject: string; status: string }

export type Meter = {
  label: string
  percent: number | null
  note: string
  // When a limit resets, in epoch milliseconds.
  until?: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      place: Place | null
      meters: Meter[]
      title: string | null
      added: string[]
      transcript: string | null
      startedAt: number | null
      activity: Activity
      steps: Step[]
      theme: string
      cache: { read: number; fresh: number } | null
      log: { calls: number; rows: Entry[]; mark: number; spans: number[] }
    }
  }
}
