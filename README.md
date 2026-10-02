# Time-Chainage Studio

A time–chainage display for Primavera P6 schedules, for rail, road and tunnel work. P6 stays the master: dates come from P6, and chainage and activity style come from fields you map. There is no scheduling logic here.

## Run it

Double-click `run.bat`, or from this folder:

```bash
python -m pip install -r requirements.txt
python -m uvicorn server.main:app --port 8765
```

Then open http://localhost:8765. The API reference is at http://localhost:8765/docs.

Projects are saved as JSON in `data/projects/` (or `~/.time-chainage-studio` if that folder is read-only). Set `TCS_DATA` to keep them somewhere else, e.g. a shared drive.

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
server/   FastAPI app: model, store, xer, tchart, excel_import
web/      browser front end (plain ES modules, no build step)
run.bat   start the server and open the browser
```
