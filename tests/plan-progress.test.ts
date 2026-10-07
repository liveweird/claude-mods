import { expect, mock, test } from 'claude-code/testing'

import { fmt, goTo, startPlan, summarize, timeline } from '../hooks/plan'

const TOOL = 'mcp__plan-progress__plan_progress'
const MIN = 60_000
const BAND = {
  plugin: 'plan-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('summary counts elapsed, the running step and what is left', () => {
  const p0 = startPlan('Demo', [
    { title: 'A', estimateMin: 10 },
    { title: 'B', estimateMin: 20 },
    { title: 'C', estimateMin: 30 },
  ], 0)
  const p1 = goTo(p0, 1, 12 * MIN)
  const s = summarize(p1, 17 * MIN)
  expect(s.elapsedMs).toBe(17 * MIN)
  expect(s.stepElapsedMs).toBe(5 * MIN)
  expect(s.remainingMs).toBe(15 * MIN + 30 * MIN)
  expect(s.isOver).toBe(false)
  expect(summarize(p1, 40 * MIN).isOver).toBe(true)
  expect(fmt(65 * MIN)).toBe('1h05m')
})

test('the timeline fills exactly the width it is given', () => {
  const p = goTo(startPlan('Demo', [
    { title: 'A', estimateMin: 1 },
    { title: 'B', estimateMin: 50 },
    { title: 'C', estimateMin: 3 },
  ], 0), 1, MIN)
  for (const width of [3, 10, 37, 120]) {
    const cells = timeline(p, 10 * MIN, width).map(s => s.text).join('')
    expect(cells.length).toBe(width)
  }
})

test('the tool drives the band on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 10, 0) })
  const started = await $.tool.call({
    tool: TOOL,
    action: 'start',
    title: 'Checkup',
    steps: [
      { title: 'Audit', estimateMin: 30 },
      { title: 'Fixes', estimateMin: 60 },
    ],
  })
  expect(String(started.result)).toContain('step 1/2')

  await clock.advance(10 * MIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /step 1\/2: Audit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /elapsed 10m · step 10m of ~30m · ~1h20m left/ })).toBeDefined()
    await ui.unmount()
  }

  await $.tool.call({ tool: TOOL, action: 'step', step: 2 })
  await clock.advance(5 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /step 2\/2: Fixes/ })).toBeDefined()
  await ui.unmount()

  const bad = await $.tool.call({ tool: TOOL, action: 'step', step: 9 })
  expect(bad.isError).toBe(true)

  const done = await $.tool.call({ tool: TOOL, action: 'finish' })
  expect(String(done.result)).toContain('finished in 15m')
})

test('the running step is blue and later steps are dim grey', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  await $.tool.call({
    tool: TOOL,
    action: 'start',
    title: 'Colours',
    steps: [
      { title: 'One', estimateMin: 10 },
      { title: 'Two', estimateMin: 10 },
      { title: 'Three', estimateMin: 10 },
    ],
  })
  await $.tool.call({ tool: TOOL, action: 'step', step: 2 })
  await clock.advance(4 * MIN)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const segs = await ui.findAll({ type: 'Text', text: /^[━─]+$/ })
  const kinds = segs.map(s => `${String(s.props.color)}${s.props.dimColor ? ':dim' : ''}${s.text[0]}`)
  expect(kinds).toEqual(['success━', 'suggestion━', 'suggestion─', 'inactive:dim─'])
  const label = (await ui.findAll({ type: 'Text', text: /step 2\/3: Two/ })).at(-1)
  expect(label).toMatchObject({ text: 'step 2/3: Two', props: { color: 'suggestion' } })
  await ui.unmount()
})
