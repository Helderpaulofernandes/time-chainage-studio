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

Then open http://localhost:8765. The Python server in `server/` also offers the same imports and exports as a REST API (http://localhost:8765/docs), kept for a future shared back end (SharePoint or Azure); the browser app does not need it.

## What it does (phase 1)

| Area | Status |
|---|---|
| New project dialog (rail / road / tunnel presets), project setup from the Project menu | done |
| Ranges: chainage (m or km, prefix, ticks, reverse, snap) and time (scale, up/down, week labels) | done |
| Activities: line, wide bar, block, milestone; drag to move, drag ends, draw new | done |
| Labels per style or per activity, with a template, following the slope of the line | done |
| Footprint polygons: length behind the work front and/or days occupied after it passes | done |
| Productivity: quantity and rate per activity, set finish from rate, productivity library | done |
| Location markers (typed, symbols, rows, ranges, grid lines) and section markers | done |
| Time markers: milestones, bands, stand-downs, possessions, restrictions (optionally limited in chainage) | done |
| Data sets: several options per project, compare one greyed behind another | done |
| Excel import (activity registers, assets, productivities, drawn sections, bands and milestones) | done |
| P6 XER import with field mapping (dates, start/end chainage, style, filter) and preview | done |
| P6 sync: re-read a newer XER with the saved mapping, change report, keeps local styling | done |
| P6 XER export (Start Chainage, End Chainage, Activity Style UDFs; 24 h 7-day calendar) | done |
| TurboChart .tchart import and export (all data sets, comparison chart) | done |
| Page layout (paper, margins, title, title block, chart, legend, notes), print, SVG/PNG export | done |
| Live P6 connection (EPPM web services, Primavera Cloud REST, P6 Pro database) | next phase |

## P6 field mapping

Data → Import from P6 (XER). Choose:

* **Dates**: early, planned, late, actual, or "actual, else early" for start and finish.
* **Start and end chainage**: a UDF, an activity code (value or description) or an activity field. Values can be numbers, `CH232.135`, or road-style `12+345`; say whether they are metres or kilometres.
* **Activity style**: a UDF, an activity code or the WBS. Each distinct value becomes a style you can colour; it is the same code TurboChart calls the shape code.
* **Filter**: keep only activities whose UDF / code / WBS value is in a list.

The mapping is saved with the data set. Data → Sync from P6 reads a newer XER with it, matches activities by Activity ID, and lists what changed before you apply it. UDF and activity-code ids are re-found by name, so a fresh export from another database still maps.

Exported XERs carry three UDFs (`Start Chainage (m)`, `End Chainage (m)`, `Activity Style`, or the labels from your mapping), so chainage you set here can go back into P6 with File → Import in P6 ("Update existing project").

## Project layout

```
web/                the app (plain ES modules, no build step); published to GitHub Pages
web/js/core/        model, P6 XER, TurboChart and Excel import/export, all in the browser
web/js/api.js       project storage (browser IndexedDB + optional linked file on your PC)
server/             optional Python REST API with the same imports/exports
.github/workflows/  publishes web/ to GitHub Pages on every push
```

Excel reading uses [SheetJS](https://sheetjs.com) and [JSZip](https://stuk.github.io/jszip/), loaded from cdnjs.
