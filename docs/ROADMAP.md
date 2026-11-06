# Improvement roadmap

What came out of a review of time–chainage diagrams prepared for real tenders and projects (rail track renewal, heavy-haul rail, new railway with tunnels, mine-site civil works, and a tunnel track install rate sheet), and where each feature now lives in the app.

The app stays a **display of the programme** from P6 or Microsoft Project: nothing here adds scheduling logic.

## Built

### Chart drawing

| # | Feature | Where to find it |
|---|---|---|
| – | Cut and fill styles: right-angle triangles, cut ◣ (falling left to right), fill ◢ (rising) | Style → Drawn as |
| – | Marks along lines: ticks, arrows (direction of work), V marks, crosses, dots, triangles | Style → Marks along the line |
| – | Area fills: solid, hatched, cross-hatched, dotted, outline only | Style → Area fill |
| – | Upright labels on tall, narrow blocks (bridges, culverts) | Automatic |
| 1 | Chainage scale at the top, bottom or both, and repeated part-way down a long chart; month column on the left, right or both | Project → Chart layout and axes |
| 2 | Period column: week numbers, months since a date (M1, M2…) or project years (Y1, Y2…), on either side | Project → Chart layout and axes |
| 3 | Broken chainage (empty stretches squeezed to a gap with a break symbol) and chainage equations (where the kilometrage jumps) | Project → Chart layout and axes |
| 4 | Tapered areas: the chainage range at the finish differs from the start | Style → Drawn as → Tapered area; the activity's "At the finish" fields |
| 5 | Crew steps: a crew's activities joined into one stepped line | View → Crew steps; activity Crew field (or by WBS or style) |
| 6 | Text notes at a chainage and date, any angle, optional box and leader line; drag to move | Insert → Text note |
| 7 | Milestone lines with the label boxed in the middle | Time marker → Milestone label |
| 8 | Side columns for design, approvals, procurement and other work with no chainage | Project → Chart layout and axes; activity Side column |
| 9 | Scale note ("Approx. A3: 10 mm = 500 m") | Title block Scale cell; `{scale}` in text blocks |
| 10 | Haul arrows between a cut and a fill area, labelled with the volume | Insert → Haul arrow |
| 11 | Logic links from P6, straight or square-cornered, all / driving path only / only between styles | View → Logic links; Project → Chart layout and axes |

### Bands above and below the chart (Project → Bands above and below the chart)

| # | Feature | Data |
|---|---|---|
| 12 | Long section with cut and fill shaded | chainage, ground level, design level |
| 13 | Quantities by section, bars and numbers | from, to, one column per quantity |
| 14 | Package / contract extents with lengths | name, from, to, colour |
| 15 | Schematic plan: track and structures from the location markers | none; tick the location types |
| 16 | Strip: ground type, terrain, zones | from, to, label, colour |

### Page layout

| # | Feature | Where to find it |
|---|---|---|
| 17 | Summary block: start and finish, activity count, length by style, quantities, totals from quantity bands | Page layout → Add summary |
| 20 | Calendar block: months with non-working days and stand-downs shaded | Page layout → Add calendar |
| 27 | Several charts on one sheet: each chart block can show its own stretch and option, with a caption, and leave out bands or side panels | Page layout → chart block settings |
| 9 | Charts on a page shrink their header rows and bands so the grid keeps at least half the height | Automatic |

### Resources (Data → Resource histogram)

| # | Feature | Notes |
|---|---|---|
| 18 | Weekly histogram beside the chart, stacked by series | From P6 resource assignments (budgeted units spread over each assignment's dates, by resource type or by resource) or pasted from Excel |
| 19 | Weekly and running totals column | Tick "Weekly and running totals" |

### Data in and out

| # | Feature | Where to find it |
|---|---|---|
| 21 | Microsoft Project XML import: tasks, dates, WBS, custom fields for chainage, style from words in the task name (or a field or summary level), crew and line fields, links with lag | File or Data → Import Microsoft Project (XML) |
| 22 | Logic links written to XER exports (TASKPRED) and read from an Excel register's Predecessors column ("A100, A110SS+2") | Automatic |
| 23 | Line / track per activity: hide a line, or offset it a few pixels | Activity Line / track field; Project → Chart layout and axes |
| 24 | Rate sheet to a sketch data set (finish worked out from length and rate), for comparison only | Data → Rate sheet to a sketch data set |
| 25 | Progress lines (as built or forecast), stepped or straight | Data → Progress lines |
| 28 | Fonts for non-Latin scripts (Thai, Chinese) in exports and video | Automatic font fallbacks |
| 29 | Pins on the header image (aerial photo or map strip), placed by chainage | Location → Pin on the header image |
| – | Saved views: a named stretch, date range and hidden styles; switch between them, or show one in a page chart block | View → Saved views |
| – | Style fill colour separate from the line colour, and styles hidden from the chart | Style → Fill colour, Show on the chart |
| – | TurboChart import opens on the file's active chart with its axis and timeline settings; every TurboChart chart becomes a saved view; fill colours and per-task labels come across, and go back out on export | File → Import TurboChart |

## Still to do

| # | Feature | Why it is not built yet |
|---|---|---|
| 26 | Live P6 connection (EPPM web services, Primavera Cloud, P6 Pro database) | Needs access to a P6 server to build and test against. A browser page cannot call a company P6 server directly (cross-site rules), so it goes through the optional Python server in `server/`. |
| – | Logic links in TurboChart files | TurboChart files do not store relationships (checked against a real project file), so there is nothing to read or write. |
| – | TurboChart annotations | They are stored as pictures placed by screen position, so they cannot be placed on our chart reliably. Add them again as text notes. |
| – | Native .mpp files | A closed binary format a browser cannot read reliably; use MS Project's XML export. |
