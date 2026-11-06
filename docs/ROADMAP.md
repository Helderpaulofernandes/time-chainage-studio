# Improvement roadmap

What the app still lacks, compared with time–chainage diagrams prepared for real tenders and projects (rail track renewal, heavy-haul rail, new railway with tunnels, mine-site civil works, and a tunnel track install rate sheet). Each item says what the diagrams do, what we would build, and roughly how big it is.

The app stays a **display of the P6 programme**: nothing here adds scheduling logic.

Size: **S** a day or less · **M** a few days · **L** a week or more.

## Done from this review

| Feature | Notes |
|---|---|
| Cut and fill styles | Right-angle triangles: cut ◣ (falling left to right), fill ◢ (rising). |
| Marks along lines | Ticks, arrows (direction of work), V marks, crosses, dots, triangles, at a set spacing. Shown in the legend too. |
| Area fills | Solid, hatched, cross-hatched, dotted or outline only, for blocks, cut and fill. |
| Upright labels | A label on a tall, narrow block (a bridge, a culvert) stands upright, inside the block if it fits. |
| Logic links from P6 | Relationships (FS, SS, FF, SF, with lag) are read from the XER and drawn as thin red arrows. View → Logic links. |

## Next: chart drawing

| # | Feature | What we would build | Size |
|---|---|---|---|
| 1 | Axes on any side | Chainage scale at the top, bottom or both; dates on the left, right or both; optionally repeated part-way down a long chart. | M |
| 2 | Week numbers and project periods | A date column showing week numbers (calendar or project weeks), months since award, or project years (Y1, Y2…), beside or instead of dates. | S |
| 3 | Broken chainage | Skip empty stretches between work areas, with a break symbol on the axis, so separate sites share one sheet. Also chainage equations (where the kilometrage jumps). | L |
| 4 | Tapered areas | An area whose chainage range changes over time (a trapezoid): start range at the start date, finish range at the finish date. Covers excavation fronts and bulk earthworks. | M |
| 5 | Stepped work fronts | Join a crew's activities into one stepped line (work, move, work), as crews do when they hop between sites. Taken from a P6 activity code or the WBS. | M |
| 6 | Text notes on the chart | Free text placed at a chainage and date, at any angle, with an optional leader line ("Corrections and clean-up", "Haul from Zone 1B"). | S |
| 7 | Milestone lines with boxed labels | Full-width lines with the label in a box at the centre, as used for Date of award, Site access and Practical completion. | S |
| 8 | Side columns for work with no chainage | Columns left and right of the chart for design, approvals, procurement and site-wide work, so it sits on the same time scale. | M |
| 9 | Scale note | "Approx. scale at A3: 10 mm = 200 m" worked out from the page and printed in the title block. | S |
| 10 | Haul arrows | Curved arrows between a cut and a fill area, labelled with the volume. | M |
| 11 | Links: elbow routing and filters | Square-cornered link lines, and showing only driving links or links into the visible activities. | S |

## Next: bands above and below the chart

| # | Feature | What we would build | Size |
|---|---|---|---|
| 12 | Long section | Ground and design levels along the chainage, with cut and fill shaded, read from a CSV of chainage and levels. | M |
| 13 | Quantities by section | A bar chart and table of quantities (topsoil, cut to fill, cut to spoil, borrow, capping) for each section, from a CSV or Excel sheet. | M |
| 14 | Package and contract extents | A strip of dimension arrows showing each package or contract zone, its chainage limits and its length. | S |
| 15 | Schematic plan | Track and structures drawn along the chainage (bridges, culverts, level crossings, turnouts, the site compound) as symbols with names. This extends location markers. | M |
| 16 | Terrain or ground-type strip | A coloured strip along the chainage (plain, mountain, cut area, fill area, tunnel). | S |
| 17 | Summary boxes | Totals (total cut, total fill, number of bridges) worked out from the data and placed on the page layout. | S |

## Next: resources and side panels

| # | Feature | What we would build | Size |
|---|---|---|---|
| 18 | Resource histograms on the time axis | Manpower, plant and water use by week, drawn alongside the chart rows and read from P6 resource assignments (TASKRSRC) or a CSV. | L |
| 19 | Weekly numbers column | A table beside the chart with weekly and cumulative hours, plant counts or cost against each week. | M |
| 20 | Calendar panel | The project calendar (work days, shutdowns) printed as a small month grid on the page. | S |

## Next: data in and out

| # | Feature | What we would build | Size |
|---|---|---|---|
| 21 | Microsoft Project import | Read MS Project XML (File → Save As → XML in MS Project): tasks, dates, WBS, custom fields for chainage and style, and links. Native .mpp files cannot be read in the browser. | M |
| 22 | Logic links out | Write links back out in XER and TurboChart exports, and read them from TurboChart and Excel. | S |
| 23 | Line or track attribute | A "line" field per activity (Up, Down, Main, Loop) to filter, colour or offset activities on multi-track jobs. | M |
| 24 | Rate sheets to activities | Read a rate sheet (section, start date, rate per day, crew) and draw it as a sketch data set for comparison only. It is never written back as programme logic. | M |
| 25 | Excel import of steps | Read daily cumulative progress (date, chainage) to draw an as-built or forecast front as a stepped line. | M |

## Later

| # | Feature | Size |
|---|---|---|
| 26 | Live P6 connection (EPPM web services, Primavera Cloud, P6 Pro database) | L |
| 27 | Several charts on one sheet (whole scope plus regional sheets from one project) | M |
| 28 | Fonts for non-Latin scripts in exported PDF, PNG and video (for example Thai titles) | S |
| 29 | Aerial or map strip with pins placed by chainage, not only a fixed image | M |
