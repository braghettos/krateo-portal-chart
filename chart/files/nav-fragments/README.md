# nav-fragments

Sidebar-nav entries for **Autopilot-authored portal pages** (#106). Each published page drops
one file here as part of its publish PR, so its sidebar entry ships WITH the page — no manual
edit of `templates/menu.sidebar-nav.yaml`.

One file per page, `<slug>.yaml`, shape:

```yaml
item: { label: My Page, icon: fa-file, order: 950, path: /my-page, page: my-page }
```

`menu.sidebar-nav.yaml` globs `files/nav-fragments/*.yaml` and appends each `item` to the Menu's
`items` list. Builder pages use the `page:<slug>` convention (resolves `flexes/page-<slug>`), so a
fragment needs ONLY `item` — no `resourcesRefs` entry. `order` controls sidebar position (antd
Menu sorts by it). This README is ignored (glob matches `*.yaml` only).
