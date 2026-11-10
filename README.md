# Time-Chainage Studio

A time–chainage display for Primavera P6 schedules, for rail, road and tunnel work. P6 stays the master: dates come from P6, and chainage and activity style come from fields you map. There is no scheduling logic here.

## Use it

**Open https://helderpaulofernandes.github.io/time-chainage-studio/** in Edge or Chrome. Nothing to install; everything runs in your browser and your files never leave your PC.

**Where your work is kept**

* Every project is kept in your browser on that PC as you work.
* When you create or import a project, the app offers to **save it to a file on your PC** (for example in OneDrive). From then on every change is written to that file automatically. Open the file again later with **File → Open project file from my PC**, or send it to someone.
* If the browser asks again for permission to write to the file (after you close it), click **Keep saving to …** in the status bar.
* Firefox and Safari cannot write straight to a file; use **File → Download a copy (.json)** there.

## Run it locally (optional)

The same app can be served from your PC, for example with no internet access. Double-click `run.bat`, or from this folder:

```bash
python -m pip install -r requirements.txt
python -m uvicorn server.main:app --port 8765
```

Then open http://localhost:8765. The browser app does everything itself and does not need the server.

The server's own REST API (http://localhost:8765/docs) is **older than the app**: it reads and writes XER, TurboChart and Excel as the app did in its first phase, and has none of the later features (logic links, saved views, fill colours, MS Project, bands, resources). It is kept as the starting point for the live P6 connection and a shared back end; do not use its exports for current projects.

## What it does (phase 1)

| Area | Status |
|---|---|
| New project dialog (rail / road / tunnel presets), project setup from the Project menu | done |
| Ranges: chainage (m or km, prefix, ticks, reverse, snap) and time (scale, up/down, week labels) | done |
| Activities: line, wide bar, block, cut (right-angle triangle ◣), fill (right-angle triangle ◢), milestone; drag to move, drag ends, draw new | done |
| Labels per style or per activity, with a template, following the slope of the line | done |
| Line marks (ticks, arrows, V marks, crosses, dots, triangles), area fills (hatched, cross-hatched, dotted, outline), upright labels on narrow blocks | done |
| Logic links read from the P6 XER and drawn as arrows between activities (View → Logic links) | done |
| Footprint polygons: length behind the work front and/or days occupied after it passes | done |
| Productivity: quantity and rate per activity, set finish from rate, productivity library | done |
| Location markers (typed, symbols, rows, ranges, grid lines) and section markers | done |
| Time markers: milestones, bands, stand-downs, possessions, restrictions (optionally limited in chainage) | done |
| Data sets: several options per project, compare one greyed behind another | done |
| Excel import (activity registers, assets, productivities, drawn sections, bands and milestones) | done |
| P6 XER import with field mapping (dates, start/end chainage, style, filter) and preview | done |
| P6 sync: re-read a newer XER with the saved mapping, change report, keeps local styling | done |
| P6 XER export (Start Chainage, End Chainage, Activity Style UDFs; 24 h 7-day calendar) | done |
| TurboChart .tchart import and export: opens on the active chart, every chart as a saved view, fill colours, axis and timeline settings | done |
| Saved views (stretch, dates, hidden styles), style fill colours | done |
| Page layout (paper, margins, title, title block, chart, legend, notes), print, SVG/PNG export | done |
| Playback: View → Play the programme runs a date line down the chart; work fronts and crew positions move, done work fills in, future work stays faint | done |
| Playback export: an MP4 video (720p, 1080p or 4K, any length) or a PNG of any moment, made in the browser | done |
| Corridor view: during playback, crews move along lanes by chainage above the chart, the track line fills in by stage, crews pause on stand-downs (optional), and video export can include it | done |
| Branding: a library of company brands (logo, name, colours) kept in the browser; each project keeps a copy, used in the app bar, page title block, logo image blocks, video title strip and a logo / project-name intro and outro with fades | done |
| Video intro / outro settings (on/off, length, background, title, subtitle, closing line) and music (any audio file, volume, fades, start point, loops to length; AAC in the MP4) | done |
| Chart layout: axes top / bottom / both, repeated scale, month and period columns (weeks, M1…, Y1…), broken chainage, chainage equations, side columns for work with no chainage, lines / tracks, crew steps, link routing | done |
| Tapered areas, text notes, haul arrows, boxed milestone labels, progress (as-built) lines, pins on the header image | done |
| Bands above and below the chart: long section with cut / fill, quantities by section, package extents, schematic plan, strips | done |
| Resource histogram beside the chart (from P6 assignments or pasted), with weekly and running totals | done |
| Page layout: summary and calendar blocks, several charts per sheet (each with its own stretch and option), scale note | done |
| Microsoft Project XML import (custom fields, styles from task names, links); rate sheet to a sketch data set; links in XER export and Excel import | done |
| Feature list and what is left: [docs/ROADMAP.md](docs/ROADMAP.md) | |
| Live P6 connection (EPPM web services, Primavera Cloud REST, P6 Pro database) | next phase |

## Units (metric and US)

Project → Project setup → **Chainage / stationing** has presets:

| Preset | Shown as | Dates | Week starts |
|---|---|---|---|
| Metric | CH 232.135 km (or stations 12+345 m) | 5 Apr 27 | Monday |
| US | STA 12+34.56 (100 ft stations) | Apr 5, 27 | Sunday |
| US rail | MP 12.40 mi | Apr 5, 27 | Sunday |

Positions are always stored in metres, so a project can switch units at any time. On station projects you can type a station (`12+34.56`) or a plain number of feet. Quantities and rates follow the project: m and m/day on metric projects, ft and ft/day on US ones. P6 chainage fields can be in m, km, ft or mi; station text in P6 is read too.

## P6 field mapping

Data → Import from P6 (XER). Choose:

* **Dates**: early, planned, late, actual, or "actual, else early" for start and finish.
* **Start and end chainage**: a UDF, an activity code (value or description) or an activity field. Values can be numbers, `CH232.135`, or road-style `12+345`; say whether they are metres or kilometres.
* **Activity style**: a UDF, an activity code or the WBS. Each distinct value becomes a style you can colour; it is the same code TurboChart calls the shape code.
* **Filter**: keep only activities whose UDF / code / WBS value is in a list.

The mapping is saved with the data set. Data → Sync from P6 reads a newer XER with it, matches activities by Activity ID, and lists what changed before you apply it. UDF and activity-code ids are re-found by name, so a fresh export from another database still maps.

Exported XERs carry three UDFs (`Start Chainage (m)`, `End Chainage (m)`, `Activity Style`, or the labels from your mapping), so chainage you set here can go back into P6 with File → Import in P6 ("Update existing project").

## Checks

`node --test tests/core.test.mjs` runs the automated checks (XER, TurboChart and MS Project round trips, chart geometry with broken chainage, chainage equations, P6 sync, and that a crafted project file cannot inject script). They also run on every push, and a failure stops the site from being published.

## Project layout

```
web/                the app (plain ES modules, no build step); published to GitHub Pages
web/js/core/        model, P6 XER, TurboChart, MS Project and Excel import/export, all in the browser
tests/              automated checks (Node, no browser needed)
web/js/api.js       project storage (browser IndexedDB + optional linked file on your PC)
server/             optional local server for the app, plus an older REST API (see above)
.github/workflows/  publishes web/ to GitHub Pages on every push
```

Excel reading uses [SheetJS](https://sheetjs.com) and [JSZip](https://stuk.github.io/jszip/), loaded from cdnjs. Video export uses the browser's WebCodecs encoder and [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), loaded from jsDelivr only when you export.
