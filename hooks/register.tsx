import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionRateLimit,
} from 'claude-code'

import type { Activity, Entry, Meter, Place, Step } from '../types'

const DEFAULT_THEME = 'Forest'

const place = atom({ plugin: 'mission-control', key: 'place' } as const, null)
const meters = atom({ plugin: 'mission-control', key: 'meters' } as const, [])
const title = atom({ plugin: 'mission-control', key: 'title' } as const, null)
const added = atom({ plugin: 'mission-control', key: 'added' } as const, [])
const transcript = atom(
  { plugin: 'mission-control', key: 'transcript' } as const,
  null,
)
const startedAt = atom(
  { plugin: 'mission-control', key: 'startedAt' } as const,
  null,
)

const activity = atom({ plugin: 'mission-control', key: 'activity' } as const, {
  startedAt: null,
  endedAt: null,
  turnId: null,
  outcome: '',
})
const log = atom({ plugin: 'mission-control', key: 'log' } as const, {
  calls: 0,
  rows: [],
  mark: 0,
  spans: [],
})
const steps = atom({ plugin: 'mission-control', key: 'steps' } as const, [])

const cache = atom({ plugin: 'mission-control', key: 'cache' } as const, null)

// How long the prompt cache outlives the last request: 60 on plans with the
// one-hour cache, 5 otherwise.
const CACHE_MINUTES = 60
const theme = atom(
  { plugin: 'mission-control', key: 'theme' } as const,
  DEFAULT_THEME,
)

const scroll = atom({ plugin: 'mission-control', key: 'scroll' } as const, 0)

const LABEL_COLUMNS = 17
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LIMIT_LABELS: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'Weekly limit',
  spend_limit: 'Spend limit',
}

async function attempt<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call()
  } catch {
    return fallback
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(part => part !== '').at(-1) ?? path
}

// A theme: the panel, the chips' inset, hairlines, ink, the accent with its
// deeper shade, and the patch behind the app's own buttons. The app lays a
// faint white film over a button, so a patch is a shade darker than it reads.
type Theme = {
  // Ink for the app's dark mode, on a theme that paints no panel of its own
  // and so sits on whatever the app draws behind it.
  night?: string
  font?: string
  advance?: number
  panel: string
  inset: string
  line: string
  ink: string
  accent: string
  deep: string
  patch: string
}

const THEMES: Record<string, Theme> = {
  Forest: {
    panel: '#262f2c',
    inset: '#1f2322',
    line: '#797f7d',
    ink: '#e3e8e5',
    accent: '#8fdce8',
    deep: '#4e9fae',
    patch: '#7d8482',
  },
  Midnight: {
    panel: '#1b2233',
    inset: '#141a28',
    line: '#6b7690',
    ink: '#e4e9f5',
    accent: '#9db8ff',
    deep: '#5f7bd0',
    patch: '#77819b',
  },
  Graphite: {
    panel: '#2a2a2c',
    inset: '#1e1e20',
    line: '#7c7c80',
    ink: '#ececee',
    accent: '#f2b880',
    deep: '#b98249',
    patch: '#828286',
  },
  Paper: {
    panel: '#f3f1ec',
    inset: '#e6e3dc',
    line: '#9a968c',
    ink: '#26251f',
    accent: '#1f8a8a',
    deep: '#5fb3b3',
    patch: '#d2cec4',
  },
  Ocean: {
    panel: '#10262e',
    inset: '#0b1c22',
    line: '#5d7f8a',
    ink: '#dff1f5',
    accent: '#5fd0c5',
    deep: '#2f8f88',
    patch: '#6f8d96',
  },
  Plum: {
    panel: '#2a2133',
    inset: '#1f1826',
    line: '#86789a',
    ink: '#ece6f5',
    accent: '#d7a6ff',
    deep: '#9566c9',
    patch: '#8a7e9c',
  },
  Ember: {
    panel: '#2b211d',
    inset: '#1f1714',
    line: '#8f7b70',
    ink: '#f3e9e2',
    accent: '#ff9d6e',
    deep: '#c4623a',
    patch: '#907f75',
  },
  Slate: {
    panel: '#232a33',
    inset: '#1a2028',
    line: '#76828f',
    ink: '#e6ebf1',
    accent: '#7fd1a8',
    deep: '#4b9a77',
    patch: '#7d8894',
  },
  Sand: {
    panel: '#efe6d6',
    inset: '#e2d7c3',
    line: '#a39579',
    ink: '#2b2618',
    accent: '#b5651d',
    deep: '#d99a5b',
    patch: '#d0c4ac',
  },
}
// Only fonts installed on this computer can be drawn.
const MONO = "'JetBrains Mono', Consolas, monospace"
let FONT = MONO
// Widths are worked out from the text, as shares of the font size: one
// advance for every glyph of a monospaced font, a rough table otherwise.
let ADVANCE = 0.6
let IS_PROPORTIONAL = false
// A clock's digit and colon cells.
let DIGIT = 0.6
let COLON = 0.6
let PANEL = ''
let INSET = ''
let LINE = ''
let INK = ''
let MINT = ''
let MOSS = ''
let PATCH = ''
let GREEN = ''
const AMBER = '#e0a458'
const RED = '#e5695f'
// Selectable text, in the theme's ink whatever the app's own theme.
let STYLE = ''
let RULE = ''
// The divider's line sits near its top, leaving room beneath it.
const RULE_HEIGHT = 11

// Every drawing reads these, so a render sets them before it draws.
function applyTheme(name: string): void {
  const theme = THEMES[name] ?? THEMES[DEFAULT_THEME]
  if (theme === undefined) return
  FONT = theme.font ?? MONO
  IS_PROPORTIONAL = theme.advance !== undefined
  ADVANCE = theme.advance ?? 0.6
  DIGIT = IS_PROPORTIONAL ? 0.57 : 0.6
  COLON = IS_PROPORTIONAL ? 0.3 : 0.6
  PANEL = theme.panel
  INSET = theme.inset
  LINE = theme.line
  INK = theme.ink
  MINT = theme.accent
  MOSS = theme.deep
  PATCH = theme.patch
  GREEN = theme.accent
  const night =
    theme.night === undefined
      ? ''
      : `@media(prefers-color-scheme:dark){text{fill:${theme.night}}.s{stroke:${theme.night}}.t{fill:${theme.night}}}`
  STYLE =
    `<style>${theme.night === undefined ? '' : ':root{color-scheme:light dark}'}` +
    `text{user-select:text;-webkit-user-select:text;cursor:text;fill:${INK}}` +
    `.s{stroke:${INK}}.t{fill:${INK}}.b{stroke:${LINE}}${night}` +
    `.m{fill:${MINT}}.g{fill:${GREEN}}.a{fill:${AMBER}}</style>`
  RULE =
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${RULE_HEIGHT}" viewBox="0 0 2000 ${RULE_HEIGHT}" preserveAspectRatio="none">` +
    `<rect width="2000" height="${RULE_HEIGHT}" fill="${PANEL}"/><rect y="2" width="2000" height="1" fill="${LINE}" fill-opacity="0.6"/></svg>`
}

applyTheme(DEFAULT_THEME)

const FONT_SIZE = 11
const CHIP_HEIGHT = 22
const METER_HEIGHT = 16
// Painted first in every drawing, so a framed one sits on the panel's colour.
function backdrop(width: number, height: number): string {
  return `<rect width="${width}" height="${height}" fill="${PANEL}"/>`
}
// Lucide icons (ISC licence), 24x24, stroked.
const ICONS = {
  laptop:
    '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  folderPlus:
    '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  branch:
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  commit:
    '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
}

// Longer names are cut on the chip; its copy button still gives all of it.
const CHIP_LETTERS = 42
// Clear room under a chip, so chips that wrap onto a second line do not touch.
const CHIP_GAP = 6

type Chip = {
  icon: keyof typeof ICONS
  label: string
  isUnset?: boolean
  // What the copy button beside the chip puts on the clipboard.
  copy?: string
}

function chipWidth(chip: Chip): number {
  return chip.label === ''
    ? 30
    : 36 + textWidth(shorten(chip.label, CHIP_LETTERS))
}

function chipSvg(chip: Chip): string {
  const width = chipWidth(chip)
  const frame = chip.isUnset ? ' stroke-dasharray="3 3"' : ''
  const ink = chip.isUnset ? ' fill-opacity="0.7" font-style="italic"' : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CHIP_HEIGHT + CHIP_GAP}" viewBox="0 0 ${width} ${CHIP_HEIGHT + CHIP_GAP}">${STYLE}${backdrop(width, CHIP_HEIGHT + CHIP_GAP)}` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${CHIP_HEIGHT - 1}" rx="6" fill="${INSET}" class="b" stroke="${LINE}"${frame}/>` +
    `<g transform="translate(8 4) scale(0.5833)" fill="none" class="s" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[chip.icon]}</g>` +
    `<text x="28" y="15" font-family="${FONT}" font-size="${FONT_SIZE}" fill="${INK}"${ink}>${escapeXml(shorten(chip.label, CHIP_LETTERS))}</text>` +
    `</svg>`
  )
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const pair = (value: number): string => String(value).padStart(2, '0')

  return `${hours}:${pair(Math.floor(seconds / 60) % 60)}:${pair(seconds % 60)}`
}

const SIDE_HEIGHT = 16

// One digit that counts by itself: a strip of glyphs stepped by the SVG's own
// animation, so the band is never redrawn for a clock.
function digitStrip(
  x: number,
  baseline: number,
  step: number,
  count: number,
  period: number,
  elapsed: number,
  down: boolean,
): string {
  const indexes = Array.from({ length: count }, (_, index) => index)
  const values = indexes.map(index => `0 ${-index * step}`).join(';')
  const glyphs = indexes
    .map(
      index =>
        `<text x="${x}" y="${baseline + index * step}" text-anchor="middle">${down ? count - 1 - index : index}</text>`,
    )
    .join('')

  return (
    `<g><animateTransform attributeName="transform" type="translate" calcMode="discrete" values="${values}" dur="${period}s" begin="-${elapsed % period}s" repeatCount="indefinite"/>` +
    `${glyphs}</g>`
  )
}

function clockWidth(size: number, seconds: number): number {
  return size * (DIGIT * (seconds >= 36_000 ? 6 : 5) + COLON * 2)
}

// A ticking H:MM:SS whose last digit ends at `right`; `down` counts the
// seconds away instead of up.
function tickingClock(
  right: number,
  baseline: number,
  size: number,
  seconds: number,
  ink: string,
  down = false,
): string {
  const step = Math.ceil(size * 1.6)
  const at = (digits: number, colons: number): number =>
    Math.round((right - (digits * DIGIT + colons * COLON) * size) * 10) / 10
  const strip = (x: number, count: number, period: number): string =>
    digitStrip(
      x,
      baseline,
      step,
      count,
      period,
      down ? period - 1 - (seconds % period) : seconds,
      down,
    )
  const strips = [
    strip(at(0.5, 0), 10, 10),
    strip(at(1.5, 0), 6, 60),
    strip(at(2.5, 1), 10, 600),
    strip(at(3.5, 1), 6, 3600),
    strip(at(4.5, 2), 10, 36_000),
    seconds >= 36_000 ? strip(at(5.5, 2), 10, 360_000) : '',
  ].join('')
  const top = Math.floor(baseline - size)

  return (
    `<clipPath id="w${baseline}"><rect x="0" y="${top}" width="2000" height="${Math.ceil(size * 1.3)}"/></clipPath>` +
    `<g clip-path="url(#w${baseline})" class="${ink}" font-family="${FONT}" font-size="${size}" font-weight="600">` +
    `<text x="${at(2, 0.5)}" y="${baseline}" text-anchor="middle" class="${ink}">:</text><text x="${at(4, 1.5)}" y="${baseline}" text-anchor="middle" class="${ink}">:</text>` +
    `${strips}</g>`
  )
}

// Room for the dot that sets a side note apart from the text before it.
const SIDE_GAP = 14

function sideSvg(inner: number, body: string): string {
  const width = inner + SIDE_GAP

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${SIDE_HEIGHT}" viewBox="0 0 ${width} ${SIDE_HEIGHT}">${STYLE}${backdrop(width, SIDE_HEIGHT)}` +
    `<text x="0" y="12" fill-opacity="0.6" font-family="${FONT}" font-size="${FONT_SIZE}">·</text>` +
    `<g transform="translate(${SIDE_GAP} 0)">${body}</g></svg>`
  )
}

function sideText(): string {
  return `font-family="${FONT}" font-size="${FONT_SIZE}"`
}

function textWidth(text: string): number {
  if (!IS_PROPORTIONAL) return Math.ceil(text.length * FONT_SIZE * ADVANCE)
  let shares = 0
  for (const glyph of text) {
    shares += /[iljtfrI.,:;'|· ]/.test(glyph)
      ? 0.3
      : /[mwMW%…]/.test(glyph)
        ? 0.86
        : /[A-Z]/.test(glyph)
          ? 0.64
          : 0.54
  }

  return Math.ceil(shares * FONT_SIZE)
}

function expiryWidth(remaining: number | null): number {
  const seconds = remaining === null ? 0 : Math.floor(remaining / 1000)

  return seconds <= 0
    ? textWidth('Cache expired')
    : Math.ceil(
        textWidth('Cache expires in') + 8 + clockWidth(FONT_SIZE, seconds),
      )
}

// When the prompt cache lapses: a countdown that swaps itself for the word
// once it runs out, with no redraw.
function expirySvg(remaining: number | null): string {
  const width = expiryWidth(remaining)
  const word = (label: string, ink: string): string =>
    `<text x="0" y="12" class="${ink}" ${sideText()}>${label}</text>`
  if (remaining === null) return sideSvg(width, word('Cache warm', 'g'))
  const seconds = Math.floor(remaining / 1000)
  if (seconds <= 0) return sideSvg(width, word('Cache expired', 'a'))

  return sideSvg(
    width,
    `<g><set attributeName="visibility" to="hidden" begin="${seconds}s"/>` +
      `<text x="0" y="12" ${sideText()}>Cache expires in</text>` +
      tickingClock(width, 12, FONT_SIZE, seconds, 't', true) +
      `</g>` +
      `<g visibility="hidden"><set attributeName="visibility" to="visible" begin="${seconds}s"/>${word('Cache expired', 'a')}</g>`,
  )
}

// How long until the current session's limit resets, or null with none due.
function timeLeft(bar: Meter, time: number): number | null {
  if (typeof bar.until !== 'number') return null
  const remaining = bar.until - time

  return remaining > 1000 ? remaining : null
}

// Past what the ticking clock can show, days and hours say enough.
const CLOCK_LIMIT = 360_000_000

function formatLeft(remaining: number): string {
  if (remaining < CLOCK_LIMIT) return `${formatElapsed(remaining)} left`
  const hours = Math.floor(remaining / 3_600_000)

  return `${Math.floor(hours / 24)}d ${hours % 24}h left`
}

function leftWidth(remaining: number): number {
  if (remaining >= CLOCK_LIMIT) return textWidth(formatLeft(remaining))
  const seconds = Math.max(0, Math.floor(remaining / 1000))

  return Math.ceil(clockWidth(FONT_SIZE, seconds) + 6 + textWidth('left'))
}

// How long until a limit resets, counting down by itself and gone at zero.
function leftSvg(remaining: number): string {
  const seconds = Math.max(0, Math.floor(remaining / 1000))
  const width = leftWidth(remaining)
  const clock = Math.ceil(clockWidth(FONT_SIZE, seconds))
  if (remaining >= CLOCK_LIMIT) {
    return sideSvg(
      width,
      `<text x="0" y="12" ${sideText()}>${formatLeft(remaining)}</text>`,
    )
  }

  return sideSvg(
    width,
    `<g><set attributeName="visibility" to="hidden" begin="${seconds}s"/>` +
      tickingClock(clock, 12, FONT_SIZE, seconds, 't', true) +
      `<text x="${clock + 6}" y="12" ${sideText()}>left</text></g>`,
  )
}

function expiryReading(remaining: number | null): string {
  if (remaining === null) return 'Cache warm'

  return remaining <= 0
    ? 'Cache expired'
    : `Cache expires in ${formatElapsed(remaining)}`
}

function shorten(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function isRunning(now: Activity): boolean {
  return now.startedAt !== null && now.endedAt === null
}

const OUTCOMES: Record<string, string> = {
  answer: 'Completed',
  aborted: 'Stopped',
  error: 'Failed',
  refusal: 'Refused',
}

function activityReading(now: Activity, calls: number): string {
  const tools = `${calls} tool ${calls === 1 ? 'call' : 'calls'}`
  if (isRunning(now)) return `Working · ${tools}`
  if (now.startedAt === null || now.endedAt === null) return 'Ready'
  const outcome = OUTCOMES[now.outcome] ?? 'Completed'

  return `${outcome} · ${formatElapsed(now.endedAt - now.startedAt)} · ${tools}`
}

// Green once the work is done, amber when it ended any other way.
function activityInk(now: Activity): string {
  if (isRunning(now)) return 't'

  return now.outcome === '' || now.outcome === 'answer' ? 'g' : 'a'
}

function stepsReading(list: Step[]): string {
  const done = list.filter(step => step.status === 'completed').length
  const current = list.find(step => step.status === 'in_progress')
  const count = `${done} of ${list.length} steps`

  return current === undefined
    ? count
    : `${shorten(current.subject, 16)} · ${count}`
}

const PROGRESS_WIDTH = 720
const WAVE_BLOCKS = 48
const WAVE_HEIGHT = 3

// The strip along the panel's top edge, stretched to its width. While a turn
// runs it fills by the task list's steps when there is one; with none there is
// no amount to show, so a slow wave runs along it instead.
function waveSvg(running: boolean, list: Step[]): string {
  const width = WAVE_BLOCKS * 5
  const done = list.filter(step => step.status === 'completed').length
  // A soft streak that glides across and fades out at both ends.
  const streak = width * 0.3
  const blocks =
    `<defs><linearGradient id="g"><stop offset="0" stop-color="${MINT}" stop-opacity="0"/><stop offset="0.7" stop-color="${MINT}"/><stop offset="1" stop-color="${MINT}" stop-opacity="0"/></linearGradient></defs>` +
    `<rect x="${-streak}" width="${streak}" height="${WAVE_HEIGHT}" fill="url(#g)"><animate attributeName="x" values="${-streak};${width}" dur="2s" repeatCount="indefinite"/></rect>`
  const body = !running
    ? ''
    : list.length > 0
      ? `<rect width="${(done / list.length) * width}" height="${WAVE_HEIGHT}" fill="${MINT}"/>`
      : blocks

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${WAVE_HEIGHT}" viewBox="0 0 ${width} ${WAVE_HEIGHT}" preserveAspectRatio="none">` +
    `<rect width="${width}" height="${WAVE_HEIGHT}" fill="${INSET}"/>${body}</svg>`
  )
}
const ROW_HEIGHT = 16
const ROW_COUNT = 5
// Every step of a turn is kept, up to this many; the panel shows a window.
const ROW_KEEP = 300
const SPAN_COUNT = 200
const ROW_EDGE = 670

// One step: its number, a box ticked once it is done, the tool's name and
// what the call was for, and how long the step took. A drawing of its own, so
// a finished step is never redrawn when the next one starts.
function rowSvg(
  row: Entry,
  number: number,
  time: number,
  running: boolean,
  total: number,
): string {
  const text = `font-family="${FONT}" font-size="${FONT_SIZE}" fill="${INK}"`
  const count = `<text x="20" y="12" text-anchor="end" fill-opacity="0.6" ${text}>${number}</text>`
  const box = `<rect x="27.5" y="3.5" width="9" height="9" rx="2" fill="none" class="b" stroke="${LINE}"/>`
  // The tool's name stands out from what the call was for.
  const [tool = '', ...rest] = shorten(row.label, 84).split(' · ')
  const words = rest.length > 0 ? ` · ${rest.join(' · ')}` : ''
  const label = `<text x="44" y="12" ${text}><tspan class="m" fill="${MINT}" font-weight="600">${escapeXml(tool)}</tspan>${escapeXml(words)}</text>`
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${PROGRESS_WIDTH}" height="${ROW_HEIGHT}" viewBox="0 0 ${PROGRESS_WIDTH} ${ROW_HEIGHT}">${STYLE}${backdrop(PROGRESS_WIDTH, ROW_HEIGHT)}`
  if (row.endedAt === null) {
    const seconds = Math.max(0, Math.floor((time - row.startedAt) / 1000))
    const pulse = running
      ? `<rect x="30" y="6" width="4" height="4" rx="1" fill="${MINT}"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></rect>`
      : ''
    const clock = running
      ? tickingClock(ROW_EDGE, 12, FONT_SIZE, seconds, 'm')
      : ''

    return `${open}${count}${box}${pulse}${label}${clock}</svg>`
  }
  const mark = row.failed
    ? `<path d="M30 6l4 4m0 -4l-4 4" fill="none" stroke="${RED}" stroke-width="1.6" stroke-linecap="round"/>`
    : `<path d="M29.5 8.5l2 2l3.5 -4.5" fill="none" stroke="${GREEN}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  const share =
    running || total <= 0
      ? ''
      : `<text x="${ROW_EDGE + 40}" y="12" text-anchor="end" fill-opacity="0.75" ${text}>${Math.round(((row.endedAt - row.startedAt) / total) * 100)}%</text>`

  return (
    `${open}${count}${box}${mark}${label}` +
    `<text x="${ROW_EDGE}" y="12" text-anchor="end" fill-opacity="0.75" ${text}>${formatElapsed(row.endedAt - row.startedAt)}</text>` +
    `${share}</svg>`
  )
}

const SHARE_TRACK = 240

// Once the turn is over the bar shows where its time went: one segment per
// step, as wide as that step's share of the whole.
function sharesSvg(spans: number[], total: number): string {
  let x = 0

  return spans
    .map((span, index) => {
      const width = (span / total) * SHARE_TRACK
      const segment =
        width < 0.5
          ? ''
          : `<rect x="${Math.round(x * 10) / 10}" y="6" width="${Math.max(0.5, Math.round((width - 1) * 10) / 10)}" height="4" rx="1" fill="${index % 2 === 0 ? MINT : MOSS}"/>`
      x += width

      return segment
    })
    .join('')
}

// The session's own clock, in the block's top right corner.
function sessionClock(ms: number, right: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const label = right - Math.ceil(clockWidth(FONT_SIZE, seconds)) - 8
  const start = label - textWidth('Conversation time')

  return (
    `<g transform="translate(${start - 18} 2) scale(0.5)" fill="none" class="s" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.clock}</g>` +
    `<text x="${label}" y="12" text-anchor="end" font-family="${FONT}" font-size="${FONT_SIZE}">Conversation time</text>` +
    `<g>${tickingClock(right, 12, FONT_SIZE, seconds, 't').replace(/w12/g, 'ws')}</g>`
  )
}

// The block above everything: the turn's own clock, a bar and a summary, then
// a row per step. While the turn runs the bar fills by the task list's steps
// when there is one, and otherwise only sweeps, since nothing says how much
// work is left.
function progressSvg(
  now: Activity,
  list: Step[],
  calls: number,
  spans: number[],
  time: number,
  session: number | null,
  width: number,
  note: string,
): string {
  const running = isRunning(now) && now.startedAt !== null
  const seconds = running
    ? Math.max(0, Math.floor((time - (now.startedAt ?? time)) / 1000))
    : 0
  const left = running ? Math.ceil(clockWidth(FONT_SIZE, seconds)) + 10 : 0
  const total = spans.reduce((sum, span) => sum + span, 0)
  const bar = !running && total > 0 ? sharesSvg(spans, total) : ''
  const edge = running
    ? left
    : total > 0
      ? SHARE_TRACK + 12
      : 0
  const height = ROW_HEIGHT

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${STYLE}${backdrop(width, height)}` +
    (running ? tickingClock(left - 10, 12, FONT_SIZE, seconds, 'm') : '') +
    bar +
    `<text x="${edge}" y="12" class="${activityInk(now)}" font-family="${FONT}" font-size="${FONT_SIZE}">${escapeXml(progressReading(now, list, calls) + note)}</text>` +
    (session === null ? '' : sessionClock(session, width)) +
    `</svg>`
  )
}

function progressReading(now: Activity, list: Step[], calls: number): string {
  return [activityReading(now, calls)]
    .concat(list.length > 0 ? [stepsReading(list)] : [])
    .join(' · ')
}

function rowReading(row: Entry, number: number): string {
  if (row.endedAt === null) return `${number}. [ ] ${row.label}`

  return `${number}. [${row.failed ? 'x' : '✓'}] ${row.label}  ${formatElapsed(row.endedAt - row.startedAt)}`
}

type Call = { tool: string } & Record<string, unknown>

function field(call: Record<string, unknown>, name: string): string {
  const value = call[name]

  return typeof value === 'string' ? value : ''
}

const TASK_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate']

// The tool's name and a few words on what this call is for.
function describeCall(call: Call): string {
  const detail = (): string => {
    switch (call.tool) {
      case 'Edit':
      case 'Write':
      case 'Read':
      case 'NotebookEdit':
        return baseName(
          field(call, 'file_path') || field(call, 'notebook_path'),
        )
      case 'Bash':
      case 'PowerShell':
        return field(call, 'description') || field(call, 'command')
      case 'Grep':
      case 'Glob':
        return field(call, 'pattern')
      case 'WebSearch':
        return field(call, 'query')
      case 'WebFetch':
        return field(call, 'url')
      case 'Agent':
        return field(call, 'description')
      case 'Skill':
        return field(call, 'skill')
      default:
        return ''
    }
  }
  const name = call.tool.startsWith('mcp__')
    ? (call.tool.split('__').at(-1) ?? call.tool).replace(/_/g, ' ')
    : call.tool
  const words = detail().replace(/\s+/g, ' ').trim()

  return words === '' ? name : `${name} · ${words}`
}

// Folds one task-list tool call into the steps the band counts.
function foldSteps(list: Step[], call: Call, result: unknown): Step[] {
  if (call.tool === 'TodoWrite' && Array.isArray(call.todos)) {
    return (call.todos as Record<string, unknown>[]).map((todo, index) => ({
      id: String(index),
      subject: field(todo, 'activeForm') || field(todo, 'content'),
      status: field(todo, 'status') || 'pending',
    }))
  }
  if (call.tool === 'TaskCreate') {
    const made = (result as { task?: { id?: unknown } } | undefined)?.task
    const id = typeof made?.id === 'string' ? made.id : `new-${list.length}`
    const subject = field(call, 'activeForm') || field(call, 'subject')

    return [...list, { id, subject, status: 'pending' }]
  }
  if (call.tool === 'TaskUpdate') {
    const status = field(call, 'status')
    if (status === 'deleted') {
      return list.filter(step => step.id !== call.taskId)
    }

    return list.map(step =>
      step.id === call.taskId
        ? {
            ...step,
            subject:
              field(call, 'activeForm') ||
              field(call, 'subject') ||
              step.subject,
            status: status || step.status,
          }
        : step,
    )
  }

  return list
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function clamp(percent: number): number {
  return Math.max(0, Math.min(100, percent))
}

function meterColor(percent: number): 'error' | 'warning' | 'suggestion' {
  return percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'suggestion'
}

function meterReading(bar: Meter): string {
  const reading =
    bar.percent === null
      ? 'no reading yet'
      : `${bar.percent}% ${bar.label === 'Cache' ? 'cached' : 'used'}`

  return bar.note === '' ? reading : `${reading} · ${bar.note}`
}

// No wider than its own reading, so what follows a bar sits right after it.
function meterWidth(bar: Meter): number {
  return 216 + textWidth(meterReading(bar)) + 4
}

function meterSvg(bar: Meter, width: number): string {
  const percent = bar.percent ?? 0
  // A full cache bar is the good case, so it never warns.
  const fill =
    bar.label === 'Cache'
      ? MINT
      : percent >= 90
        ? RED
        : percent >= 75
          ? AMBER
          : MINT
  const text = `font-family="${FONT}" font-size="${FONT_SIZE}" fill="${INK}"`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${METER_HEIGHT}" viewBox="0 0 ${width} ${METER_HEIGHT}">${STYLE}${backdrop(width, METER_HEIGHT)}` +
    `<text x="0" y="12" ${text}>${escapeXml(bar.label)}</text>` +
    `<rect x="106" y="7" width="100" height="3" rx="1.5" fill="${LINE}" fill-opacity="0.6"/>` +
    `<rect x="106" y="7" width="${clamp(percent) }" height="3" rx="1.5" fill="${fill}"/>` +
    `<text x="216" y="12" ${text}>${escapeXml(meterReading(bar))}</text>` +
    `</svg>`
  )
}

function lastFolders(path: string, count: number): string {
  const parts = path.split(/[\\/]/).filter(part => part !== '')

  return parts.length > count
    ? `…/${parts.slice(-count).join('/')}`
    : parts.join('/')
}

function formatReset(iso: string | undefined): string {
  if (iso === undefined) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const hour = at.getHours() % 12 === 0 ? 12 : at.getHours() % 12
  const minutes = String(at.getMinutes()).padStart(2, '0')
  const half = at.getHours() < 12 ? 'AM' : 'PM'

  return `resets ${DAYS[at.getDay()]} ${hour}:${minutes} ${half}`
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${+(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${+(count / 1_000).toFixed(1)}k`

  return String(count)
}

function toMeters(
  rateLimits: readonly SessionRateLimit[],
  context: SessionContextUsage,
): Meter[] {
  const limits = rateLimits.map(limit => ({
    label: LIMIT_LABELS[limit.kind] ?? limit.kind,
    percent: limit.percentUsed,
    note: formatReset(limit.resetsAt),
    until:
      limit.resetsAt === undefined ? null : Date.parse(limit.resetsAt) || null,
  }))
  const window = formatTokens(context.window)
  const fill: Meter =
    context.percent === undefined
      ? { label: 'Context', percent: null, note: `${window} window` }
      : {
          label: 'Context',
          percent: context.percent,
          note: `${formatTokens(context.tokens ?? 0)} of ${window} tokens`,
        }

  return [...limits, fill]
}

async function describeHost($: EngineInterface): Promise<string> {
  const isCloud =
    (await attempt(() => $.env.get('CLAUDE_CODE_REMOTE'), undefined)) === 'true'

  return isCloud ? 'Cloud' : 'Local'
}

async function describeWorktree(
  $: EngineInterface,
  cwd: string,
): Promise<string> {
  const init = cwd === '' ? { timeoutMs: 5000 } : { cwd, timeoutMs: 5000 }
  const layout = await attempt(
    () =>
      $.process.run(
        [
          'git',
          'rev-parse',
          '--path-format=absolute',
          '--show-toplevel',
          '--git-dir',
          '--git-common-dir',
        ],
        init,
      ),
    null,
  )
  if (layout === null || layout.exitCode !== 0) {
    return 'no worktree'
  }
  const [top = '', gitDir = '', commonDir = ''] = layout.stdout
    .split('\n')
    .map(line => line.trim())
  const head = await attempt(
    () => $.process.run(['git', 'branch', '--show-current'], init),
    null,
  )
  const branch = head?.exitCode === 0 ? head.stdout.trim() : ''
  const tree = gitDir === commonDir ? '' : baseName(top)
  const parts = [tree, branch].filter(part => part !== '')

  return parts.length > 0 ? parts.join(' · ') : 'no worktree'
}

// The branch, how many files differ, and how far it is from its upstream.
async function describeGit($: EngineInterface, cwd: string): Promise<string> {
  const status = await attempt(
    () =>
      $.process.run(['git', 'status', '--porcelain=v2', '--branch'], {
        cwd,
        timeoutMs: 5000,
      }),
    null,
  )
  if (status === null || status.exitCode !== 0) return ''
  const lines = status.stdout.split('\n').filter(line => line.trim() !== '')
  const find = (name: string): string =>
    lines.find(line => line.startsWith(`# ${name} `))?.slice(name.length + 3) ??
    ''
  const changed = lines.filter(line => !line.startsWith('#')).length
  const [ahead = '', behind = ''] = find('branch.ab').split(' ')
  const parts = [
    find('branch.head'),
    changed === 0 ? 'no changes' : `${changed} changed`,
    Number(ahead) > 0 ? `${Number(ahead)} to push` : '',
    Number(behind) < 0 ? `${-Number(behind)} to pull` : '',
  ]

  return parts.filter(part => part !== '').join(' · ')
}

async function listOtherDirs(
  $: EngineInterface,
  cwd: string,
  root: string,
): Promise<string[]> {
  const settings = await attempt(() => $.settings.read(), {})
  const permissions = settings['permissions']
  const configured =
    typeof permissions === 'object' && permissions !== null
      ? (permissions as Record<string, unknown>)['additionalDirectories']
      : undefined
  const fromSettings = Array.isArray(configured)
    ? configured.filter((dir): dir is string => typeof dir === 'string')
    : []
  const all = [root, ...fromSettings, ...(await read($, added))]

  return [...new Set(all)].filter(dir => dir !== '' && dir !== cwd)
}

function findTitle(text: string): string | null {
  let generated: string | null = null
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    const isCustom = line.includes('"type":"custom-title"')
    if (!isCustom && !line.includes('"type":"ai-title"')) continue
    try {
      const row = JSON.parse(line) as Record<string, unknown>
      if (typeof row['customTitle'] === 'string') return row['customTitle']
      if (generated === null && typeof row['aiTitle'] === 'string') {
        generated = row['aiTitle']
      }
    } catch {
      continue
    }
  }

  return generated
}

async function readTitle($: EngineInterface, root: string): Promise<void> {
  const known = await read($, transcript)
  const home =
    (await attempt(() => $.env.get('CLAUDE_CONFIG_DIR'), undefined)) ??
    `${
      (await attempt(() => $.env.get('USERPROFILE'), undefined)) ??
      (await attempt(() => $.env.get('HOME'), undefined)) ??
      ''
    }/.claude`
  const id = await attempt(() => $.session.id(), '')
  const slug = root.replace(/[^a-zA-Z0-9]/g, '-')
  const path = known ?? `${home}/projects/${slug}/${id}.jsonl`
  const text = await attempt(() => $.fs.read(path), '')
  const found = findTitle(text)
  if (found !== null) await update($, title, () => found)
}

async function refreshPlace($: EngineInterface): Promise<string> {
  const cwd = await attempt(() => $.session.cwd(), '')
  const root = await attempt(() => $.session.root(), cwd)
  const next: Place = {
    runsOn: await describeHost($),
    cwd,
    dirs: await listOtherDirs($, cwd, root),
    worktree: await describeWorktree($, cwd),
    git: await describeGit($, cwd),
  }
  await update($, place, () => next)

  return root
}

async function compact($: EngineInterface): Promise<void> {
  await attempt(async () => $.ui.toast('Compacting once Claude is idle…'), 0)
  void $.command.run({ command: 'compact' }).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    void attempt(async () => $.ui.toast(`Compact failed: ${reason}`), 0)
  })
}

async function report($: EngineInterface, text: string): Promise<void> {
  await attempt(async () => $.ui.toast(text), undefined)
}

async function copyText(
  $: EngineInterface,
  text: string,
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile',
): Promise<void> {
  const copied = await attempt(
    () => $.ui.copy({ text, surface }),
    null,
  )
  await report(
    $,
    copied?.isCopied === true ? `Copied ${text}` : 'Could not copy it.',
  )
}

async function pickTheme($: EngineInterface, name: string): Promise<void> {
  if (THEMES[name] === undefined) return
  await update($, theme, () => name)
  // Kept across sessions.
  await attempt(() => $.store.set('theme', name), undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const saved = await attempt(() => $.store.get('theme'), undefined)
    if (typeof saved === 'string' && THEMES[saved] !== undefined) {
      await update($, theme, () => saved)
    }
    const root = await refreshPlace($)
    await readTitle($, root)
    const usage = await attempt(() => $.session.usage(), null)
    if (usage !== null) {
      await update($, meters, () => toMeters(usage.rateLimits, usage.context))
      await update($, startedAt, () => usage.startedAt)
    }

    return started
  })

  on('session.measure', async ($, e, next) => {
    await update($, meters, () => toMeters(e.rateLimits, e.context))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) {
      const time = await attempt(() => $.clock.now(), 0)
      await update($, log, () => ({
        calls: 0,
        rows: [],
        mark: time,
        spans: [],
      }))
      await update($, scroll, () => 0)
      // A finished list belongs to the turn before.
      await update($, steps, list =>
        list.every(step => step.status === 'completed') ? [] : list,
      )
      await update($, activity, () => ({
        startedAt: time,
        endedAt: null,
        turnId: e.turnId,
        outcome: '',
      }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const call = e as unknown as Call
    const isLogged = e.agentId === undefined && !TASK_TOOLS.includes(call.tool)
    const began = await attempt(() => $.clock.now(), 0)
    const id = e.tool_use_id ?? `call-${began}`
    if (isLogged) {
      const label = describeCall(call)
      // A step runs from the end of the one before, so the thinking that led
      // to a call counts towards it and the rows add up to the turn.
      await attempt(
        () =>
          update($, log, now => ({
            ...now,
            calls: now.calls + 1,
            rows: [
              ...now.rows,
              {
                id,
                label,
                startedAt: now.mark > 0 ? now.mark : began,
                endedAt: null,
                failed: false,
                n: (now.rows.at(-1)?.n ?? now.rows.length) + 1,
              },
            ].slice(-ROW_KEEP),
          })),
        undefined,
      )
    }
    const ran = await next(e)
    if (isLogged) {
      const ended = await attempt(() => $.clock.now(), began)
      const failed = ran.deny !== undefined || ran.isError === true
      await attempt(
        () =>
          update($, log, now => {
            const row = now.rows.find(each => each.id === id)

            return {
              ...now,
              mark: ended,
              spans: [
                ...(now.spans ?? []),
                row === undefined ? 0 : Math.max(0, ended - row.startedAt),
              ].slice(-SPAN_COUNT),
              rows: now.rows.map(each =>
                each.id === id ? { ...each, endedAt: ended, failed } : each,
              ),
            }
          }),
        undefined,
      )
    }
    if (TASK_TOOLS.includes(call.tool)) {
      await attempt(
        () => update($, steps, list => foldSteps(list, call, ran.result)),
        undefined,
      )
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const time = await attempt(() => $.clock.now(), 0)
      await update($, activity, now => ({
        ...now,
        endedAt: time,
        turnId: null,
        outcome: e.reason,
      }))
      const spent = e.usage ?? done.usage
      if (spent !== undefined) {
        await update($, cache, () => ({
          read: spent.cache_read_input_tokens,
          fresh: spent.cache_creation_input_tokens + spent.input_tokens,
        }))
      }
      await update($, log, now => ({
        ...now,
        mark: time,
        spans: [
          ...(now.spans ?? []),
          now.mark > 0 ? Math.max(0, time - now.mark) : 0,
        ].slice(-SPAN_COUNT),
        rows: [
          ...now.rows,
          {
            id: 'reply',
            label: 'Claude · Reply',
            startedAt: now.mark > 0 ? now.mark : time,
            endedAt: time,
            failed: false,
            n: (now.rows.at(-1)?.n ?? now.rows.length) + 1,
          },
        ].slice(-ROW_KEEP),
      }))
      const root = await refreshPlace($)
      if ((await read($, title)) === null) await readTitle($, root)
    }

    return done
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const path = e.transcript_path
    const name = e.session_title
    if (path) await update($, transcript, () => path)
    if (name) await update($, title, () => name)

    return next(e)
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    await refreshPlace($)

    return result
  })

  on('classic.DirectoryAdded', async ($, e, next) => {
    const result = await next(e)
    await update($, added, dirs =>
      dirs.includes(e.directory) ? dirs : [...dirs, e.directory],
    )
    await refreshPlace($)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const where = await read($, place)
    if (e.props.hasSurvey || where === null) {
      return next(e)
    }
    const name = await read($, title)
    const chosen = await read($, theme)
    const look = THEMES[chosen] === undefined ? DEFAULT_THEME : chosen
    applyTheme(look)
    const kept = await read($, cache)
    const bars: Meter[] = (await read($, meters)).concat(
      kept === null || kept.read + kept.fresh === 0
        ? [{ label: 'Cache', percent: null, note: 'after the next turn' }]
        : [
            {
              label: 'Cache',
              percent: Math.round((kept.read / (kept.read + kept.fresh)) * 100),
              note: `${formatTokens(kept.read)} read · ${formatTokens(kept.fresh)} new`,
            },
          ],
    )
    const { Box, Button, Select, Text } = $.ui.resolve(e)
    const themeSelect = (
      <Select
        key="theme"
        options={Object.keys(THEMES).map(name => ({ value: name }))}
        value={look}
        onSelect={value => pickTheme($, value)}
      />
    )
    const began = await read($, startedAt)
    const time = await attempt(() => $.clock.now(), 0)
    const isLocal = where.runsOn !== 'Cloud'
    const host = isLocal ? 'Local' : 'Cloud'
    const hasWorktree = where.worktree !== 'no worktree'
    const branch = hasWorktree
      ? (where.worktree.split(' · ').at(-1) ?? '')
      : ''
    const surface = e.surface
    // Each part says what it is: "worktree app-wt · branch main".
    const treeParts = where.worktree.split(' · ')
    const worktreeLabel =
      treeParts.length > 1
        ? `worktree ${treeParts[0]} · branch ${treeParts.slice(1).join(' · ')}`
        : `branch ${where.worktree}`
    // The branch is on the chip before, so the git chip does not repeat it.
    const status =
      branch !== '' && where.git.startsWith(`${branch} · `)
        ? where.git.slice(branch.length + 3)
        : where.git
    const chips: Chip[] = [
      {
        icon: 'tag',
        label: name ?? '(not named yet)',
        ...(name === null ? {} : { copy: name }),
      },
      { icon: 'folder', label: lastFolders(where.cwd, 2), copy: where.cwd },
      ...where.dirs.map(
        (dir): Chip => ({
          icon: 'folderPlus',
          label: `also ${lastFolders(dir, 2)}`,
        }),
      ),
      {
        icon: 'branch',
        label: hasWorktree ? worktreeLabel : '',
        isUnset: !hasWorktree,
        ...(branch === '' ? {} : { copy: branch }),
      },
      ...(status === ''
        ? []
        : [{ icon: 'commit', label: status } satisfies Chip]),
    ]
    const elapsed =
      began !== null && time > 0 ? formatElapsed(time - began) : null
    const doing = await read($, activity)
    // An interrupted turn may never report its end.
    const current: Activity =
      isRunning(doing) && !e.props.isWorking
        ? { ...doing, endedAt: time, outcome: 'aborted' }
        : doing
    const tasks = await read($, steps)
    const journal = await read($, log)
    const calls = journal.calls
    // Between two calls the model is thinking: a row of its own while it does.
    const rows: Entry[] =
      isRunning(current) && journal.rows.every(row => row.endedAt !== null)
        ? [
            ...journal.rows,
            {
              id: 'thinking',
              label: 'Claude · Thinking',
              startedAt: journal.mark > 0 ? journal.mark : time,
              endedAt: null,
              failed: false,
            },
          ]
        : journal.rows
    const first = rows.length - journal.rows.length === 1
      ? (journal.rows.at(-1)?.n ?? journal.rows.length) + 1
      : 0
    const numberOf = (row: Entry, index: number): number =>
      row.id === 'thinking' ? first : (row.n ?? index + 1)
    const most = Math.max(0, rows.length - ROW_COUNT)
    const back = Math.min(most, Math.max(0, await read($, scroll)))
    const from = rows.length - ROW_COUNT - back
    const shown = rows
      .map((row, index) => ({ row, number: numberOf(row, index) }))
      .slice(Math.max(0, from), rows.length - back)
    const range =
      most === 0
        ? ''
        : ` · steps ${shown[0]?.number ?? 0}–${shown.at(-1)?.number ?? 0} of ${numberOf(rows.at(-1) as Entry, rows.length - 1)}`
    const pager =
      most === 0 ? null : (
        <Box flexDirection="row" columnGap={1}>
          <Button
            key="older"
            label="▲"
            onPress={() =>
              update($, scroll, () => Math.min(most, back + ROW_COUNT - 1))
            }
          />
          <Button
            key="newer"
            label="▼"
            onPress={() =>
              update($, scroll, () => Math.max(0, back - (ROW_COUNT - 1)))
            }
          />
        </Box>
      )
    const isTerminal = surface === 'terminal'
    // The cache is refreshed by every request, so it only ages between turns.
    const remaining = isRunning(current)
      ? null
      : current.endedAt === null
        ? undefined
        : CACHE_MINUTES * 60_000 - (time - current.endedAt)
    const buttons = (
      <Box flexDirection="row" columnGap={1}>
        {isTerminal ? (
          <Button
            key="copy"
            label="Copy path"
            onPress={() => copyText($, where.cwd, surface)}
          />
        ) : null}
        {name === null || !isTerminal ? null : (
          <Button
            key="copy-name"
            label="Copy name"
            onPress={() => copyText($, name, surface)}
          />
        )}
        {branch === '' || !isTerminal ? null : (
          <Button
            key="copy-branch"
            label="Copy branch"
            onPress={() => copyText($, branch, surface)}
          />
        )}
        {isTerminal ? (
          <Button key="compact" label="Compact" onPress={() => compact($)} />
        ) : null}
      </Box>
    )

    if (isTerminal) {
      const barColumns = Math.max(
        10,
        Math.min(40, e.props.bodyColumns - LABEL_COLUMNS - 45),
      )

      return (
        <Box flexDirection="column">
          <Text color={isRunning(current) ? 'suggestion' : 'success'}>
            {progressReading(current, tasks, calls) + range}
          </Text>
          {shown.map(each => (
            <Text dimColor>{rowReading(each.row, each.number)}</Text>
          ))}
          {pager}
          <Text wrap="wrap">
            {[host, ...chips.map(chip => chip.label), elapsed ?? '']
              .filter(part => part !== '')
              .join('  │  ')}
          </Text>
          {remaining === undefined ? null : (
            <Text dimColor>{expiryReading(remaining)}</Text>
          )}
          {bars.map(bar => {
            const percent = bar.percent ?? 0
            const filled = Math.round((clamp(percent) / 100) * barColumns)

            return (
              <Box>
                <Box width={LABEL_COLUMNS} flexShrink={0}>
                  <Text dimColor>{bar.label}</Text>
                </Box>
                <Text
                  color={
                    bar.label === 'Cache' ? 'success' : meterColor(percent)
                  }
                >{'━'.repeat(filled)}</Text>
                <Text dimColor>{'─'.repeat(barColumns - filled)}</Text>
                <Text dimColor>
                  {` ${meterReading(bar)}${
                    timeLeft(bar, time) === null
                      ? ''
                      : ` · ${formatLeft(timeLeft(bar, time) ?? 0)}`
                  } `}
                </Text>
              </Box>
            )
          })}
          {buttons}
          {themeSelect}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const patch = PATCH === '' ? {} : { backgroundColor: PATCH }
    const running = isRunning(current)
    const spent = (journal.spans ?? []).reduce((sum, span) => sum + span, 0)
    // The pager's two buttons take their room from the summary.
    const summaryWidth = PROGRESS_WIDTH - (pager === null ? 0 : 76)
    const hostChip: Chip = { icon: isLocal ? 'laptop' : 'cloud', label: '' }

    return (
      <Box flexDirection="column">
      <Svg
        source={waveSvg(isRunning(current), tasks)}
        alt={isRunning(current) ? 'Working' : 'Idle'}
        height={WAVE_HEIGHT}
        isInteractive
      />
      <Box
        flexDirection="column"
        {...(PANEL === 'none' ? {} : { backgroundColor: PANEL })}
        paddingLeft={1}
        paddingRight={1}
      >
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Svg
            source={progressSvg(
              current,
              tasks,
              calls,
              journal.spans ?? [],
              time,
              began === null || time <= 0 ? null : time - began,
              summaryWidth,
              range,
            )}
            alt={[progressReading(current, tasks, calls) + range]
              .concat(elapsed === null ? [] : [`Conversation time ${elapsed}`])
              .join('; ')}
            width={summaryWidth}
            height={ROW_HEIGHT}
            isInteractive
          />
          {pager === null ? null : <Box {...patch}>{pager}</Box>}
        </Box>
        {shown.map(each =>
          each.row.endedAt === null ? (
            <Svg
              source={rowSvg(each.row, each.number, time, running, spent)}
              alt={rowReading(each.row, each.number)}
              width={PROGRESS_WIDTH}
              height={ROW_HEIGHT}
              isInteractive
            />
          ) : (
            <Svg
              source={rowSvg(each.row, each.number, time, running, spent)}
              alt={rowReading(each.row, each.number)}
              width={PROGRESS_WIDTH}
              height={ROW_HEIGHT}
            />
          ),
        )}
        <Svg source={RULE} alt="divider" height={RULE_HEIGHT} />
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Svg
            source={chipSvg(hostChip)}
            alt={host}
            width={chipWidth(hostChip)}
            height={CHIP_HEIGHT + CHIP_GAP}
          />
          {chips.flatMap(chip => {
            const text = chip.copy

            return [
              <Svg
                source={chipSvg(chip)}
                alt={chip.label === '' ? 'No worktree' : chip.label}
                width={chipWidth(chip)}
                height={CHIP_HEIGHT + CHIP_GAP}
              />,
              text === undefined ? null : (
                // A muted patch, since the app styles its button for its own
                // background, not the panel's.
                <Box {...patch}>
                  <Button
                    key={`copy-${chip.icon}`}
                    label="⧉"
                    onPress={() => copyText($, text, surface)}
                  />
                </Box>
              ),
            ]
          })}
        </Box>
        <Box flexDirection="column">
          {bars.map((bar, index) => {
            const left = timeLeft(bar, time)

            return (
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              <Svg
                source={meterSvg(bar, meterWidth(bar))}
                alt={`${bar.label}: ${meterReading(bar)}`}
                width={meterWidth(bar)}
                height={METER_HEIGHT}
              />
              {left === null ? null : (
                <Svg
                  source={leftSvg(left)}
                  alt={formatLeft(left)}
                  width={leftWidth(left) + SIDE_GAP}
                  height={SIDE_HEIGHT}
                  isInteractive
                />
              )}
              {bar.label === 'Cache' && remaining !== undefined ? (
                <Svg
                  source={expirySvg(remaining)}
                  alt={expiryReading(remaining)}
                  width={expiryWidth(remaining) + SIDE_GAP}
                  height={SIDE_HEIGHT}
                  isInteractive
                />
              ) : null}
              {bar.label === 'Context' ? (
                <Box {...patch}>
                  <Button
                    key="compact"
                    label="⇲"
                    onPress={() => compact($)}
                  />
                </Box>
              ) : null}
            </Box>
            )
          })}
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="flex-end">
        {themeSelect}
      </Box>
      </Box>
    )
  })
}
