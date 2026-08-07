---
type: Log
title: portal — log
description: Curated chronological history of the portal blueprint chart — notable arcs, decisions and incidents; release notes stay in GitHub Releases.
resource: oci://ghcr.io/krateo-platformops/charts/portal
tags: [history]
timestamp: 2026-08-07T00:00:00Z
---

# Log

Curated history, newest first. Point-in-time records live as archives (the
[CR-TRACE sweep](./CR-TRACE.md)); design records carry a `status` field
([marketplace-registry-discovery](./marketplace-registry-discovery.md),
[snowplow-yaml-api-step-enabler](./snowplow-yaml-api-step-enabler.md)).

## 2026-08-07 — adopted the Krateo Documentation Standard

This bundle: root `docs/` + `examples/` + thin README. The old README prescribed a
`chart/` layout two migrations stale (the chart lives at `helm/portal/`), pinned the
sample CompositionDefinition at `1.2.2`, and claimed the demo toggle "deploys two
Route resources" (the chart ships no Route kind — provisioning is the namespace +
persona grants). The keyExtras authoring rule moved to
[authoring-keyextras](./authoring-keyextras.md); the two design docs got verified
`status` frontmatter (one `implemented`, one `diverged`).

## 2026-08-03 — 1.6.0: the org migration release

Repo restructured to `helm/portal/` and re-pointed to `krateo-platformops` (Go-wave
full-independence migration); CI moved to the canonical org workflows (shape-agnostic
`release-oci`, shared `security`). `1.6.0` is the version the installer pins.

## 2026-07 — the 1.5.x enterprise-UX arc (…→ 1.5.119)

A ~120-release polish-and-features run driven by mockup parity and UX review rounds:
the marketplace rework (#82–#86: merged blueprint+operator catalog off two helm-repo
indexes, data-driven category facets, installed-state LEFT-JOIN onto
CompositionDefinitions, detail page, facet-band layout); the IA split of
Observability / Incidents / Alerts (alert rules = configuration, incidents = triage,
per-alert detail pages); the three Builder pages (Portal / Blueprint / API) with the
right-aligned Ask-Autopilot CTA; the nav-fragments drop-in mechanism (#106) so
Autopilot-published pages ship their own sidebar entry; W3 cluster registry +
one-spoke live read-back; the generic `/resources/...` drill-down route (F5);
notifications Listy (SSE-driven); brand theming (Brand v2).

## 2026-06/07 — caching correctness: the keyExtras gate

snowplow's F6 self-quarantine Put-guard made undeclared request-extras a permanent
cache defeat (PR #21 chrome gap; #26: 84 guard declines per browser walk). The rule
— every widget on a parameterized route declares its extras keys in-chart — became
[an authoring invariant](./authoring-keyextras.md) enforced by
`scripts/lint-keyextras.py` in PR CI.

## 2026-06-23 — the CR reachability sweep

A 13-agent orphan-trace over the then-180 CRs ahead of the consolidated fresh-GKE
install: 8 superseded widgets pruned, 14 false orphans adjudicated alive (Helm-flag
fixtures, `{{ .k }}` fan-out chips, state ConfigMaps, endpoint Secrets). Preserved
as [CR-TRACE](./CR-TRACE.md) (archive).

## Earlier — from starter to blueprint

The repo began as the `composable-portal-starter` (basic auth users, demo-system,
a handful of pages) and grew into the platform's full portal content plane, consumed
exclusively through the composition model (CompositionDefinition → derived `Portal`
API → cdc-reconciled release).
