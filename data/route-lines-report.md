# Route lines review

OSM extract: 2026-08-17

**24 routes have a line**; 160 were rejected.
A rejected route keeps its pin and draws nothing, which is the design:
a wrong line is a wrong claim about the mountain.

## Accepted

| route | tier | length | connectors | ways | relation |
|---|---|---|---|---|---|
| `table-mountain--atlantic-west--corridor-ravine` | osm-relation | 0.6 km | 0.0 km | 1 | 7057852 |
| `table-mountain--atlantic-west--diagonal-route` | osm-relation | 1.8 km | 0.0 km | 4 | 6198096 |
| `table-mountain--atlantic-west--kasteels-buttress` | osm-stitch | 1.4 km | 0.1 km | 5 | — |
| `table-mountain--atlantic-west--kasteelspoort` | osm-relation | 1.3 km | 0.0 km | 3 | 7057855 |
| `table-mountain--atlantic-west--llandudno-buttress` | osm-stitch | 0.4 km | 0.0 km | 4 | — |
| `table-mountain--atlantic-west--llandudno-ravine` | osm-stitch | 0.7 km | 0.1 km | 6 | — |
| `table-mountain--atlantic-west--not-woody-buttress` | osm-stitch | 1.8 km | 0.0 km | 3 | — |
| `table-mountain--atlantic-west--porcupine-anvil` | osm-stitch | 9.5 km | 1.5 km | 50 | — |
| `table-mountain--atlantic-west--valken-ravine` | osm-stitch | 0.5 km | 0.0 km | 1 | — |
| `table-mountain--atlantic-west--wood-ravine` | osm-relation | 2.7 km | 0.0 km | 6 | 6682368 |
| `table-mountain--devils-peak--mobray-ridge` | osm-relation | 1.4 km | 0.0 km | 3 | 7057976 |
| `table-mountain--front-face-north--india-venster-path-b` | osm-relation | 2.5 km | 0.0 km | 5 | 6693845 |
| `table-mountain--front-face-north--platteklip-gorge` | osm-relation | 2.1 km | 0.0 km | 4 | 2934380 |
| `table-mountain--newlands-east--cecilia-ravine` | osm-stitch | 0.7 km | 0.0 km | 1 | — |
| `table-mountain--newlands-east--constantia-corner` | osm-stitch | 2.8 km | 0.2 km | 17 | — |
| `table-mountain--newlands-east--dark-gorge` | osm-stitch | 1.9 km | 0.1 km | 6 | — |
| `table-mountain--newlands-east--els-ravine` | osm-stitch | 1.2 km | 0.1 km | 3 | — |
| `table-mountain--newlands-east--newlands-ravine` | osm-relation | 1.1 km | 0.0 km | 2 | 7057846 |
| `table-mountain--orange-kloof--frustration-ravine` | osm-stitch | 1.1 km | 0.0 km | 1 | — |
| `table-mountain--orange-kloof--klaasens-buttress-traverses` | osm-stitch | 1.5 km | 0.0 km | 9 | — |
| `cape-country--garden-route-little-karoo--otter-trail` | osm-relation | 36.6 km | 0.0 km | 26 | 1383551 |
| `peninsula--hout-bay--suther-peak-from-hout-bay` | osm-stitch | 1.5 km | 0.0 km | 2 | — |
| `peninsula--silvermine--trappies-surprise` | osm-stitch | 1.2 km | 0.1 km | 5 | — |
| `peninsula--simonstown--swartkop-left-face` | osm-stitch | 0.8 km | 0.0 km | 2 | — |

## Rejected

| route | reason |
|---|---|
| `table-mountain--atlantic-west--7-buttresses-apostles-traverse` | connector: a single 712 m bridge exceeds 500 m before '7 Buttresses Traverse' |
| `table-mountain--atlantic-west--blind-gully` | connectors: 659 m of 1761 m is over the 20% cap |
| `table-mountain--atlantic-west--blind-gully-porcupine-traverse` | connectors: 872 m of 2848 m is over the 20% cap |
| `table-mountain--atlantic-west--blinkawater-ravine` | anchor: no path within 250 m of the position |
| `table-mountain--atlantic-west--boschkloof-traverse-needle` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--atlantic-west--cairn-ravine` | connector: a single 743 m bridge exceeds 500 m before 'Pipe Track' |
| `table-mountain--atlantic-west--corridor-face` | connector: a single 842 m bridge exceeds 500 m before 'Pipe Track' |
| `table-mountain--atlantic-west--corridor-rib` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--atlantic-west--grootkop-yellowwood-traverse` | no names: the description names no mapped path |
| `table-mountain--atlantic-west--grotto-fountain-cairn` | connector: a single 1054 m bridge exceeds 500 m before 'Kloof Corner' |
| `table-mountain--atlantic-west--grotto-ravine` | connector: a single 743 m bridge exceeds 500 m before 'Pipe Track' |
| `table-mountain--atlantic-west--hairpin-route` | anchor: no path within 250 m of the position |
| `table-mountain--atlantic-west--hout-bay-corner` | connector: a single 510 m bridge exceeds 500 m before 'Llandudno Ravine' |
| `table-mountain--atlantic-west--jubilee-buttress` | connector: a single 537 m bridge exceeds 500 m before 'Diagonal Route' |
| `table-mountain--atlantic-west--kasteels-gully` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--atlantic-west--lekkerwater-traverse` | connector: a single 512 m bridge exceeds 500 m before 'Grove Walk' |
| `table-mountain--atlantic-west--oudekraal-ravine` | connector: a single 692 m bridge exceeds 500 m before 'Corridor Ravine' |
| `table-mountain--atlantic-west--pimple-traverse` | connector: a single 512 m bridge exceeds 500 m before 'Victoria Ravine' |
| `table-mountain--atlantic-west--postern-south-face-b` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--atlantic-west--separation-buttress` | connector: a single 512 m bridge exceeds 500 m before 'Llandudno Ravine' |
| `table-mountain--atlantic-west--slangolie-ravine` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--atlantic-west--spring-buttress` | connector: a single 876 m bridge exceeds 500 m before 'Three Firs' |
| `table-mountain--atlantic-west--spring-step-over` | connectors: 2329 m of 9824 m is over the 20% cap |
| `table-mountain--atlantic-west--three-firs` | connector: a single 842 m bridge exceeds 500 m before 'Pipe Track' |
| `table-mountain--atlantic-west--wood-spring-traverse` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--atlantic-west--woody-buttress` | connector: a single 876 m bridge exceeds 500 m before 'Woody Ravine' |
| `table-mountain--atlantic-west--woody-left-hand-route` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--back-table-ie-top` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--devils-peak--1st-waterfall-ravine` | connector: a single 871 m bridge exceeds 500 m before '700m Traverse' |
| `table-mountain--devils-peak--blockhouse-ridge` | connector: a single 1042 m bridge exceeds 500 m before 'Mowbray Ridge' |
| `table-mountain--devils-peak--devil-s-peak-oppelskop-ridge-b` | connector: a single 825 m bridge exceeds 500 m before 'Platteklip Gorge' |
| `table-mountain--devils-peak--devils-peak-contour-paths` | connector: a single 644 m bridge exceeds 500 m before '580m Traverse' |
| `table-mountain--devils-peak--devils-peak-east-ridge` | connectors: 482 m of 1849 m is over the 20% cap |
| `table-mountain--devils-peak--devils-peak-via-the-saddle` | no names in range: every trail named is over 5 km from the route's position |
| `table-mountain--devils-peak--saddle-ravine` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--front-face-north--fountain-ledges` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--front-face-north--kloof-corner` | relation 6334391 stitches into 2 disconnected parts, not one line |
| `table-mountain--front-face-north--ledges` | connector: a single 610 m bridge exceeds 500 m before 'Ledges' |
| `table-mountain--front-face-north--left-face-b` | connector: a single 608 m bridge exceeds 500 m before 'Tafelberg Road' |
| `table-mountain--front-face-north--right-face-arrow-face` | connector: a single 644 m bridge exceeds 500 m before 'Ledges' |
| `table-mountain--front-face-north--right-face-to-plattelklip` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--front-face-north--saddle-face` | connector: a single 711 m bridge exceeds 500 m before 'Left Face B' |
| `table-mountain--front-face-north--silverstream-ledges` | connector: a single 819 m bridge exceeds 500 m before 'Ledges' |
| `table-mountain--front-face-north--silverstream-ravine` | connector: a single 819 m bridge exceeds 500 m before 'Platteklip Gorge' |
| `table-mountain--front-face-north--springs` | connector: a single 711 m bridge exceeds 500 m before 'Left Face B' |
| `table-mountain--front-face-north--traverse-of-the-gods` | connector: a single 695 m bridge exceeds 500 m before 'Cairn Ravine' |
| `table-mountain--lions-head--lion-s-head-south-east-arete` | no names: the description names no mapped path |
| `table-mountain--lions-head--lions-head-360-route` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--lions-head--lions-head-b` | no names in range: every trail named is over 5 km from the route's position |
| `table-mountain--newlands-east--agathas-gully` | connector: a single 590 m bridge exceeds 500 m before 'Nursery Ravine' |
| `table-mountain--newlands-east--ascension-traverse` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--newlands-east--carrel-s-ledge` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--newlands-east--cecelia-ridge` | connector: a single 552 m bridge exceeds 500 m before 'Spilhaus Buttress' |
| `table-mountain--newlands-east--constantia-nek-bridle-path` | connector: a single 753 m bridge exceeds 500 m before 'Constantia Corner' |
| `table-mountain--newlands-east--els-buttress` | connector: a single 871 m bridge exceeds 500 m before 'Ledges' |
| `table-mountain--newlands-east--erica-buttress` | connector: a single 623 m bridge exceeds 500 m before 'Contour Path' |
| `table-mountain--newlands-east--finesteraar-crack` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--newlands-east--hidinng-ascenscion` | connector: a single 687 m bridge exceeds 500 m before 'Ferny Dell' |
| `table-mountain--newlands-east--newlands-forest` | no names: the description names no mapped path |
| `table-mountain--newlands-east--nursery-buttress` | anchor: no path within 250 m of the position |
| `table-mountain--newlands-east--reserve-cleft-and-junction-peaks` | connector: a single 668 m bridge exceeds 500 m before 'Echo Valley' |
| `table-mountain--newlands-east--skeleton-gorge` | connector: a single 590 m bridge exceeds 500 m before 'Spilhaus Buttress' |
| `table-mountain--newlands-east--spilhaus-buttress` | connector: a single 534 m bridge exceeds 500 m before 'Nursery Ravine' |
| `table-mountain--newlands-east--window-gorge` | no names: the description names no mapped path |
| `table-mountain--orange-kloof--3rd-ridge` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--orange-kloof--cavemans-overhang` | no names in range: every trail named is over 5 km from the route's position |
| `table-mountain--orange-kloof--dinganes-ridge` | anchor: no path within 250 m of the position |
| `table-mountain--orange-kloof--disa-gorge-slangolie` | cannot reach: 'Hoerikwaggo Trail' is not connected to the walk so far |
| `table-mountain--orange-kloof--frustration-buttress-1` | anchor: no path within 250 m of the position |
| `table-mountain--orange-kloof--hells-gates` | anchor: no path within 250 m of the position |
| `table-mountain--orange-kloof--intake-ravine` | no names: the description names no mapped path |
| `table-mountain--orange-kloof--lang-kloof` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--orange-kloof--myburghs-corner` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--orange-kloof--myburghs-waterfall-ravine` | anchor: no path within 250 m of the position |
| `table-mountain--orange-kloof--room-with-a-view` | area-approx position: an area centroid cannot anchor a line |
| `table-mountain--orange-kloof--wynberg-caves-ridge` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--winelands--du-toits-kloof-klein-drakenstein--bobbejaanskloof` | no names: the description names no mapped path |
| `cape-country--winelands--du-toits-kloof-klein-drakenstein--du-toits-peak` | anchor: no path within 250 m of the position |
| `cape-country--winelands--du-toits-kloof-klein-drakenstein--elandspad-at-du-toits` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--winelands--du-toits-kloof-klein-drakenstein--happy-valley` | no names: the description names no mapped path |
| `cape-country--winelands--du-toits-kloof-klein-drakenstein--krom-river-du-toits` | anchor: no path within 250 m of the position |
| `cape-country--winelands--du-toits-kloof-klein-drakenstein--rockhopper` | no names: the description names no mapped path |
| `cape-country--winelands--franschoek-wemmershoek--du-toits-kop` | no names: the description names no mapped path |
| `cape-country--winelands--franschoek-wemmershoek--perdekop` | no names: the description names no mapped path |
| `cape-country--winelands--franschoek-wemmershoek--wemmershoek-observation-point` | no names: the description names no mapped path |
| `cape-country--winelands--franschoek-wemmershoek--wemmershoek-peak` | no names: the description names no mapped path |
| `cape-country--winelands--hottents-holland--helderberg-dome` | connector: a single 1312 m bridge exceeds 500 m before 'Helderberg Dome' |
| `cape-country--winelands--hottents-holland--helderberg-west-peak` | connector: a single 601 m bridge exceeds 500 m before "Woodie's Walk" |
| `cape-country--winelands--jonkershoek--botmanskop-and-traverse` | connector: a single 551 m bridge exceeds 500 m before 'Saaltjie' |
| `cape-country--winelands--jonkershoek--diagonal-route-on-3rd-ridge` | anchor: no path within 250 m of the position |
| `cape-country--winelands--jonkershoek--klipspringer` | anchor: no path within 250 m of the position |
| `cape-country--winelands--jonkershoek--panorama-route` | anchor: no path within 250 m of the position |
| `cape-country--winelands--jonkershoek--sentralekloof` | connector: a single 1150 m bridge exceeds 500 m before 'Langrivierkloof' |
| `cape-country--winelands--jonkershoek--slab-route-1st-2nd-ridge` | anchor: no path within 250 m of the position |
| `cape-country--winelands--jonkershoek--swartboskam` | anchor: no path within 250 m of the position |
| `cape-country--winelands--jonkershoek--victoria-peak` | anchor: no path within 250 m of the position |
| `cape-country--winelands--langeberg--bloupunt` | anchor: no path within 250 m of the position |
| `cape-country--cape-karoo--anysberg-reserve-hikes` | anchor: no path within 250 m of the position |
| `cape-country--cape-karoo--elandsberg-stanley-s-light-trail` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cape-karoo--gamkaberg` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cederberg--dwarsrivier-lot-s-wife-trail` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cederberg--kromriver-farm-disa-pool-hike` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cederberg--kromriver-farm-rensie-s-tv-mast-hike` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cederberg--maltese-cross-hike` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cederberg--rooiberg-trail` | anchor: no path within 250 m of the position |
| `cape-country--cederberg--tafelberg-gully-route` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cederberg--truitjieskraal-trail` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--cederberg--wolfberg-cracks` | area-approx position: an area centroid cannot anchor a line |
| `cape-country--garden-route-little-karoo--donkey-trail-1` | no recorded position |
| `cape-country--garden-route-little-karoo--robberg-trail` | no names: the description names no mapped path |
| `cape-country--garden-route-little-karoo--swartberg` | no recorded position |
| `cape-country--groot-drakenstein--duiwelskloof` | anchor: no path within 250 m of the position |
| `cape-country--overberg--boskloof-ridge` | connector: a single 522 m bridge exceeds 500 m before 'Boskloof Ridge' |
| `cape-country--overberg--crystal-pools-at-steenbras` | connector: a single 950 m bridge exceeds 500 m before 'Boskloof Ridge' |
| `cape-country--overberg--hangklip` | anchor: no path within 250 m of the position |
| `cape-country--overberg--hermanus--fernkllof-at-hermanus` | no names: the description names no mapped path |
| `cape-country--overberg--klipspringer` | no recorded position |
| `cape-country--overberg--kogelberg-trail` | anchor: no path within 250 m of the position |
| `cape-country--overberg--sea-farm` | connector: a single 920 m bridge exceeds 500 m before 'Brodie Link' |
| `cape-country--overberg--steenbras-ridge` | anchor: no path within 250 m of the position |
| `cape-country--west-coast--groot-winterhoek` | no names: the description names no mapped path |
| `cape-country--west-coast--koeberg-dikkop-trail` | anchor: no path within 250 m of the position |
| `cape-country--west-coast--kooeberg-2` | anchor: no path within 250 m of the position |
| `cape-country--west-coast--postberg-flower-trail` | anchor: no path within 250 m of the position |
| `cape-country--west-coast--saldanha-nature-reserve` | no names: the description names no mapped path |
| `other-areas--mt-zebra-park-idwala-hiking-trail` | anchor: no path within 250 m of the position |
| `peninsula--cape-point` | anchor: no path within 250 m of the position |
| `peninsula--chapmans-peak-drive-noordhoek--blackburn-buttress` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--chapmans-peak-drive-noordhoek--blackburn-major` | connector: a single 943 m bridge exceeds 500 m before 'Blackburn Major' |
| `peninsula--chapmans-peak-drive-noordhoek--noordhoek-minor` | connector: a single 943 m bridge exceeds 500 m before 'Nordhoek Minor' |
| `peninsula--chapmans-peak-drive-noordhoek--noordhoek-peak-gully` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--chapmans-peak-drive-noordhoek--noordhoek-ridge-1` | no names: the description names no mapped path |
| `peninsula--hout-bay--disa-river-walk` | no names: the description names no mapped path |
| `peninsula--hout-bay--duiker-ridge` | anchor: no path within 250 m of the position |
| `peninsula--hout-bay--little-lion-s-head` | no names: the description names no mapped path |
| `peninsula--hout-bay--sentinel-se-ridge` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--hout-bay--skoorsteenkam2` | no names: the description names no mapped path |
| `peninsula--hout-bay--skoosteenkam` | connector: a single 989 m bridge exceeds 500 m before 'Hoerikwaggo Trail' |
| `peninsula--hout-bay--sunset-rocks-to-logie-rocks` | no names in range: every trail named is over 5 km from the route's position |
| `peninsula--hout-bay--twelve-apostles-path` | relation 6457140 stitches into 9 disconnected parts, not one line |
| `peninsula--silvermine--blockhuiskop` | anchor: no path within 250 m of the position |
| `peninsula--silvermine--circuit-of-the-ridges` | connectors: 888 m of 2405 m is over the 20% cap |
| `peninsula--silvermine--circuit-of-the-ridges-1` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--silvermine--constantiaberg-north-west-route` | connector: a single 975 m bridge exceeds 500 m before 'Blackburn Ravine' |
| `peninsula--silvermine--constantiaberg-west-ridge` | connector: a single 975 m bridge exceeds 500 m before 'Constantiaberg West Ridge' |
| `peninsula--silvermine--kalk-bay-kam` | connector: a single 703 m bridge exceeds 500 m before "Bailey's Kloof" |
| `peninsula--silvermine--kleintuinkop` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--silvermine--muizenberg-buttress` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--silvermine--st-james-buttress` | connectors: 545 m of 732 m is over the 20% cap |
| `peninsula--silvermine--steenberg-buttress` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--silvermine--vlakkenberg-3-rocky-peaks-ridge` | area-approx position: an area centroid cannot anchor a line |
| `peninsula--silvermine--wolfkop` | no names: the description names no mapped path |
| `peninsula--simonstown--elsies-pk-brakkloof-ridge` | no names: the description names no mapped path |
| `peninsula--simonstown--elsies-pk-circumnavigation-traverse` | no names in range: every trail named is over 5 km from the route's position |
| `peninsula--simonstown--north-peak` | connectors: 886 m of 1772 m is over the 20% cap |
| `peninsula--simonstown--outlook-ridge-1` | no names in range: every trail named is over 5 km from the route's position |
| `peninsula--simonstown--redhill-direct-from-the-sea` | anchor: no path within 250 m of the position |
| `peninsula--simonstown--simonsberg` | connectors: 1187 m of 3259 m is over the 20% cap |
| `peninsula--simonstown--slangkop-kommetjie` | no names in range: every trail named is over 5 km from the route's position |
| `peninsula--simonstown--swartkops-traverse` | anchor: no path within 250 m of the position |

## Relation candidates awaiting confirmation

These route titles overlap a relation name. **Each one is a question, not a
match** — add the true ones to `data/route-relations.json` by hand and rerun.

| route | title | relation | relation name |
|---|---|---|---|
| `table-mountain--newlands-east--skeleton-gorge` | Nursery Ravine and Skeleton Gorge | 7057849 | Nursery Ravine |
| `cape-country--winelands--jonkershoek--diagonal-route-on-3rd-ridge` | Diagonal Route on 3rd Ridge | 6198096 | Diagonal Route |
