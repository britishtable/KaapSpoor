# Geocoding report

**OSM extract date:** 2026-07-30

Located **181 / 184** routes; **3** remain unlocated.

## Tier mix

| Source | Routes |
|---|---|
| `curated` | 4 |
| `crawl` | 125 |
| `osm-match` | 11 |
| `area-approx` | 41 |

## OSM matches

Each row names the candidate string that matched. A match on a heavily
stripped candidate is weaker evidence than one on a full title — review
those and override where wrong.

| Route | Matched candidate | OSM feature |
|---|---|---|
| `peninsula--hout-bay--sunset-rocks-to-logie-rocks` | Sunset Rocks | Sunset Rocks (node/9968087466) |
| `peninsula--silvermine--constantiaberg-north-west-route` | Constantiaberg | Constantiaberg (node/388608972) |
| `peninsula--silvermine--st-james-buttress` | St James Buttress | St James Buttress (way/950046518) |
| `peninsula--simonstown--elsies-pk-circumnavigation-traverse` | Elsies Pk | Elsies Peak (node/4756650027) |
| `table-mountain--atlantic-west--valken-ravine` | Valken Ravine | Valken Ravine (way/751327969) |
| `table-mountain--devils-peak--devils-peak-east-ridge` | Devils Peak | Devil's Peak (node/2718061707) |
| `table-mountain--devils-peak--devils-peak-via-the-saddle` | Devils Peak | Devil's Peak (node/2718061707) |
| `table-mountain--lions-head--lion-s-head-south-east-arete` | Lion's Head | Lion's Head (node/48944401) |
| `table-mountain--lions-head--lions-head-b` | Lion's Head | Lion's Head (node/48944401) |
| `table-mountain--newlands-east--nursery-buttress` | Nursery Buttress | Nursery Buttress (way/456205637) |
| `table-mountain--newlands-east--window-gorge` | Window Gorge | Window Gorge (way/776424004) |

## Ambiguous — needs a curated override

More than one feature of this name sits inside the route's area, so no
match was claimed. These fell through to `area-approx`.

| Route | Candidate | Features |
|---|---|---|
| `cape-country--garden-route-little-karoo--swartberg` | Swartberg | 2 |
| `peninsula--hout-bay--disa-river-walk` | Disa River | 3 |
| `peninsula--hout-bay--twelve-apostles-path` | Twelve Apostles Path | 13 |
| `table-mountain--newlands-east--newlands-ravine` | Newlands Ravine | 3 |

## Orphaned overrides — routeId matches nothing in this crawl

These entries in `data/geocode-overrides.json` did nothing this run: no
route with this id exists in the current crawl, likely a typo or a route
since renamed or removed. Fix or remove the entry.

None.

## Still unlocated

- `cape-country--garden-route-little-karoo--donkey-trail-1`
- `cape-country--garden-route-little-karoo--swartberg`
- `cape-country--overberg--klipspringer`

## Area-approximate

| Route | Accuracy (m) |
|---|---|
| `cape-country--cape-karoo--elandsberg-stanley-s-light-trail` | 2000 |
| `cape-country--cape-karoo--gamkaberg` | 2000 |
| `cape-country--cederberg--dwarsrivier-lot-s-wife-trail` | 2000 |
| `cape-country--cederberg--kromriver-farm-disa-pool-hike` | 2000 |
| `cape-country--cederberg--kromriver-farm-rensie-s-tv-mast-hike` | 2000 |
| `cape-country--cederberg--maltese-cross-hike` | 2000 |
| `cape-country--cederberg--tafelberg-gully-route` | 2000 |
| `cape-country--cederberg--truitjieskraal-trail` | 2000 |
| `cape-country--cederberg--wolfberg-cracks` | 2000 |
| `cape-country--winelands--du-toits-kloof-klein-drakenstein--elandspad-at-du-toits` | 8585 |
| `peninsula--chapmans-peak-drive-noordhoek--blackburn-buttress` | 2000 |
| `peninsula--chapmans-peak-drive-noordhoek--noordhoek-peak-gully` | 2000 |
| `peninsula--hout-bay--disa-river-walk` | 2809 |
| `peninsula--hout-bay--sentinel-se-ridge` | 2809 |
| `peninsula--hout-bay--twelve-apostles-path` | 2809 |
| `peninsula--silvermine--circuit-of-the-ridges-1` | 5543 |
| `peninsula--silvermine--kleintuinkop` | 5543 |
| `peninsula--silvermine--muizenberg-buttress` | 5543 |
| `peninsula--silvermine--steenberg-buttress` | 5543 |
| `peninsula--silvermine--vlakkenberg-3-rocky-peaks-ridge` | 5543 |
| `table-mountain--atlantic-west--boschkloof-traverse-needle` | 3911 |
| `table-mountain--atlantic-west--corridor-rib` | 3911 |
| `table-mountain--atlantic-west--kasteels-gully` | 3911 |
| `table-mountain--atlantic-west--postern-south-face-b` | 3911 |
| `table-mountain--atlantic-west--slangolie-ravine` | 3911 |
| `table-mountain--atlantic-west--wood-spring-traverse` | 3911 |
| `table-mountain--atlantic-west--woody-left-hand-route` | 3911 |
| `table-mountain--back-table-ie-top` | 5436 |
| `table-mountain--devils-peak--saddle-ravine` | 2000 |
| `table-mountain--front-face-north--fountain-ledges` | 2000 |
| `table-mountain--front-face-north--right-face-to-plattelklip` | 2000 |
| `table-mountain--lions-head--lions-head-360-route` | 5436 |
| `table-mountain--newlands-east--ascension-traverse` | 3162 |
| `table-mountain--newlands-east--carrel-s-ledge` | 3162 |
| `table-mountain--newlands-east--finesteraar-crack` | 3162 |
| `table-mountain--newlands-east--newlands-ravine` | 3162 |
| `table-mountain--orange-kloof--3rd-ridge` | 2222 |
| `table-mountain--orange-kloof--lang-kloof` | 2222 |
| `table-mountain--orange-kloof--myburghs-corner` | 2222 |
| `table-mountain--orange-kloof--room-with-a-view` | 2222 |
| `table-mountain--orange-kloof--wynberg-caves-ridge` | 2222 |
