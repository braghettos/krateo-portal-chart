def qstr($p): ([ $p | to_entries[] | select(.value != null and .value != "") | (.key + "=" + .value) ] | join("&")) as $s
  | (if $s == "" then "/marketplace" else "/marketplace?" + $s end);
( [ (.compdefs // [])[] | {key: .name, value: .version} ] | from_entries ) as $inst
| ((.category) // "all") as $sel
| ((.source) // "all") as $src
| ((.q) // "") as $q
| ((.spotlight) // "") as $spot
# ?sort= reorders the grid. Only two orders the helm index actually supports:
#   "name"   -> chart name A->Z (the default; every entry has a name)
#   "recent" -> most-recently-published first (index `created` RFC3339, desc)
# The index carries NO downloads/popularity/rating field, so no "trending"/"popular"
# sort is offered (would be fabricated). Unknown ?sort= values fall back to name.
| (((.sort) // "name") | if . == "recent" then "recent" else "name" end) as $sort
| ($q | ascii_downcase) as $ql
| (
    [ (((.catalog // {}).entries) // {}) | to_entries[] | (.value[0] + {source: "blueprint"}) ]
    + [ (((.operators // {}).entries) // {}) | to_entries[] | (.value[0] + {source: "operator"}) ]
  ) as $raw
| ( [ $raw[]
      | {
          name: .name,
          description: (.description // ""),
          keywords: (.keywords // []),
          tags: (.keywords // []),
          source: .source,
          typeLabel: (if .source == "operator" then "Operator" else "Blueprint" end),
          typeColor: (if .source == "operator" then "magenta" else "cyan" end),
          icon: (if .source == "operator" then "fa-gears" else "fa-layer-group" end),
          maturity: ((.annotations // {})["krateo.io/maturity"] // ""),
          version: (.version // ""),
          # helm index publish timestamp (RFC3339); drives the "recently updated" sort.
          created: (.created // ""),
          url: (.urls[0] // ""),
          repoUrl: ((.urls[0] // "") | sub("/[^/]+$"; "")),
          installed: ($inst[.name] != null),
          installedVersion: ($inst[.name] // ""),
          # at-a-glance "already installed" check on the tile (reuses the Listy status glyph);
          # empty icon when not installed -> the card renders no glyph.
          installedIcon: (if $inst[.name] != null then "fa-circle-check" else "" end),
          installedColor: (if $inst[.name] != null then "green" else "" end),
          installedTooltip: (if $inst[.name] != null then ("Installed · v" + ($inst[.name] // "")) else "" end)
        }
    ] ) as $cards
# The cards matching the ACTIVE facets (source + category + free-text) — computed once so
# BOTH the head-stat count and the rendered grid stay in sync (the head-stat reflects what
# is actually shown, never a fabricated total).
| ( [ $cards[] | select(
        ($src == "all" or .source == $src)
        and ($sel == "all" or ((.keywords | index($sel)) != null))
        and ($ql == ""
             or (.name | ascii_downcase | contains($ql))
             or (.description | ascii_downcase | contains($ql))
             or ((.keywords | join(" ")) | ascii_downcase | contains($ql)))
    ) ] ) as $shown
# Head-stat noun: reflects the active source facet so the eyebrow reads honestly
# ("blueprints" / "operators" / "charts" when the catalog is mixed).
| (if $src == "blueprint" then "blueprints"
   elif $src == "operator" then "operators"
   else "charts" end) as $countLabel
| {
    selectedCategory: $sel,
    selectedSource: $src,
    selectedSort: $sort,
    # Head-stat: real catalog cardinality. `total` = every card fetched from both indexes
    # (unfiltered); `count` = the cards the active facets show (what the grid renders).
    total: ($cards | length),
    count: ($shown | length),
    countLabel: $countLabel,
    categories: (
      [ {key: "all", label: "All", count: ($cards | length), active: ($sel == "all"),
         route: qstr({category: "", source: (if $src == "all" then "" else $src end), q: $q, sort: (if $sort == "name" then "" else $sort end)})} ]
      + ( [ $cards[] | .keywords[] ] | group_by(.)
          | map({key: .[0], label: .[0], count: length, active: (.[0] == $sel),
                 route: qstr({category: .[0], source: (if $src == "all" then "" else $src end), q: $q, sort: (if $sort == "name" then "" else $sort end)})})
          | map(select(.count >= 5)) | sort_by(.count) | reverse )
    ),
    sources: [
      {key: "all", label: "All", active: ($src == "all"),
       route: qstr({source: "", category: (if $sel == "all" then "" else $sel end), q: $q, sort: (if $sort == "name" then "" else $sort end)})},
      {key: "blueprint", label: "Blueprints", active: ($src == "blueprint"),
       route: qstr({source: "blueprint", category: (if $sel == "all" then "" else $sel end), q: $q, sort: (if $sort == "name" then "" else $sort end)})},
      {key: "operator", label: "Operators", active: ($src == "operator"),
       route: qstr({source: "operator", category: (if $sel == "all" then "" else $sel end), q: $q, sort: (if $sort == "name" then "" else $sort end)})}
    ],
    # Sort facet — ONLY the orders the helm index data supports (name, created). Each
    # chip's route preserves the active source/category/q filter so sort composes.
    sorts: [
      {key: "name", label: "Name (A–Z)", active: ($sort == "name"),
       route: qstr({sort: "", source: (if $src == "all" then "" else $src end), category: (if $sel == "all" then "" else $sel end), q: $q})},
      {key: "recent", label: "Recently updated", active: ($sort == "recent"),
       route: qstr({sort: "recent", source: (if $src == "all" then "" else $src end), category: (if $sel == "all" then "" else $sel end), q: $q})}
    ],
    cards: (
      # Base order per ?sort=: name A->Z (default) or created desc (most recent first).
      ( if $sort == "recent" then ($shown | sort_by(.created) | reverse)
        else ($shown | sort_by(.name)) end )
      # ?spotlight=<name> (a global-search catalog hit's hand-off): sort the matching
      # card FIRST and mark it via the EXISTING status-glyph channel (gold star +
      # tooltip) — search always lands on installable-only hits, so the installed
      # check (which this channel normally carries) is guarded, never overwritten.
      | (if $spot == "" then .
         else ( map(if (.name == $spot) and (.installed | not)
                    then . + { installedIcon: "fa-star", installedColor: "gold", installedTooltip: "Matched your search" }
                    else . end)
                | ([ .[] | select(.name == $spot) ] + [ .[] | select(.name != $spot) ]) )
         end)
    )
  }