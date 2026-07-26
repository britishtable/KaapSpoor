# Tile build

Builds the two PMTiles archives the map needs. Output is git-ignored; see the size
report for whether to commit it or publish it as a release asset.

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

Both build scripts do their heavy I/O (downloads, planetiler/gdal/tippecanoe intermediates)
under `$WORK` (default `$HOME/kaapspoor-tiles`) on WSL's own filesystem, not under `/mnt/c`
— crossing the Windows/WSL filesystem boundary for repeated random-access reads on files of
this size dominates the build time. Only the finished `.pmtiles` files are copied back into
`app/static/tiles/`.

## Build

```bash
./build-trails.sh      # downloads the region extract and planetiler.jar on first run
./build-contours.sh    # downloads the DEM tiles itself
./fetch-fonts.sh        # downloads a prebuilt "Open Sans Regular" glyph set
node report-size.mjs
```

## Contract with the app

`app/src/lib/map/style.ts` references these source-layer names. Renaming them here
breaks the map:

| Archive | Source layers |
|---|---|
| `trails.pmtiles` | `paths`, `roads`, `water`, `peaks` |
| `contours.pmtiles` | `contours` (with an `ele` attribute) |

Contours are 20 m intervals; `style.ts` weights lines where `ele % 100 == 0`.

Verify layer names and attributes actually landed correctly after any change — a
mismatch breaks the map silently:

```bash
tippecanoe-decode app/static/tiles/contours.pmtiles <z> <x> <y> | head   # any tile that exists at that zoom
ogrinfo -al -so /vsipmtiles/app/static/tiles/trails.pmtiles              # or use `pmtiles show`
```

## Licensing

OSM data is ODbL — attribution is required and already wired into the style. The DEM's
own attribution belongs in the style's attribution string too.
