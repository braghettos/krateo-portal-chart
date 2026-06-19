#!/usr/bin/env node
/**
 * B4 — mockup-diff checker (read-only QA).
 *
 * Audits the enterprise mockups against the chart's widget CRs on three axes:
 *   1. COVERAGE   — each mockup page maps to a backing page CR + nav route.
 *   2. JOURNEY    — each interactive affordance the mockup shows (CTAs, links,
 *                   actions) is wired in the chart (a Button/Form with a NON-empty
 *                   `actions:` / a nav route). Flags MISSING and INERT (`actions: {}`)
 *                   affordances — the "user-journey gaps".
 *   3. HARDCODED  — no `widgetData` data-bearing field (dataSource/data/items/list)
 *                   holds a literal value without a `widgetDataTemplate` to fill it.
 *
 * Pure Node (no deps). Chart templates are Helm-templated, so they're parsed as
 * TEXT (regex), not YAML. Heuristic by design — it surfaces gaps to review, it is
 * not a proof. Exits non-zero when any gap is found.
 *
 *   MOCKUP_DIR=… CHART_DIR=… node scripts/mockup-diff.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOCKUP_DIR = process.env.MOCKUP_DIR || join(process.env.HOME || '', 'Downloads/krateo-mockups/src')
const CHART_DIR = process.env.CHART_DIR || join(HERE, '..', 'chart', 'templates')

// Mockup page → its backing chart CR (name as it appears in metadata.name).
// `frontend:true` = rendered by the frontend bootstrap, not a snowplow widget CR.
const PAGES = [
  { page: 'dashboard',    mock: 'enterprise-dashboard.html',    cr: 'dashboard-flex' },
  { page: 'compositions', mock: 'enterprise-compositions.html', cr: 'compositions-table' },
  { page: 'marketplace',  mock: 'enterprise-marketplace.html',  cr: 'marketplace-flex' },
  { page: 'detail',       mock: 'enterprise-detail.html',       cr: 'page-composition-detail' },
  { page: 'create',       mock: 'enterprise-create.html',       cr: 'page-blueprint-create' },
  { page: 'login',        mock: 'enterprise-login.html',        cr: null, frontend: true },
]

const norm = (s) => (s || '').toLowerCase().replace(/&[a-z]+;/gi, ' ').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim()
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ')

// ---- mockup parsing ------------------------------------------------------
function parseMock(file) {
  const html = readFileSync(file, 'utf8')
  const sections = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => norm(stripTags(m[1]))).filter((s) => s && s.length < 60)
  const aff = new Set()
  const add = (raw) => { const t = norm(stripTags(raw)); if (t && t.length >= 2 && t.length <= 32) aff.add(t) }
  for (const m of html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)) add(m[1])
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) add(m[1])
  // elements whose class mentions a button ("btn", "icobtn", "cta", "pill")
  for (const m of html.matchAll(/class="[^"]*\b(?:btn|cta)\b[^"]*"[^>]*>([\s\S]*?)<\//gi)) add(m[1])
  return { sections: [...new Set(sections)], affordances: [...aff] }
}

// ---- chart inventory -----------------------------------------------------
function loadChart() {
  const files = readdirSync(CHART_DIR).filter((f) => f.endsWith('.yaml'))
  const widgets = []   // {kind, name, file, text}
  const buttons = []   // {label, inert, file}
  const navRoutes = [] // {label, path, refId}
  const hardcoded = [] // {file, key}

  for (const f of files) {
    const text = readFileSync(join(CHART_DIR, f), 'utf8')
    const kind = (text.match(/^kind:\s*([A-Za-z]+)/m) || [])[1]
    const name = (text.match(/^\s*name:\s*([a-z0-9-]+)/m) || [])[1]
    if (kind) { widgets.push({ kind, name, file: f, text }) }

    if (kind === 'Button') {
      const label = (text.match(/label:\s*(.+)/) || [])[1]?.trim()
      // inert if `actions: {}` or actions has no nested content / no verb/navigate/type
      const inert = /actions:\s*\{\s*\}/.test(text) || !/actions:\s*\n\s+\S/.test(text)
      buttons.push({ label, inert, file: f })
    }
    if (kind === 'Form') {
      const label = (text.match(/(?:submitLabel|label):\s*(.+)/) || [])[1]?.trim() || 'submit'
      const inert = /actions:\s*\{\s*\}/.test(text) || !/actions:/.test(text)
      buttons.push({ label, inert, file: f, form: true })
    }

    // nav routes from the Menu
    if (kind === 'Menu') {
      for (const m of text.matchAll(/label:\s*([A-Za-z][\w ]*?),\s*icon:[^,]*,\s*order:[^,]*,\s*path:\s*(\S+),\s*resourceRefId:\s*(\S+)/g)) {
        navRoutes.push({ label: m[1].trim(), path: m[2], refId: m[3].replace(/[},]/g, '') })
      }
    }

    // hardcoded-data scan: data-bearing keys with a non-empty literal + no template
    // Only DATA-bearing keys — NOT `items` (Flex/Tabs/Menu children = resourceRefId
    // refs, structural) nor `columns` (table config). Table/list/statistic DATA
    // lives in dataSource/data and must be template-filled.
    const hasTemplate = (key) => new RegExp(`forPath:\\s*${key}\\b`).test(text)
    for (const key of ['dataSource', 'data']) {
      // key: <newline> - <something>   → a populated literal list
      const populated = new RegExp(`\\n\\s*${key}:\\s*\\n\\s*-\\s+\\S`).test(text)
      if (populated && !hasTemplate(key)) { hardcoded.push({ file: f, key }) }
    }
  }
  return { widgets, buttons, navRoutes, hardcoded }
}

// ---- audit ---------------------------------------------------------------
const chart = loadChart()
const widgetNames = new Set(chart.widgets.map((w) => w.name))
const buttonLabels = chart.buttons.map((b) => ({ ...b, n: norm(b.label) }))

// affordances we know the frontend (not a chart CR) owns
const FRONTEND_AFF = ['sign in', 'single sign on', 'single sign on sso', 'sso', 'forgot', 'remember', 'request an account', 'or continue with']
// generic chrome to ignore as "affordances"
const IGNORE_AFF = ['', 'k', 'menu', 'close', 'krateo']
// sidebar nav links appear on every mockup page — wired via nav routes, not buttons
const NAV_LABELS = new Set(chart.navRoutes.map((r) => norm(r.label)))
const REMOVED_NAV = ['resources'] // in the mockup sidebar; intentionally dropped from the portal

let gaps = 0
const out = []
out.push('# B4 mockup-diff — coverage · journey · hardcoded\n')

for (const P of PAGES) {
  const mf = join(MOCKUP_DIR, P.mock)
  if (!existsSync(mf)) { out.push(`## ${P.page}\n  ⚠ mockup ${P.mock} not found at ${MOCKUP_DIR}\n`); continue }
  const m = parseMock(mf)
  out.push(`## ${P.page}  (${P.mock})`)

  // 1. coverage
  if (P.frontend) {
    out.push(`  COVERAGE: frontend-rendered bootstrap page (no chart CR) — OK`)
  } else {
    const backed = widgetNames.has(P.cr)
    const routed = chart.navRoutes.some((r) => r.path?.includes(P.page)) || P.page === 'detail' || P.page === 'create'
    out.push(`  COVERAGE: page CR '${P.cr}' ${backed ? '✓' : '✗ MISSING'} · nav route ${routed ? '✓' : '✗'}`)
    if (!backed) { gaps++ }
  }

  // 2. journey affordances
  const journeyAff = m.affordances.filter((a) => !IGNORE_AFF.includes(a))
  const missing = [], inert = [], frontend = [], removed = []
  for (const a of journeyAff) {
    if (NAV_LABELS.has(a)) { continue }                 // sidebar nav link — wired via routes
    if (REMOVED_NAV.includes(a)) { removed.push(a); continue }
    if (FRONTEND_AFF.some((fa) => a.includes(fa) || fa.includes(a))) { frontend.push(a); continue }
    const hit = buttonLabels.find((b) => b.n && (b.n.includes(a) || a.includes(b.n)))
    if (!hit) { missing.push(a) }
    else if (hit.inert) { inert.push(`${a} → ${hit.file} (actions: {})`) }
  }
  if (missing.length) { out.push(`  JOURNEY ✗ no wired control for: ${missing.join(' · ')}`); gaps += missing.length }
  if (inert.length) { out.push(`  JOURNEY ⚠ INERT (actions empty): ${inert.join(' · ')}`); gaps += inert.length }
  if (removed.length) { out.push(`  JOURNEY · mockup nav intentionally removed: ${removed.join(' · ')}`) }
  if (frontend.length) { out.push(`  JOURNEY · frontend-owned: ${frontend.join(' · ')}`) }
  if (!missing.length && !inert.length) { out.push(`  JOURNEY ✓ all mockup affordances wired (or nav/frontend-owned)`) }

  out.push('')
}

// 3. hardcoded data (chart-wide)
out.push('## hardcoded-data scan (widgetData literals without a widgetDataTemplate)')
if (chart.hardcoded.length === 0) { out.push('  ✓ none — every data-bearing widgetData is template-filled') }
else { for (const h of chart.hardcoded) { out.push(`  ✗ ${h.file}: widgetData.${h.key} holds literal data`); gaps++ } }

out.push(`\n— ${gaps} gap(s) found across ${PAGES.length} pages + ${chart.widgets.length} widgets —`)
console.log(out.join('\n'))
process.exit(gaps ? 1 : 0)
