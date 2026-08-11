# tools/pathnames

Extracts every named path in the shipped region from the trails PMTiles archive.

    cd tools/pathnames
    npm install
    npm run extract

Writes `data/osm-path-names.json` and `data/path-names-report.md`, both committed.

**Run it by hand whenever the tiles are rebuilt.** CI never runs it: `npm test` and
`npm run check` execute before the tile download in `.github/workflows/deploy.yml`, so
nothing in the app build may depend on an archive being present.

Needs `app/static/tiles/trails-<region>.pmtiles` locally — download it from the
`TILES_TAG` release named in the deploy workflow, or build it with `tools/tiles/`.

Unlike `tools/tiles` and `tools/geocode`, this runs on Windows as well as WSL: it reads
a PMTiles archive with pure Node and needs neither GDAL nor osmium.
