# krateo-portal-chart

Krateo PlatformOps **portal-starter** blueprint — seeds the Composable Portal's content
(navmenus, routes, pages, panels, RestActions, and the demo-system RBAC) so a fresh install
renders a usable portal. Distinct from the `frontend` chart (the SPA itself).

Part of the [krateo-installer](https://github.com/braghettos/krateo-installer) ecosystem.

## What it ships

| Path | Chart | OCI artifact |
|------|-------|--------------|
| `chart/` | `portal` | `oci://ghcr.io/braghettos/krateo/portal` |

`chart/templates/` holds the portal content as Krateo resources: `navmenu*`, `route*`,
`routesloader`, `page*`, `panel*`, `datagrid*`, `restaction*`, plus `rbac.*` and the
`demo-system` namespace. Toggles in `values.yaml`: `enableAdminUser`, `enableCyberjokerUser`,
`enableDemoSystemNamespace`.

## How the installer consumes it

The installer umbrella emits a `CompositionDefinition` that points `core-provider` at the OCI
chart; `core-provider` generates `Portal.composition.krateo.io` and reconciles one Composition
per instance:

```yaml
apiVersion: core.krateo.io/v1alpha1
kind: CompositionDefinition
metadata:
  name: portal
  namespace: krateo-system
spec:
  chart:
    url: oci://ghcr.io/braghettos/krateo/portal
    version: "1.2.2"
```

## Local validation

```sh
helm lint chart
helm template smoke chart
python3 scripts/lint-keyextras.py   # F6 cache-key declaration gate (see below)
```

## Authoring rule: `spec.keyExtras`

**Any widget rendered on a parameterized route (or consuming query context) MUST
declare, in its chart template, exactly the request-extras keys it receives:**

```yaml
spec:
  keyExtras: [name, namespace]   # e.g. the /compositions/{namespace}/{name} route params
  # or, for chrome widgets receiving the shell's project scope:
  keyExtras: [projects]
```

Why (snowplow ≥ 1.7.11, F6 self-quarantine Put-guard):

- A widget that receives request extras it does **not** declare is refused by the
  cache guard: it serves 200 but is **never cached** — cold resolve on *every*
  visit, including revisits. It fails safe (no wrong content), but caching is
  permanently defeated. This was the exact shape of the PR #21 chrome gap and the
  issue #26 structural gap (84 guard declines per browser walk).
- Declarations are only real if **chart-baked** — live widget-CR edits are
  reverted by the composition controller on the next portal reconcile.
- Identity keys (`username`, `groups`, `displayName`) as *caller identity* never
  need declaring — snowplow exempts them. A **route param** that happens to be
  named `username` (e.g. `/settings/access/{username}`, the *viewed* persona)
  still must be declared: it partitions the widget's content.

How to verify a new/changed widget against snowplow ≥ 1.7.11: navigate its route
and check there is no `"Widget request carried extras not declared in
spec.keyExtras; declining to cache"` WARN naming it (counter:
`snowplow_widget_skipped_undeclared_extras_put_total`), and that a revisit logs
an L1 HIT at an `extras_len>0` key.

CI enforces the route half of this rule: `scripts/lint-keyextras.py` (the
`keyextras` job in `.github/workflows/lint.yaml`) renders the chart, derives the
route table from the `sidebar-nav` Menu (`{param}` path segments → the extras
keys the route injects), walks each route's widget tree transitively via
same-chart `resourcesRefs`, and **fails** if any reachable widget's `keyExtras`
misses that route's params. It also **warns** (non-gating) for app-shell/header
chrome widgets that do not declare `projects`.

## Release

Push a semver tag (`X.Y.Z`) — CI packages `chart/` and publishes to
`oci://ghcr.io/braghettos/krateo`.

## Links

- Installer umbrella: https://github.com/braghettos/krateo-installer
- Composable Portal (frontend): https://github.com/krateoplatformops/frontend
