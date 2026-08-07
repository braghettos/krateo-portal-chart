---
type: Runbook
title: portal — release
description: How a release ships — one plain-semver tag packages helm/portal and publishes the OCI chart; then the installer pin and the sample CompositionDefinition are bumped.
resource: oci://ghcr.io/krateo-platformops/charts/portal
tags: [release, ci, oci]
timestamp: 2026-08-07T00:00:00Z
---

# Release

One tag ships the chart. This is a chart-only repo — no image is built.

## The runbook

1. **Merge to `main`** with PR CI green
   ([`lint.yaml`](../.github/workflows/lint.yaml): helm lint + `values.schema.json`
   validity + render smoke on every first-class chart, plus the `keyextras` gate;
   [`lint-docs.yaml`](../.github/workflows/lint-docs.yaml): this doc bundle;
   [`security.yml`](../.github/workflows/security.yml)).
2. **Tag with plain semver — `X.Y.Z`, no `v` prefix.** The release workflow triggers
   on `[0-9]+.[0-9]+.[0-9]+` only; a `v`-prefixed tag ships **nothing**, silently
   (this repo carries a stray `v1.5.93` from exactly that mistake).

   ```sh
   git tag 1.6.1 && git push origin 1.6.1
   ```

3. **CI publishes** ([`release-oci.yaml`](../.github/workflows/release-oci.yaml), the
   canonical byte-identical org workflow): it discovers `helm/portal/`, substitutes
   the `CHART_VERSION` placeholder in `Chart.yaml` (both `version` and `appVersion`)
   with the tag, packages, and pushes →
   `oci://ghcr.io/krateo-platformops/charts/portal:X.Y.Z`.
4. **Verify**:

   ```sh
   helm show chart oci://ghcr.io/krateo-platformops/charts/portal --version X.Y.Z
   ```

5. **Roll it out** — a version bump only reaches clusters through the composition
   layer:
   - bump the `portal` pin in the Krateo installer's component pins (the installer
     upgrades the CompositionDefinition; cdc performs the in-place handover — the
     derived API version changes with the chart version);
   - keep [`compositiondefinition.yaml`](../compositiondefinition.yaml) (the
     standalone registration sample) and the
     [example](../examples/portal-composition/README.md) at the released version.

## Versioning semantics

`CHART_VERSION` is the only placeholder this chart authors (no image → no
`APP_VERSION`). Remember the chart version is **API identity** for compositions:
every release changes the `Portal` CRD's served version (`v1-6-0` → `v1-6-1` …), so
"patch" releases are still definition upgrades platform-side.
