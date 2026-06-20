# Design — Marketplace as registry-driven blueprint discovery

> Status: **ready for implementation handoff** (decisions locked; see §8, §11, Appendices A–B).
> Scope: how the Marketplace page sources its tiles, and how it differs from Blueprints.

## 1. Problem / motivation

Today the Marketplace and Blueprints pages have **overlapping** scopes. Both are fed from
`blueprints-cards` / `blueprints-list`, which discover the per-blueprint **Card CRs already on
the cluster** (label `krateo.io/portal-page: blueprints`). Those Card CRs are generated
(gen-portal-widgets) from **CompositionDefinitions that are already installed**. So "Marketplace"
really shows *what's installed*, not *what you can install* — it can't surface a blueprint chart
that hasn't been registered yet.

**Desired split (two distinct scopes):**

| Page | Scope | Source of truth |
|---|---|---|
| **Marketplace** | *Discover* installable blueprint charts from external **sources** (OCI registries, Helm repos, tgz). Not yet on the platform. | The configured sources + the charts found in them |
| **Blueprints** | *What's registered on the platform* — the installed `CompositionDefinition`s (today's cards/table). | `CompositionDefinition` objects on the cluster |

**Install flow that connects them:** a Marketplace tile → create a `CompositionDefinition`
pointing at that chart → it now shows up under **Blueprints** (and its per-blueprint Card is
generated as today).

## 2. What a CompositionDefinition can consume (the source types)

`CompositionDefinition.spec.chart` (verified against the CRD) supports exactly the three sources
the Marketplace should browse:

- `url: oci://…` — an **OCI** chart artifact (e.g. `oci://ghcr.io/braghettos/charts/aws-eks-stack`).
- `url: https://….tgz` — a **downloadable tgz** chart.
- `repo: <name>` + `url` (+ `version`) — a classic **Helm repository**.
- plus `version`, `credentials` (private repos), `insecureSkipVerifyTLS`.

So a discovered chart maps 1:1 onto a `spec.chart` block — discovery and install share a model.

## 3. The `blueprint` marker + the icon (from Chart.yaml)

A chart is a **blueprint** iff its `Chart.yaml` declares it. Two facts from a real chart
(`aws-eks-stack` 0.3.0):
- It already has **`icon:`** (a URL) → use it directly for the tile (replaces the `fa-aws`
  guess; needs URL-icon support in the Card — see §6).
- Its **`keywords:`** are `[aws, eks, kubernetes, ack, stack]` — **no `blueprint`**; "blueprint"
  only appears in the free-text `description`. So the marker is **not yet a convention** and must
  be defined and adopted.

**DECIDED:** the marker is **`keywords: [blueprint]`** (Helm-native; surfaced verbatim in a repo's
`index.yaml`, so the filter is a one-line jq check). Blueprint chart repos add the keyword; the
Marketplace filters on it.

## 4. Source configuration (data model)

The set of sources the platform browses is **curated config**, not auto-magic. Proposal: a small
CRD (`ChartSource` / `Registry`) or a ConfigMap, each entry:

```yaml
- type: helm-repo | oci | tgz
  url:  https://charts.example.com   # repo root / oci://…/charts / …​.tgz
  repo: example                      # helm-repo only
  credentialsRef: { name, namespace, key }   # optional, private
```

Admin-managed (RBAC). The Marketplace page renders one section per source (or a merged grid with
a source facet).

## 5. Discovery mechanism (the crux)

| Source | How | Difficulty |
|---|---|---|
| **Helm repo** | GET `<url>/index.yaml` — it already lists **every** chart with `name, version, keywords, annotations, icon, description`. Filter entries whose `keywords`/annotations contain the `blueprint` marker; read `icon` straight from the entry. **One fetch, rich metadata, no per-chart pull.** | Easy |
| **tgz** | Pull the tgz, read `Chart.yaml` inside. | Medium (untar) |
| **OCI** | OCI has **no standard "list all charts" API** — `_catalog` is usually disabled / auth-walled (ghcr does not expose it). Either (a) configure **explicit** OCI chart repos and pull each `Chart.yaml`, or (b) use a registry-specific API (e.g. GitHub Packages, needs a token). No registry-wide auto-enumeration. | Hard |

**Who fetches & parses — RA-driven (DECIDED).** The discovery RESTAction owns the *logic* (read the
source list, filter by the marker, shape the output), but jq cannot untar a tgz, run the OCI
token-auth + layer pull, or parse a YAML `index.yaml`. So the RA leans on snowplow's authenticated
fetch + **one** chart primitive — no new "catalog" service:

- **Helm repo** → the RA `endpointRef`-GETs `<url>/index.yaml`. snowplow's `httpcall` already does
  per-call auth, so **private** repos work by passing the source's `credentials` (basic auth). The
  body is YAML, so snowplow must hand it to jq as JSON — it already ships `yaml.YAMLToJSON`
  (`internal/handlers/convert.go`); this needs to be applied to the **api-step response** (small
  snowplow add: a `yaml: true` step flag or content-type sniffing). Then
  `jq: [.entries[][] | select(.keywords // [] | index("blueprint")) | {name, icon: .icon, version}]`.
  One fetch, full metadata, **no per-chart pull**.
- **OCI (explicit) + tgz** → jq can't pull these, especially **private** (OCI bearer-token flow).
  Reuse the **chart-inspector** — it already pulls charts *with credentials* (it does so for the
  core-provider) and caches them. It currently exposes only `/resources`; add a small **`/metadata`**
  endpoint that returns the pulled chart's `Chart.yaml` as JSON. The RA `endpointRef`-calls it per
  configured chart (passing the chart ref + `credentialsRef`) → jq-filters the `blueprint` keyword +
  reads `icon`. Discovery still lives in the RA; the inspector is just a chart-bytes→JSON primitive
  (pull + untar + auth).

**Net: two minimal enablers, both on existing components** — (1) snowplow serving a fetched YAML
body as JSON to the api step; (2) a `chart-inspector /metadata` endpoint. Private repos are covered
because the credentials ride to whichever component does the pull (snowplow httpcall for Helm,
chart-inspector for OCI/tgz). Fast path: ship the **Helm-repo** slice first (only enabler #1).

## 6. Portal wiring

- New **`marketplace-catalog`** RESTAction (the discovery RA of §5 / Appendix A) →
  returns `[{ name, version, icon, description, source, keywords }]`.
- **`marketplace-grid`** (the existing List) is repointed from `blueprints-cards` to
  `marketplace-catalog`. Tiles render: title = chart name, `icon` = Chart.yaml URL, tags = keywords,
  **Install** → the create flow.
- **Card widget change:** today `icon` is a FontAwesome *name*; chart icons are **URLs**. Add an
  image/avatar branch to the Card (render `<img src>` when `icon` is a URL) — small frontend change,
  alongside the existing fa-resolver.
- **Install action:** a Button/Form that POSTs a `CompositionDefinition` with `spec.chart` built
  from the selected chart (`url`/`repo` + `version`) into the target namespace. On success it
  appears under Blueprints (and the per-blueprint Card is generated as today).

## 7. Migration from the current model

- **Blueprints** page becomes the home of the installed set: keep the per-blueprint Card discovery
  (label `krateo.io/portal-page: blueprints`) **or** switch it to a direct `CompositionDefinition`
  list RA. Either way it reflects *installed*.
- **Marketplace** stops reading installed Card CRs and reads `marketplace-catalog` instead.
- gen-portal-widgets stays responsible for the *installed-blueprint* Card (Blueprints), not for
  Marketplace tiles (which are now ephemeral, derived from discovery).

## 8. Decisions & open items

**Decided:** marker = `keywords: [blueprint]` (§3) · explicit OCI repos only (§5) · discovery is
RA-driven (§5) · sources = the 3 CompositionDefinition chart types, **private supported** via
`credentials` (§4–5).

**Needs sign-off — the two enablers (both on existing components):**
1. **snowplow YAML→JSON on an api-step response** so the RA can jq a Helm `index.yaml` — small add
   (a `yaml: true` step flag / content-type sniff) reusing `convert.go`.
2. **`chart-inspector /metadata` endpoint** returning a pulled chart's `Chart.yaml` as JSON (with
   credentials) — for OCI/tgz. The inspector already pulls + auths; this just exposes Chart.yaml.

**Still open:**
3. **Card icons**: chart `icon` is a **URL** → add an `<img>`/avatar branch to the Card (alongside
   the FontAwesome resolver).
4. **Source config**: a `ChartSource`/`Registry` CRD vs a ConfigMap; admin curation / RBAC.
5. **Versions**: show latest per chart, or list all (install picks one).

## 9. Suggested build order
1. **Helm-repo slice** (only enabler #1): source ConfigMap → discovery RA (`index.yaml` → YAML→JSON
   → filter `blueprint`) → repoint `marketplace-grid` → Card URL-icon. End-to-end with public repos.
2. **Private + OCI/tgz**: chart-inspector `/metadata` (enabler #2) + `credentials` plumbing.
3. **Install flow**: tile → create `CompositionDefinition` → appears under Blueprints.
4. **Blueprints page** switches to an installed-compdef view.

## 10. Verification (when built)

Configure a Helm repo containing a chart with `keywords: [blueprint]` and an `icon:` → it appears
in Marketplace with that icon → **Install** → a `CompositionDefinition` is created → the blueprint
shows under Blueprints. Repeat for an explicit OCI chart and a tgz URL.

## 11. Work breakdown (by repo — for the implementing session)

| Repo | Work |
|---|---|
| **snowplow** | Enabler #1 — YAML api-step (Appendix A.D): add `YAML bool \`json:"yaml"\`` to the api-step spec; in `internal/resolvers/restactions/api/apistage.go`, run `yaml.YAMLToJSON(raw)` before the response `json.Unmarshal` when `step.YAML` (or a YAML `Content-Type` is sniffed), reusing the `sigs.k8s.io/yaml` already used by `internal/handlers/convert.go`. |
| **krateo-chart-inspector** | Enabler #2 — add a **`/metadata`** endpoint (Appendix B): given a chart ref (`url`/`repo`+`version`) + optional credentials, pull via the existing `getter.Get` and return `Chart.yaml` as JSON. Used for OCI/tgz only. |
| **krateo-portal-chart** | Source config (`ChartSource` CRD or a ConfigMap, with `credentials`); an `Endpoint` per Helm-repo source; the **`marketplace-catalog`** RESTAction (Appendix A.A — Helm path; per-OCI/tgz chart calls chart-inspector `/metadata`); repoint **`marketplace-grid`** to it; an **install** Button/Form that POSTs a `CompositionDefinition` from the selected chart; switch the **Blueprints** page to an installed-`CompositionDefinition` view. |
| **krateo-frontend** | Card widget: render `icon` as an **`<img>`** when it's a URL (chart icons are URLs), alongside the existing FontAwesome-name resolver. Regenerate Card types/CRD. |

---

## Appendix A — Enabler #1: snowplow YAML api-step (concrete)

**A.A — the discovery RESTAction (Helm-repo path):**
```yaml
apiVersion: templates.krateo.io/v1
kind: RESTAction
metadata: { name: marketplace-catalog, namespace: krateo-system }
spec:
  api:
    - name: index
      endpointRef: { name: charts-example-repo, namespace: krateo-system }  # Endpoint carries auth → private repos work
      path: /index.yaml
      verb: GET
      yaml: true            # ← the enabler: snowplow converts the YAML body to JSON before jq
      continueOnError: true
  filter: >
    [ .index.entries | to_entries[] | .value[0] as $latest
      | select(($latest.keywords // []) | index("blueprint"))     # the marker
      | { name: .key, version: $latest.version, icon: $latest.icon,
          description: $latest.description, keywords: ($latest.keywords // []) } ]
```

**A.B — what it fetches (real Helm `index.yaml`, grounded in `aws-eks-stack`):**
```yaml
apiVersion: v1
entries:
  aws-eks-stack:
    - name: aws-eks-stack
      version: "0.3.0"
      description: A Krateo composite blueprint that provisions an AWS EKS cluster…
      icon: https://github.com/krateoplatformops/krateo/.../logo.svg
      keywords: [aws, eks, kubernetes, ack, stack, blueprint]      # chart author adds the marker
      urls: [oci://ghcr.io/braghettos/charts/aws-eks-stack]
  prometheus:                                                       # not a blueprint
    - { name: prometheus, version: "25.0.0", keywords: [monitoring] }   # filtered out
```
(Today this chart's keywords are `[aws, eks, kubernetes, ack, stack]` — no `blueprint` — and `icon`
is the generic Krateo logo. Adopting the `blueprint` keyword + a per-chart icon is the chart
author's part.)

**A.C — RA output → straight into `marketplace-grid`:**
```json
[{ "name":"aws-eks-stack", "version":"0.3.0", "icon":"https://…/logo.svg",
   "description":"A Krateo composite blueprint…",
   "keywords":["aws","eks","kubernetes","ack","stack","blueprint"] }]
```

**A.D — the snowplow change (~6 lines + a field):**
```go
// internal/resolvers/restactions/api/apistage.go — immediately before the response unmarshal.
// A step may declare `yaml: true` (or we sniff Content-Type: text/yaml | application/x-yaml):
// convert the body to JSON first, reusing handlers/convert.go's sigs.k8s.io/yaml.
if step.YAML || isYAMLContentType(resp.Header.Get("Content-Type")) {
    if j, err := yaml.YAMLToJSON(raw); err == nil { raw = j }
}
if err := json.Unmarshal(raw, &v); err != nil { /* … existing (apistage.go:110) … */ }
```
Effect: every YAML endpoint (Helm `index.yaml`, raw `Chart.yaml`, any `*.yaml`) becomes
jq-queryable; `endpointRef` auth already covers private repos.

## Appendix B — Enabler #2: chart-inspector `/metadata` (concrete)

The chart-inspector already pulls charts (with credentials, cached) for the core-provider; it just
needs to expose the pulled `Chart.yaml`. Proposed contract:

```
GET /metadata?url=oci://ghcr.io/braghettos/charts/aws-eks-stack&version=0.3.0
    (+ Authorization / credentials header for private)
→ 200 application/json  { "name": "...", "version": "0.3.0", "keywords": [...],
                          "icon": "https://…", "description": "...", "annotations": {...} }
```
Implementation: reuse `getter.Get` (the same path `/resources` uses) to fetch the chart archive,
read `Chart.yaml`, marshal to JSON. Then the discovery RA, for each explicit **OCI/tgz** source:
```yaml
    - name: meta
      endpointRef: { name: chart-inspector, namespace: krateo-system }
      path: ${ "/metadata?url=" + (.source.url) + "&version=" + (.source.version) }
      verb: GET
      continueOnError: true
```
and the same `select(.keywords | index("blueprint"))` filter applies — so Helm-repo and OCI/tgz
paths converge on one output shape.
