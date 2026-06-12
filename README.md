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
```

## Release

Push a semver tag (`X.Y.Z`) — CI packages `chart/` and publishes to
`oci://ghcr.io/braghettos/krateo`.

## Links

- Installer umbrella: https://github.com/braghettos/krateo-installer
- Composable Portal (frontend): https://github.com/krateoplatformops/frontend
