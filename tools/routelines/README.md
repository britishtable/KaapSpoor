# tools/routelines

**This tool no longer produces `data/route-lines.geojson`.** The `/draw` editor
in the app does, and every line on the map is drawn by the author — see
`docs/superpowers/specs/2026-08-17-drawn-route-lines-design.md`.

What remains here is the reference implementation of the walking graph, kept
because `app/src/lib/map/snap.ts` is a port of it and these tests are the
contract that port has to keep:

| module | what it is |
|---|---|
| `geo.py` | haversine distance, polyline length, and the 7-decimal node key |
| `ways.py` | reads osmium's GeoJSON-seq export into walkable ways |
| `graph.py` | adjacency over node keys, connected components, Dijkstra, `split_ways` |
| `relations.py` | reads OSM route relations, members and roles intact |
| `trails.py` | a named trail's ways, and how badly fragmented they are |

    cd tools/routelines && python -m pytest

Tests need neither the OSM extract nor the tiles.

## Why `split_ways` exists, and why the browser does not need it

The Python graph makes whole OSM ways its edges, so it must cut them wherever
another way meets one mid-span. Measured on this extract: **156,643 of 219,996
junctions are interior vertices** of some way, against 63,353 that are way
endpoints. Missing them shattered the graph into 127,109 components whose
largest held 1,889 of 325,799 nodes, and nothing could reach anything.

`snap.ts` avoids the problem instead of solving it: every vertex is a node, so
two lines sharing an interior vertex already meet at one. It also has to merge
coordinates within a metre of each other, because the vector tiles return a
trail once per tile and the copies disagree in their last decimals — 135 such
pairs in a single editor view, each one a break in a visibly continuous trail.

## The extract

`tools/geocode/extract-osm-features.sh` (WSL, osmium) still writes the inputs
these modules read:

- `work/walkable-ways.geojsonl` — every walkable way, unnamed connectors included
- `work/route-relations.osm` — hiking route relations as OSM XML

XML rather than OSM JSON because osmium's JSON writer is a compile-time option
Ubuntu's package does not enable: `osmium cat -f json` fails with "No support
for writing this format in this program" on 1.16, and a newer release does not
change that. `relations.py` accepts either.

## The DEM the editor samples

`/draw` writes elevation into each drawn line. It reads
`data/dem/dem-<region>.tif`, which is gitignored — copy it once out of the tiles
work directory after running `tools/tiles/build-contours.sh`:

    mkdir -p data/dem
    cp ~/kaapspoor-tiles/work/dem-cape-town.tif data/dem/

Set `KAAPSPOOR_DEM` to override the path. Without it the editor still draws and
saves; the lines simply carry no heights and no profile renders.
