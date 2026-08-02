# Tile build

Builds the PMTiles archives each region's map needs. `regions.json` is the single
source of truth for which regions exist and what bbox each one covers — each region
is a **standalone map**, not a tile of one continuous surface. Output is git-ignored;
the archives are published as release assets, not committed.

## Prerequisites

These commands only exist in WSL Ubuntu on this project's dev machine, not on Windows
directly. Run everything through `wsl -d Ubuntu -- bash <script>` (or `bash -lc '...'`
with no nested `$variables`, since those get mangled crossing the Windows/WSL boundary).

- Java 21+ (`java -jar planetiler.jar ...`) — `build-trails.sh` downloads `planetiler.jar`
  itself into `$WORK` on first run (<https://github.com/onthegomap/planetiler/releases>)
- GDAL (`gdal_contour`, `gdalwarp`, `gdalbuildvrt`, `ogr2ogr`), `tippecanoe`, `curl`, `jq`,
  `unzip`
- No DEM to supply by hand: `build-contours.sh` downloads the Copernicus GLO-30 tiles it
  needs from AWS's public bucket (<https://registry.opendata.aws/copernicus-dem/>) — no login,
  no API key
- The `pmtiles` CLI is required **only for hillshade** (`build-hillshade.sh`). Get the Go
  implementation from <https://github.com/protomaps/go-pmtiles/releases> — grab
  `go-pmtiles_<version>_Linux_x86_64.tar.gz`, which extracts a `pmtiles` binary; put it on
  PATH. Do not confuse this with `protomaps/PMTiles`, which is the spec/JS library repo and
  will not get you the CLI (its releases page 404s for this purpose).

All three build scripts do their heavy I/O (downloads, planetiler/gdal/tippecanoe intermediates)
under `$WORK` (default `$HOME/kaapspoor-tiles`) on WSL's own filesystem, not under `/mnt/c`
— crossing the Windows/WSL filesystem boundary for repeated random-access reads on files of
this size dominates the build time. Only the finished `.pmtiles` files are copied back into
`app/static/tiles/`.

## Build

Every build command takes a region id from `regions.json` as its first argument:

```bash
./build-trails.sh cape-town      # downloads the region extract and planetiler.jar on first run
./build-contours.sh cape-town    # downloads the DEM tiles itself, clips a dem-<region>.tif
./build-hillshade.sh cape-town   # optional; reuses the DEM build-contours.sh just clipped
./fetch-fonts.sh                 # downloads a prebuilt "Open Sans Regular" glyph set (not region-specific)
node report-size.mjs
```

`build-hillshade.sh` does not clip its own DEM — it reuses `dem-<region>.tif`, the file
`build-contours.sh` already produced for that region. Run contours before hillshade for any
given region, or hillshade will fail with a missing-file error rather than silently refetching.

### Adding a region

Adding a region is a data change, not a code change: add an entry to `regions.json` (id,
label, bbox, the route `areas` prefixes that define it) and run the three build scripts
above with the new id. Nothing in the build scripts themselves needs editing.

## Contract with the app

`app/src/lib/map/style.ts` references these source-layer names. Renaming them here
breaks the map:

| Archive | Source layers |
|---|---|
| `trails-<region>.pmtiles` | `paths`, `roads`, `water`, `peaks`, `landcover`, `places` |
| `contours-<region>.pmtiles` | `contours` (with an `ele` attribute) |
| `hillshade-<region>.pmtiles` | single-band greyscale raster, no alpha channel |

Contours are 20 m intervals; `style.ts` weights lines where `ele % 100 == 0`.

Verify layer names and attributes actually landed correctly after any change — a
mismatch breaks the map silently:

```bash
tippecanoe-decode app/static/tiles/contours-cape-town.pmtiles <z> <x> <y> | head   # any tile that exists at that zoom
ogrinfo -al -so /vsipmtiles/app/static/tiles/trails-cape-town.pmtiles              # or use `pmtiles show`
```

`verify-layers.sh <region> <trails|contours>` runs the layer-presence half of this check
automatically at the end of the corresponding build script.

## Licensing

OSM data is ODbL — attribution is required and already wired into the style. The DEM's
own attribution belongs in the style's attribution string too.

## Measured (record each rebuild)

| Date | Region | trails | contours | hillshade | Total | Hosting |
|---|---|---|---|---|---|---|
| 2026-07-26 | (province-wide, pre-recut) | 33.7 MB | 90.9 MB | — | 124.6 MB | release asset `tiles-v1` |
| 2026-08-02 | cape-town | 5,774,061 B (~5.5 MB) | 1,114,448 B (~1.1 MB) | 2,121,908 B (~2.0 MB) | 8.6 MB | release asset `tiles-cape-town-v1` |

Rebuilding: run the build scripts for the region, then `gh release upload tiles-<region>-v1
--clobber` the new archives. To cut a new tag instead, change `TILES_TAG` in
`.github/workflows/deploy.yml`. That variable also gates the `fonts.tar.gz` fetch (same
workflow, same tag), so **a new tiles release must carry `fonts.tar.gz` alongside the
`.pmtiles` files** — omitting it fails CI, since the deploy step downloads glyphs from
that release too.

Contours dominate the province-wide total — the 20 m interval over mountainous terrain was
the cost there. At regional scale, trails dominate instead; hillshade is the one raster
archive and the only one that could threaten the size budget, so `report-size.mjs` gates it
at 30 MB.
