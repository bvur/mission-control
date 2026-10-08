import { expect, mock, test } from 'claude-code/testing'

const TITLE_ROW = JSON.stringify({
  type: 'custom-title',
  customTitle: 'Fix the login flow',
})

test('the band shows the session and its meters', async ($, on) => {
  let compactions = 0
  mock.clock(on, { now: 5_400_000 })
  mock.env(on, {
    COMPUTERNAME: 'BOX',
    CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    USERPROFILE: 'C:/Users/me',
  })
  on('session.cwd', () => ({ value: 'C:\\Users\\me\\work\\apps\\shop' }))
  on('session.root', () => ({ value: 'C:\\Users\\me\\work\\apps\\shop' }))
  on('session.id', () => ({ value: 'abc' }))
  on('settings.read', () => ({
    value: { permissions: { additionalDirectories: ['…/work/lib'] } },
  }))
  on('fs.read', () => ({ value: `{"type":"user"}\n${TITLE_ROW}\n` }))
  on('process.run', ($$, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('rev-parse')
        ? 'C:/work/app-wt\nC:/work/app/.git/worktrees/wt\nC:/work/app/.git\n'
        : e.argv.includes('status')
          ? '# branch.head feature/login\n# branch.ab +2 -0\n1 .M a.ts\n'
          : 'feature/login\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, tokens: 46000, percent: 23 },
      rateLimits: [
        {
          kind: 'five_hour',
          percentUsed: 14,
          resetsAt: new Date(5_400_000 + 3_600_000).toISOString(),
        },
      ],
    },
  }))
  on('session.start', ($$, e) => ({ cwd: e.cwd }))
  on('command.run', ($$, e) => {
    if (e.command === 'compact') compactions += 1

    return { text: '' }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('store.get', () => ({ value: 'Midnight' }))
  on('store.set', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {}, ref: 'r', text: '' }))

  await $.session.start({
    cwd: 'C:/work/app',
    surface: 'desktop',
    isInteractive: true,
  })

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read it', status: 'completed', activeForm: 'Reading it' },
      { content: 'Fix it', status: 'in_progress', activeForm: 'Fixing it' },
    ],
  })

  await $.tool.call({ tool: 'Read', file_path: 'C:/work/app/notes.md' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 20,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })
    const drawn = JSON.stringify(await ui.drawn())
    const shown = [
      'Fix the login flow',
      '…/apps/shop',
      '…/work/lib',
      'app-wt · feature/login',
      '1:30:00',
      '14% used',
      '1:00:00 left',
      '23% used · 46k of 200k tokens',
      'Fixing it · 1 of 2 steps',
      'Ready',
      '1. [✓] Read · notes.md',
      '0:00:00',
      'feature/login · 1 changed · ↑2',
    ]
    for (const text of shown) expect(drawn).toContain(text)
    expect(drawn).not.toContain('Users')
    // The terminal pass stepped from Midnight to Graphite before this one.
    if (surface === 'desktop') expect(drawn).toContain('#2a2a2c')
    await ui.press({ key: 'theme' })
    await ui.press({ key: 'compact' })
    await ui.unmount()
  }
  expect(compactions).toBe(2)
})
