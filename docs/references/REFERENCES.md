# Destructovibe reference library

Purpose: real-world references for the per-piece critic loops. Every id below has (1) reference media with the camera angle, (2) sourced benchmarks, (3) "tells" a harsh critic should check.

## How to read this file

"local:" paths are relative to the local reference-photo cache (not committed; re-fetch the Commons URLs to rebuild it).


- Benchmark tags: **[S]** = read on a page I fetched (URL given). **[Q]** = appeared only in a web-search result summary; the URL is a result of that search and the number has not been confirmed on the page itself, so re-check before locking a tolerance. **[D]** = derived here by arithmetic from cited numbers (g = 9.81 m/s^2 where free fall is used).
- Media: Wikimedia Commons File: pages (licence shown; geograph/Commons licences allow reuse with attribution), HAER/HABS/NIST public domain items, plus YouTube URLs that surfaced in searches (video refs only). Angles are taken from the file title/description and have not been checked visually unless said otherwise.
- **No files were downloaded.** The task's local-copy step was not done (see the report); URLs are the deliverable. Commons `File:` pages carry the licence and direct original.
- "Tells" are critic heuristics (judgement), not sourced facts, except where a number is cited.
- Project context read: `src/buildings/*/SPEC.md` (station, cathedral, deptstore, highrise, millworks, road-bridge, gasholder, stadium; all are migrated legacy bodies with no datums), `src/levels/structures.ts` (cottageRow, timberFrameHouse, apartmentBlock, officeBlock, carPark, warehouse, timberBarn, chapel, towerBlock, skyscraper, industrialChimney, mill, trussBridge, stadiumStand), `README.md` (25 materials, Voronoi fracture, rebar, heat, Railway Quarter with a 60 m mill chimney).

## Quick digest for headless-sim checks (all derived from items below)

| Quantity | Real value | Source item |
|---|---|---|
| Free-fall time from 89 m (Red Road point block) | 4.26 s [D] vs reported "about four seconds" to fall [S] | collapse/rc-tower-implosion |
| Free-fall time from 439 ft (133.8 m) | 5.22 s [D]; reported implosion time 14 s (one source) or 30 s (another) [Q] | collapse/steel-highrise-implosion |
| Debris pile height / building height, Hudson's | 35/439 = 8 % average, 60/439 = 13.7 % maximum [D] | collapse/steel-highrise-implosion |
| WTC 7 north-face descent vs free fall for same drop | 5.4 s vs 3.9 s = 1.38x [D from S] | collapse/progressive-column-loss |
| 571 ft brick chimney felling | under 8 s from blast to ground [S] | collapse/chimney-felling |
| RC chimney sit-down before topple | 8.3 m over ~2.5 s, notch closed at 4.5 s [S] | collapse/chimney-felling |
| Truss bridge dropped by charges | charges fire within 0.5 s, on the ground ~0.5 s later [Q] | collapse/bridge-span |
| Steel yield retained | ~60 % at 550 C, ~40 % at 600 C [S] | material/steel |
| Timber char rate (softwood) | 0.65 mm/min [Q] | material/timber |
| Dust at ground level after implosion | back to background in 15-20 min at 100-1130 m downwind [Q] | material/dust |

---

# A. Landmarks

## landmark/station — Victorian railway terminus, wrought-iron arched train shed

Reference media
- [Barlow train shed, St Pancras railway station - DSC08182.JPG](https://commons.wikimedia.org/wiki/File:Barlow_train_shed,_St_Pancras_railway_station_-_DSC08182.JPG) - CC BY-SA 3.0, 3648x2736. Angle/shows: interior, looking along the shed with ribs receding. — local: `refs/landmark-station/01.jpg`
- [London – St Pancras Station, looking N in the train shed.jpg](https://commons.wikimedia.org/wiki/File:London_%E2%80%93_St_Pancras_Station,_looking_N_in_the_train_shed.jpg) - CC BY 2.0, 3883x2912. Angle/shows: platform level looking north along the shed (per title). — local: `refs/landmark-station/02.jpg`
- [St Pancras train shed roof.png](https://commons.wikimedia.org/wiki/File:St_Pancras_train_shed_roof.png) - Public domain, 1928x652. Angle/shows: structural drawing of the shed roof (orthographic cross-section, public domain). — local: `refs/landmark-station/03.png`
- [Reflections at St Pancras Railway Station.jpg](https://commons.wikimedia.org/wiki/File:Reflections_at_St_Pancras_Railway_Station.jpg) - CC BY-SA 4.0, 2712x3320. Angle/shows: looking up at the wrought-iron shed from below. — local: `refs/landmark-station/04.jpg`
- [Bristol Temple Meads 80.jpg](https://commons.wikimedia.org/wiki/File:Bristol_Temple_Meads_80.jpg) - CC BY-SA 2.0, 4272x2848. Angle/shows: close detail of girders and decorative castings in the Paddington train-shed roof (file title says Bristol, description says Paddington). — local: `refs/landmark-station/05.jpg`
- [Restored train shed St Pancras - geograph.org.uk - 608313.jpg](https://commons.wikimedia.org/wiki/File:Restored_train_shed_St_Pancras_-_geograph.org.uk_-_608313.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: general shed view. — local: `refs/landmark-station/06.jpg`
- [File:St Pancras railway station trainshed 2014-09-14.jpg](https://commons.wikimedia.org/wiki/File:St_Pancras_railway_station_trainshed_2014-09-14.jpg) - 12,430 x 8,322 panorama listed in the category (name from the category listing, not API-verified). Category: https://commons.wikimedia.org/wiki/Category:St_Pancras_railway_station_trainshed — local: `refs/landmark-station/07.jpg`

Game camera to match: (1) platform-level looking along the shed so the ribs recede (Barlow shed interior views); (2) low oblique under a rib springing to read lattice depth; (3) end gable/screen from the concourse.

Benchmarks
- St Pancras (Barlow, opened 1868): shed 689 ft (210 m) long, 240 ft (73.2 m) wide, 100 ft (30.5 m) high at apex above the tracks; 245 ft 6 in (74.83 m) wall to wall. **[S]** https://en.wikipedia.org/wiki/St_Pancras_railway_station
- 24 wrought-iron lattice ribs at 29 ft 4 in (8.94 m) centres; each rib 6 ft (1.8 m) deep. **[S]** same URL
- Platform level sits 20 ft (6 m) above street on an undercroft; undercroft columns quoted as 15 ft wide and 48 ft deep in the page summary. **[S]** same URL
- Rise-to-span ratio of the arch 100/240 = 0.42 [D]; rib spacing to span 8.94/73.2 = 0.12 [D].
- Paddington (Brunel/Wyatt, 1854): three parallel arched spans quoted as 31, 21 and 21 m, wrought-iron ribs, glazed. **[Q]** https://buildingguessr.com/articles/train-station-architecture.html
- Roof supported on iron columns at ground level; quoted as 690 columns for St Pancras. **[Q]** https://www.railway-technology.com/projects/stpancrasinternation/

Tells a harsh critic should check
1. Ribs must read as lattice (open web) 1.8 m deep, not solid arched beams; spacing ~9 m along a 210 m shed means ~24 ribs, so a shed with a dozen or fifty ribs is wrong.
2. Rise/span ~0.4: a shallow segmental roof or a Gothic pointed profile is wrong.
3. Glazing plane: pane-scale glazing bars and a light, high-key interior; a dark opaque roof with a few windows reads as a warehouse.
4. Collapse: wrought iron is ductile, so ribs should bend and buckle (long sag, twisted lattice) before they snap; cast columns snap clean. Glass sheets should fall as annealed shards, not as cubes.

## landmark/church — Gothic church with spire

Reference media
- [Exterior and spire of St James Church in Louth.jpg](https://commons.wikimedia.org/wiki/File:Exterior_and_spire_of_St_James_Church_in_Louth.jpg) - CC BY-SA 4.0, 3024x4032. Angle/shows: exterior three-quarter view of tower and spire. — local: `refs/landmark-church/01.jpg`
- [Spire of St James Church in Louth.jpg](https://commons.wikimedia.org/wiki/File:Spire_of_St_James_Church_in_Louth.jpg) - CC BY-SA 4.0, 3024x4032. Angle/shows: looking straight up the spire (worm's-eye). — local: `refs/landmark-church/02.jpg`
- [St James' church, tower and spire - geograph.org.uk - 2999043.jpg](https://commons.wikimedia.org/wiki/File:St_James%27_church,_tower_and_spire_-_geograph.org.uk_-_2999043.jpg) - CC BY-SA 2.0, 768x1024. Angle/shows: full tower and spire, portrait. — local: `refs/landmark-church/03.jpg`
- [Spire of St Mary the Virgin (Hunslet Parish Church).jpg](https://commons.wikimedia.org/wiki/File:Spire_of_St_Mary_the_Virgin_(Hunslet_Parish_Church).jpg) - CC BY-SA 3.0, 2736x3648. Angle/shows: tower and broach spire, contrasting form. — local: `refs/landmark-church/05.jpg`
- [Church, Steeple Claydon - geograph.org.uk - 59206.jpg](https://commons.wikimedia.org/wiki/File:Church,_Steeple_Claydon_-_geograph.org.uk_-_59206.jpg) - CC BY-SA 2.0, 480x640. Angle/shows: Decorated Gothic west tower and spire. — local: `refs/landmark-church/04.jpg`
- [Chichester Cathedral Spire Collapse 1861.jpg](https://commons.wikimedia.org/wiki/File:Chichester_Cathedral_Spire_Collapse_1861.jpg) - Public domain, 1070x1637. Angle/shows: aftermath of the 1861 spire collapse (public domain). — local: `refs/collapse-church-tower/01.jpg`
- Category: https://commons.wikimedia.org/wiki/Category:Church_spires

Game camera to match: (1) three-quarter exterior from ~1 tower-height away, full tower + spire; (2) worm's-eye looking up the spire to read taper and pinnacles; (3) west tower elevation.

Benchmarks
- St James, Louth: tower proper 196 ft 9 in including four corner pinnacles (each 43 ft 6 in); spire stonework tops at 287 ft 6 in; cockerel weathervane at 293 ft 1 in; nave 182 ft long. **[S]** https://en.wikipedia.org/wiki/St_James%27_Church,_Louth
- Spire stonework max 20 in thick; spire weight 200 tons vs 290 tons for the four corner pinnacles. **[S]** same URL
- Spire above tower proper = 287.5 - 196.75 = ~90.8 ft, i.e. 0.46 of tower height; total/tower = 1.46 [D]. (The article does not say whether the 196'9" includes the pinnacles' height above the parapet; treat the ratio as approximate.)
- Salisbury: spire 404 ft (123 m), tower + spire added 6,397 long tons (6,500 t), cathedral 442 ft long. **[S]** https://en.wikipedia.org/wiki/Salisbury_Cathedral
- Chichester: original spire 277 ft (84 m); collapsed 21 Feb 1861 by "telescoping in on itself"; causes given: subsidence, rubble cores of supports decayed, high winds. **[S]** https://en.wikipedia.org/wiki/Chichester_Cathedral
- Decorated spires are slender needle spires set in from the tower edge with corner pinnacles; the broach spire is the transition to an octagon on a square base. **[Q]** https://www.britannica.com/technology/spire

Tells
1. Spire is a thin masonry shell (tens of centimetres thick at most, 20 in max in Louth) that tapers strongly; a solid-looking stubby cone is wrong.
2. Pinnacles are heavy (290 t total at Louth): critic should see them fall as discrete masses, not vanish.
3. Tall slender stone spires fail by the shell splitting and telescoping down into the tower (Chichester), not by toppling like a felled tree.
4. Buttresses, string courses and window tracery break along joints into ashlar blocks, not into brick-sized units or a uniform grey rubble.
5. Roof pitch: **not sourced** (see gaps).

## landmark/deptstore — 1930s Art Deco department store

Reference media
- [Peter Jones, Sloane Square - geograph.org.uk - 2581038.jpg](https://commons.wikimedia.org/wiki/File:Peter_Jones,_Sloane_Square_-_geograph.org.uk_-_2581038.jpg) - CC BY-SA 2.0, 4320x3240. Angle/shows: street-level facade, high resolution. — local: `refs/landmark-deptstore/01.jpg`
- [Peter Jones on Sloane Square - geograph.org.uk - 5811850.jpg](https://commons.wikimedia.org/wiki/File:Peter_Jones_on_Sloane_Square_-_geograph.org.uk_-_5811850.jpg) - CC BY-SA 2.0, 1490x2014. Angle/shows: portrait view of the curtain-wall corner. — local: `refs/landmark-deptstore/02.jpg`
- [Peter Jones Sloane Square - geograph.org.uk - 1569029.jpg](https://commons.wikimedia.org/wiki/File:Peter_Jones_Sloane_Square_-_geograph.org.uk_-_1569029.jpg) - CC BY-SA 2.0, 480x640. Angle/shows: 1930s facade, Grade II*. — local: `refs/landmark-deptstore/03.jpg`
- [Derry & Toms 01.JPG](https://commons.wikimedia.org/wiki/File:Derry_%26_Toms_01.JPG) - CC BY-SA 3.0, 2592x1944. Angle/shows: 99-121 Kensington High Street elevation. — local: `refs/landmark-deptstore/04.jpg`
- [Preston Industrial Co-operative Society Store, Lancaster Road, Preston (56590118).jpg](https://commons.wikimedia.org/wiki/File:Preston_Industrial_Co-operative_Society_Store,_Lancaster_Road,_Preston_(56590118).jpg) - CC BY 2.0, 1600x1200. Angle/shows: Art Deco department store, street view. — local: `refs/landmark-deptstore/06.jpg`
- [Long Eaton Co-operative Society - geograph.org.uk - 1366978.jpg](https://commons.wikimedia.org/wiki/File:Long_Eaton_Co-operative_Society_-_geograph.org.uk_-_1366978.jpg) - CC BY-SA 2.0, 640x479. Angle/shows: Art Deco carved emblem detail. — local: `refs/landmark-deptstore/05.jpg`

Game camera to match: street-level three-quarter of the corner elevation; a straight-on elevation to count bays and mullions.

Benchmarks
- Peter Jones, Sloane Square (1936-39): seven storeys; concrete, glass and metal; storeys 1-4 with narrowly spaced mullions filled with glass and white panelling; 5th storey recessed with cantilevered canopy; bronze balustrade above. **[Q]** https://historicengland.org.uk/listing/the-list/list-entry/1226626 (page returned 403 to my fetch; text from search summary)
- Derry & Toms, Kensington (1933): steel-framed, seven storeys. **[Q]** https://britishlistedbuildings.co.uk/101222781-marks-and-spencers-british-home-stores-and-the-roof-garden-queens-gate-ward
- Beales, Eastbourne (1927): bays between faience pilasters; Cammacks, Boston: 1930s Art Deco with steel frame and red-brick cladding. **[Q]** https://buildingourpast.com/2025/05/05/looking-back-at-beales-and-bealesons/ and https://heritage-explorer.lincolnshire.gov.uk/Monument/MLI98424
- Steel-frame department stores in England date from Selfridges (1909); faience favoured for inter-war chain stores. **[Q]** https://www.buildingconservation.com/articles/shopfronts/shopfronts.htm

Tells
1. Facade is a frame with cladding: repeat bay module, big glazed openings, thin piers; a solid masonry wall with punched windows is the wrong building type.
2. When the frame is cut, faience/stone cladding should peel off as thin tiles and panels and hang from steel, not break into brick-scale units.
3. Retail floors are open plan on a column grid: collapse should be column-driven with floors pancaking, not wall-driven.
4. Floor-to-floor height for retail floors: **not sourced** (gap).

## landmark/tower — 34-storey residential tower

Reference media
- [Trellick Tower 02.JPG](https://commons.wikimedia.org/wiki/File:Trellick_Tower_02.JPG) - CC BY-SA 3.0, 3456x4608. Angle/shows: full-height portrait view. — local: `refs/landmark-tower/01.jpg`
- [Glasgow. Balornock. Red Road Flats,153–213 Petershill Drive (view from west, before demolition).jpg](https://commons.wikimedia.org/wiki/File:Glasgow._Balornock._Red_Road_Flats,153%E2%80%93213_Petershill_Drive_(view_from_west,_before_demolition).jpg) - CC BY-SA 4.0, 4000x3000. Angle/shows: view from west before demolition (point block). — local: `refs/landmark-tower/04.jpg`
- [RedRoadFlats.jpg](https://commons.wikimedia.org/wiki/File:RedRoadFlats.jpg) - Public domain, 3648x2736. Angle/shows: Red Road flats, public domain. — local: `refs/landmark-tower/02.jpg`
- [Red Road flats, Glasgow - geograph.org.uk - 7912032.jpg](https://commons.wikimedia.org/wiki/File:Red_Road_flats,_Glasgow_-_geograph.org.uk_-_7912032.jpg) - CC BY-SA 2.0, 1600x800. Angle/shows: wide 2:1 view of several blocks. — local: `refs/landmark-tower/03.jpg`
- [Ronan Point collapse closeup.jpg](https://commons.wikimedia.org/wiki/File:Ronan_Point_collapse_closeup.jpg) - CC BY-SA 2.0, 538x800. Angle/shows: the collapsed corner, after the 1968 explosion. — local: `refs/collapse-progressive-column-loss/01.jpg`
- [Tower block collapse. Canning Town (geograph 2540469).jpg](https://commons.wikimedia.org/wiki/File:Tower_block_collapse._Canning_Town_(geograph_2540469).jpg) - CC BY-SA 2.0, 566x800. Angle/shows: Ronan Point collapse, portrait. — local: `refs/collapse-progressive-column-loss/05.jpg`

Game camera to match: ground-level full-height with the 2-3 nearest blocks for scale (Red Road views), plus close facade view to count storeys.

Benchmarks
- Red Road, Glasgow: six point blocks of 31 storeys (89 m), two slab blocks of 28 storeys (79 m); built as steel frame with asbestos fireproofing, not precast panel. **[S]** https://en.wikipedia.org/wiki/Red_Road_Flats
- Storey pitch Red Road: 89/31 = 2.87 m per storey [D]. Extrapolated to 34 storeys: ~98 m [D, extrapolation not a measurement].
- Ronan Point: 22 storeys, 64 m, large-panel precast (Larsen & Nielsen system), completed 11 March 1968. **[Q]** https://en.wikipedia.org/wiki/Ronan_Point (height from the search summary; the fetched page confirmed 22 storeys and the panel system)
- Ronan Point storey pitch 64/22 = 2.9 m [D].
- Ocean Tower (RC condo): 31 storeys, 115.51 m; 3.73 m per storey [D]; 401 auger-cast piles, three reinforced core walls. **[S]** https://en.wikipedia.org/wiki/Ocean_Tower

Tells
1. Storey pitch ~2.9 m for council housing; if the tower is 34 storeys, expect ~98 m, and a render that is 200 m tall or 40 m tall is the fail.
2. Slenderness: point blocks are compact plans; critic should compare footprint vs 98 m height.
3. Balconies/access decks and window rhythm repeat every storey with no variation; a lone big glazed lobby only at ground.
4. Large-panel systems fail at joints (panels stay whole); frame towers fail at columns. Check which one the game claims.

## landmark/bridge — riveted truss road bridge

Reference media
- [FROM CENTER OF BRIDGE, INSIDE SOUTHERNMOST TRUSS - Second Avenue Bridge, Spanning Oostanaula on State Route...](https://commons.wikimedia.org/wiki/File:FROM_CENTER_OF_BRIDGE,_INSIDE_SOUTHERNMOST_TRUSS_-_Second_Avenue_Bridge,_Spanning_Oostanaula_on_State_Route_101_(Second_Avenue),_Rome,_Floyd_County,_GA_HAER_GA,58-ROM,2-6.tif) - Public domain, 5009x3995. Angle/shows: HAER: from the centre of the bridge inside the southernmost truss (portal-style interior view). — local: `refs/landmark-bridge/03.jpg`
- [SOUTHWEST ELEVATION OF NORTH TRUSS SPAN. LOOKING NORTHEAST. - Flintville Bridge, Spanning Broad Creek at Fl...](https://commons.wikimedia.org/wiki/File:SOUTHWEST_ELEVATION_OF_NORTH_TRUSS_SPAN._LOOKING_NORTHEAST._-_Flintville_Bridge,_Spanning_Broad_Creek_at_Flintville_Road_(Maryland_Route_623),_Castleton,_Harford_County,_MD_HAER_MD,13-CAST.V,1-8.tif) - Public domain, 5000x4095. Angle/shows: HAER: elevation of the north truss span. — local: `refs/landmark-bridge/04.jpg`
- [Warren (riveted) pony truss bridge, Mt. Vernon Bridge Co, Mt. Vernon, Ohio, 1909 - National Road Museum - D...](https://commons.wikimedia.org/wiki/File:Warren_(riveted)_pony_truss_bridge,_Mt._Vernon_Bridge_Co,_Mt._Vernon,_Ohio,_1909_-_National_Road_Museum_-_DSC02772.JPG) - CC0, 5472x3648. Angle/shows: riveted Warren pony truss, side view (CC0). — local: `refs/landmark-bridge/05.jpg`
- [DETAIL VIEW OF RIVETED INTERSECTION OF TRUSS MEMBERS - Siuslaw River Bridge, Spanning Siuslaw River, Richar...](https://commons.wikimedia.org/wiki/File:DETAIL_VIEW_OF_RIVETED_INTERSECTION_OF_TRUSS_MEMBERS_-_Siuslaw_River_Bridge,_Spanning_Siuslaw_River,_Richardson_Road,_County_Road_5018,_Walton,_Lane_County,_OR_HAER_ORE,20-WALT.V,1-9.tif) - Public domain, 5000x3916. Angle/shows: HAER: riveted joint close-up. — local: `refs/landmark-bridge/01.jpg`
- [Detail view of riveted steel gusset plate connection - Dry Creek Bridge, Spanning Dry Creek on Harris Road ...](https://commons.wikimedia.org/wiki/File:Detail_view_of_riveted_steel_gusset_plate_connection_-_Dry_Creek_Bridge,_Spanning_Dry_Creek_on_Harris_Road_(County_Road_697),_Umapine,_Umatilla_County,_OR_HAER_OR-130-3.tif) - Public domain, 5620x4552. Angle/shows: HAER: gusset plate rivet rows. — local: `refs/landmark-bridge/06.jpg`
- [VIEW OF THE FLOOR SYSTEM WOOD BEAM ATRINGERS AND RIVETED GIRDER FLOOR BEAMS - North Fork Bridge, Spanning N...](https://commons.wikimedia.org/wiki/File:VIEW_OF_THE_FLOOR_SYSTEM_WOOD_BEAM_ATRINGERS_AND_RIVETED_GIRDER_FLOOR_BEAMS_-_North_Fork_Bridge,_Spanning_North_Fork_of_Licking_River,_Milford,_Bracken_County,_KY_HAER_KY,12-MILF.V,1-14.tif) - Public domain, 4900x3912. Angle/shows: HAER: floor system, riveted girder floor beams. — local: `refs/landmark-bridge/02.jpg`
- Categories: https://commons.wikimedia.org/wiki/Category:Pratt_truss_bridges ; https://commons.wikimedia.org/wiki/Category:Truss_bridges
Note: Commons search returned mostly US HAER records (public domain, detailed rivet/gusset close-ups). UK riveted truss road-bridge photos were not found in the API search (gap).

Game camera to match: side elevation from the bank at deck height (panel rhythm and depth); portal view from the roadway looking along the through-truss; gusset close-up for rivet rows.

Benchmarks
- Pratt truss practical for spans up to 250 ft (76 m) in the truss-bridge article; standard for spans up to 200 ft in the Pratt article; Waddell used riveted Pratts to 200 ft. **[S]** https://en.wikipedia.org/wiki/Truss_bridge ; https://www.structuremag.org/article/the-pratt-truss/
- An even number of panels was recommended for riveted trusses (symmetrical joint details, no double diagonals in a centre panel); odd number for pin-connected. **[S]** https://www.structuremag.org/article/the-pratt-truss/
- Depth should be no less than 1/20 of span and, except in extreme cases, not less than 1/25 (stated for a pedestrian truss article; span:depth ratios of 10:1 to 25:1 quoted); economical panel length 25-35 ft for spans over 125 ft. **[Q]** https://www.conteches.com/knowledge-center/archived-pdh-articles/design-considerations-for-pedestrian-truss-bridge-structures/ (search result also listed https://www.roads.maryland.gov/OPPEN/V-Pratt.pdf; the PDF would not parse)
- Pratt truss patented 4 April 1844 (T.W. Pratt). **[S]** https://www.structuremag.org/article/the-pratt-truss/
- Steel truss demolition reference: Kosciuszko Bridge, 22-span, 22 million lb of steel (see collapse/bridge-span).

Tells
1. Members are built-up from angles/plates with visible lacing bars and riveted gusset plates, not solid rectangular bars.
2. Depth/span ~1/6 to 1/10 for a short through truss; a very shallow truss looks like a girder, a very deep one looks like a gantry.
3. Diagonal direction pattern (Pratt: diagonals slope toward the centre in tension) is symmetrical about the midspan.
4. Failure: gusset/connection failure or a compression chord buckling sideways first; the deck then hangs from the trusses. Truss members should bend and twist, not shatter.

## landmark/gasholder — column-guided gasholder

Reference media
- [Gasholders at the Oval.JPG](https://commons.wikimedia.org/wiki/File:Gasholders_at_the_Oval.JPG) - Public domain, 2080x1544. Angle/shows: wide view from outside the ground (public domain). — local: `refs/landmark-gasholder/01.jpg`
- [Gasholder number 1 at The Oval - geograph.org.uk - 7084876.jpg](https://commons.wikimedia.org/wiki/File:Gasholder_number_1_at_The_Oval_-_geograph.org.uk_-_7084876.jpg) - CC BY-SA 2.0, 2400x3200. Angle/shows: tall portrait of the guide frame. — local: `refs/landmark-gasholder/02.jpg`
- [The Oval, gasholder - geograph.org.uk - 1757328.jpg](https://commons.wikimedia.org/wiki/File:The_Oval,_gasholder_-_geograph.org.uk_-_1757328.jpg) - CC BY-SA 2.0, 1024x768. Angle/shows: from the seats by the players' pavilion. — local: `refs/landmark-gasholder/03.jpg`
- [Gasholders, King's Cross, London - 2023-06-25.jpg](https://commons.wikimedia.org/wiki/File:Gasholders,_King%27s_Cross,_London_-_2023-06-25.jpg) - CC BY-SA 4.0, 4482x2988. Angle/shows: King's Cross guide frames, wide. — local: `refs/landmark-gasholder/04.jpg`
- [Gasholder Park, King's Cross, Gasholders from the lock.jpg](https://commons.wikimedia.org/wiki/File:Gasholder_Park,_King%27s_Cross,_Gasholders_from_the_lock.jpg) - CC0, 3500x2625. Angle/shows: from the canal lock (CC0). — local: `refs/landmark-gasholder/05.jpg`
- [Regent's Canal King's Cross Gasholders 72759271.jpg](https://commons.wikimedia.org/wiki/File:Regent%27s_Canal_King%27s_Cross_Gasholders_72759271.jpg) - CC BY-SA 4.0, 2861x3813. Angle/shows: canal-side, portrait. — local: `refs/landmark-gasholder/06.jpg`
- Category pages: https://commons.wikimedia.org/wiki/Category:Gas_holders_in_London (subcategories Kennington Lane Gasholder Station, Gasholders Kings Cross).

Game camera to match: from the tank edge at ground level to read the tiers of columns; from ~1 diameter away at eye height to see the frame silhouette against sky.

Benchmarks
- Kennington (The Oval) Gasholder No. 1, 1877: wrought-iron guide frame about 135 ft (41 m) high, 24 T-section lattice standards, three tiers connected by three rows of horizontal lattice girders; full-height bell would top 180 ft (55 m). **[S]** https://en.wikipedia.org/wiki/The_Oval_Gasholders
- Capacity 3 million cu ft (1877-79), doubled to 6 million cu ft in 1891-92. **[S]** same URL
- A Historic England-listed replacement holder: new tank 218 ft diameter, 44 ft 6 in deep, 600,000 cu ft (as summarised). **[Q]** https://historicengland.org.uk/listing/the-list/list-entry/1427396
- Fulham No. 2: guide frame of 18 Tuscan columns in a single order, ~36 ft tall, supporting cast-iron girders. **[Q]** https://historicengland.org.uk/listing/the-list/list-entry/1261959
- Guide frames from 1835 used multiple orders of cast-iron paired columns with a top tier of girders; cast-iron column frames predominated until the late 19th century; spiral-guided holders (no frame) from 1890. **[S]** https://heritagecalling.com/2020/07/15/a-brief-introduction-to-gasholders/ (and **[Q]** https://en.wikipedia.org/wiki/Gas_holder)
- Bell rides on wheels running on vertical rails; oldest surviving holder Fulham, 1829. **[S]** https://heritagecalling.com/2020/07/15/a-brief-introduction-to-gasholders/

Tells
1. The frame is a stack of tiers of lattice standards braced with horizontal girder rings; the bell is a separate telescoping drum inside it. A solid cylinder with a few columns is wrong.
2. Bell state: a full holder stands nearly frame-height, an empty one sits low in its water tank. Both should be legible.
3. Failure: guide-frame columns buckle and the ring girders pull out; a punctured bell drops into water (a wet, not dry, collapse) with a dust-free splash.
4. Gas/fire is the harsh critic's second question: a gas release should burn, not just explode (game README covers gas networks).

## landmark/stadium — football stadium stands

Reference media
- [Leitch lattice work stadium of light.jpg](https://commons.wikimedia.org/wiki/File:Leitch_lattice_work_stadium_of_light.jpg) - CC BY-SA 4.0, 2874x1623. Angle/shows: Leitch criss-cross lattice steelwork fragments. — local: `refs/landmark-stadium/01.jpg`
- [South Stand, Hillsborough Stadium, Sheffield - geograph.org.uk - 760265.jpg](https://commons.wikimedia.org/wiki/File:South_Stand,_Hillsborough_Stadium,_Sheffield_-_geograph.org.uk_-_760265.jpg) - CC BY-SA 2.0, 640x427. Angle/shows: original Leitch stand, exterior. — local: `refs/landmark-stadium/02.jpg`
- [Ibrox Stadium - geograph.org.uk - 496743.jpg](https://commons.wikimedia.org/wiki/File:Ibrox_Stadium_-_geograph.org.uk_-_496743.jpg) - CC BY-SA 2.0, 640x456. Angle/shows: front of the main stand. — local: `refs/landmark-stadium/03.jpg`
- [Merton Meadow Stand - geograph.org.uk - 1094099.jpg](https://commons.wikimedia.org/wiki/File:Merton_Meadow_Stand_-_geograph.org.uk_-_1094099.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: main stand, late-1960s. — local: `refs/landmark-stadium/05.jpg`
- [Steigerwaldstadion-Mainstand2.JPG](https://commons.wikimedia.org/wiki/File:Steigerwaldstadion-Mainstand2.JPG) - CC BY-SA 3.0, 2592x1944. Angle/shows: main stand (non-UK, for roof/rake geometry). — local: `refs/landmark-stadium/04.jpg`
- [Specialist High Reach Excavator Demolishing the Stadium.jpg](https://commons.wikimedia.org/wiki/File:Specialist_High_Reach_Excavator_Demolishing_the_Stadium.jpg) - CC BY-SA 3.0, 1024x768. Angle/shows: stand demolition by high-reach excavator (see collapse/excavator).

Game camera to match: pitch-side low angle across the stand front; from the terrace steps looking up the rake to the roof; rear elevation for the steel frame.

Benchmarks
- Row depth at least 800 mm, 850 mm more common; minimum clearway 400 mm; rake capped around 34 degrees; radial gangway risers not more than 190 mm and goings not less than 280 mm (Green Guide s12.11). **[Q]** https://archgyan.com/how-to-design-a-stadium/ ; https://en.wikipedia.org/wiki/Green_Guide (summaries; not fetched)
- Archibald Leitch designed for 16 of 22 First Division clubs at his 1920s peak; Leitch stands recognisable by criss-cross lattice steelwork. **[Q]** https://en.wikipedia.org/wiki/Archibald_Leitch
- Precast stadium riser sizing reference (spans): PCI design aid. **[Q]** https://www.pci.org/PCI_Docs/Design_Resources/Design_Tables/PCI-DH-2017/StadiumRisers.pdf (link only, no number taken)

Tells
1. Rake/step geometry: a 190 mm riser over a 280 mm going is arctan(190/280) = 34 degrees [D], matching the ~34 degree rake cap, so the steepest tiers should look like ~34 degrees and no steeper; a flat-looking stand or a ladder-steep one is wrong.
2. Roof is a steel frame with truss/lattice members over slender columns; obstructing columns are common in older Leitch stands.
3. Seating is timber or plastic in continuous rows, terraces are stepped concrete: critic should see steps in the debris, not smooth ramps.
4. Steel portal collapse behaviour: the roof drops first when rear columns go, and the terrace slab stays.

## landmark/mill — Lancashire cotton mill with engine house and chimney

Reference media
- [Pear New Mill chimney in Bredbury, Stockport, Greater Manchester, England, on 2 October 2025 (01).jpg](https://commons.wikimedia.org/wiki/File:Pear_New_Mill_chimney_in_Bredbury,_Stockport,_Greater_Manchester,_England,_on_2_October_2025_(01).jpg) - CC0, 2296x4080. Angle/shows: chimney connected to the engine house (CC0, portrait). — local: `refs/landmark-mill/03.jpg`
- [Pear Mill chimney and engine house - geograph.org.uk - 5723280.jpg](https://commons.wikimedia.org/wiki/File:Pear_Mill_chimney_and_engine_house_-_geograph.org.uk_-_5723280.jpg) - CC BY-SA 2.0, 1280x2065. Angle/shows: chimney and engine house, portrait.
- [Pear Mill, Stockport, front elevation - geograph.org.uk - 58555.jpg](https://commons.wikimedia.org/wiki/File:Pear_Mill,_Stockport,_front_elevation_-_geograph.org.uk_-_58555.jpg) - CC BY-SA 2.0, 640x479. Angle/shows: long mill elevation. — local: `refs/landmark-mill/04.jpg`
- [Horrockses Cotton Mill, Preston.jpg](https://commons.wikimedia.org/wiki/File:Horrockses_Cotton_Mill,_Preston.jpg) - CC BY 2.0, 1600x881. Angle/shows: Centenary Mill (1895). — local: `refs/landmark-mill/01.jpg`
- [Brunswick Mill 5217.JPG](https://commons.wikimedia.org/wiki/File:Brunswick_Mill_5217.JPG) - CC BY-SA 3.0, 3264x2448. Angle/shows: Ardwick mill, built c.1840. — local: `refs/landmark-mill/02.jpg`
- [Goyt Mill - geograph.org.uk - 1205281.jpg](https://commons.wikimedia.org/wiki/File:Goyt_Mill_-_geograph.org.uk_-_1205281.jpg) - CC BY-SA 2.0, 640x420. Angle/shows: cotton spinning mill with large chimney.

Game camera to match: long elevation from across the canal/street to read storey count and bay rhythm; a low view up the chimney with the engine house at its foot.

Benchmarks
- Broadstone Mill, Reddish (1903-07, Stott and Sons): 270 ft (82 m) x 143 ft (44 m), six storeys, 12 bays wide by 9 deep plus rope race; bay 22 ft x 15 ft 6 in (6.7 m x 4.72 m). **[S]** https://en.wikipedia.org/wiki/Broadstone_Mill,_Reddish
- Floor heights: basement 8 ft 6 in, ground 16 ft, card shed 12 ft, 2nd-storey spinning room 14 ft 3 in, 3rd/4th 13 ft 9 in, 5th 14 ft 1.75 in. **[S]** same URL
- Engine: George Saxon 1,500 hp triple-expansion inverted vertical, cylinders 22/35/54 in, 4 ft stroke, 200 psi, 75 rpm, Corliss valves; four Lancashire boilers 30 ft x 8 ft per mill. **[S]** same URL
- Chimney: 75 yards (69 m); square to 33 ft then circular tapering from 18 ft (5.5 m) to 10 ft 10 in (3.30 m); slenderness height/base diameter 69/5.5 = 12.5 [D]. **[S]** same URL
- Houldsworth Mill (1865): two five-storey blocks of 18 bays, fireproof floors on transverse vaults. **[Q]** https://en.wikipedia.org/wiki/Houldsworth_Mill
- Chorlton New Mill (Historic England): eight storeys including two below street level, 20 bays, cast-iron and brick fireproof internal structure. **[Q]** https://historicengland.org.uk/listing/the-list/list-entry/1197774
- Project context: the game's Railway Quarter mill chimney is 60 m (README). Broadstone's is 69 m (+15 %) [D].

Tells
1. Floor heights are tall (4.2-4.9 m clear for ground and spinning rooms, vs ~2.9 m storey pitch for housing); the six listed Broadstone floors sum to ~24.5 m clear height [D], so a six-storey mill built on housing storey heights reads too squat.
2. Bay module 6.7 m x 4.7 m gives a regular rhythm of tall windows; large blank walls are wrong.
3. Chimney tapers from ~5.5 m to ~3.3 m over 69 m with a square base; a straight-sided tube or a chimney with no corbelled cap is wrong.
4. Fireproof mills (brick vaults on cast-iron columns) collapse differently from timber-floor mills: vault arches fail in shear/thrust and drop as brick masses; timber floors burn through and drop planks.

---

# B. Common buildings

## common/terrace — brick terrace / cottages

Reference media
- [Victorian terraced houses, Southampton Street - geograph.org.uk - 6516974.jpg](https://commons.wikimedia.org/wiki/File:Victorian_terraced_houses,_Southampton_Street_-_geograph.org.uk_-_6516974.jpg) - CC BY-SA 2.0, 6000x4000. Angle/shows: street-level oblique, high resolution. — local: `refs/common-terrace/01.jpg`
- [Victorian terraced houses - geograph.org.uk - 4361171.jpg](https://commons.wikimedia.org/wiki/File:Victorian_terraced_houses_-_geograph.org.uk_-_4361171.jpg) - CC BY-SA 2.0, 4608x3456. Angle/shows: terrace elevation. — local: `refs/common-terrace/02.jpg`
- [Brick Row - geograph.org.uk - 8261272.jpg](https://commons.wikimedia.org/wiki/File:Brick_Row_-_geograph.org.uk_-_8261272.jpg) - CC BY-SA 2.0, 3000x2000. Angle/shows: brick row, 3000x2000. — local: `refs/common-terrace/03.jpg`
- [Victorian terraced cottages in Bridge Street - geograph.org.uk - 5753542.jpg](https://commons.wikimedia.org/wiki/File:Victorian_terraced_cottages_in_Bridge_Street_-_geograph.org.uk_-_5753542.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: cottage row.
- [Red brick row of houses, Sheerness - geograph.org.uk - 2996700.jpg](https://commons.wikimedia.org/wiki/File:Red_brick_row_of_houses,_Sheerness_-_geograph.org.uk_-_2996700.jpg) - CC BY-SA 2.0, 4288x3216. Angle/shows: red-brick row. — local: `refs/common-terrace/04.jpg`

Game camera to match: street-level oblique along the terrace; head-on elevation for window/door rhythm; rear alley view for outriggers.

Benchmarks
- Byelaw terraced housing (1875-1918): single-wythe 9-inch brick walls in Flemish bond; streets 36 ft (11 m) wide; ginnel every fourth house; 8x2 in softwood joists; damp course at least 9 in below floor beams. **[S]** https://en.wikipedia.org/wiki/Byelaw_terraced_house
- Standard UK metric brick 215 x 102.5 x 65 mm; with 10 mm joint the working size is 225 x 112.5 x 75 mm, so 3 courses = 225 mm; 60 bricks/m2 single skin, 120 bricks/m2 double. Pre-1970 imperial bricks 228-230 x 108-110 x 68-75 mm. **[S]** https://www.imperialbricks.co.uk/guidance/standard-brick-size-in-the-uk/
- Victorian solid walls typically 9 in (225 mm); 275 mm with plaster. **[Q]** https://www.epcguide.co.uk/property-types/victorian-terrace
- Roof pitch and storey height: not reliably sourced; the search snippet mentioning 40-50 degrees echoed a value in the query, so it is treated as a gap.

Tells
1. Wall thickness is 9 in (225 mm, about one brick length plus a header course depth); a chunky 400 mm masonry wall is wrong.
2. Courses must be visible in rubble: 75 mm courses, running or Flemish bond headers; slab-like breakage is the giveaway.
3. Party walls are shared: when a house is knocked down the neighbour is left with a bare scarred wall and joist pockets.
4. Timber floors and roof carry most of the dead load into the walls; expect floors to pancake and the front wall to fall outward in a sheet with courses opened.

## common/timber-frame — timber-frame house

Reference media
- [Jettied, Timber Framed House, Aldbury - geograph.org.uk - 1578605.jpg](https://commons.wikimedia.org/wiki/File:Jettied,_Timber_Framed_House,_Aldbury_-_geograph.org.uk_-_1578605.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: jettied frame, front. — local: `refs/common-timber-frame/03.jpg`
- [Jettied timber-framed building in Tewkesbury - geograph.org.uk - 5111247.jpg](https://commons.wikimedia.org/wiki/File:Jettied_timber-framed_building_in_Tewkesbury_-_geograph.org.uk_-_5111247.jpg) - CC BY-SA 2.0, 600x800. Angle/shows: jettied street frontage, portrait.
- [Lichfield, Bore Street, Tudor half timbered public house - geograph.org.uk - 6996439.jpg](https://commons.wikimedia.org/wiki/File:Lichfield,_Bore_Street,_Tudor_half_timbered_public_house_-_geograph.org.uk_-_6996439.jpg) - CC BY-SA 2.0, 6813x4542. Angle/shows: Tudor half-timbered, high resolution. — local: `refs/common-timber-frame/01.jpg`
- [Chilham, Attractive half timbered buildings - geograph.org.uk - 4833496.jpg](https://commons.wikimedia.org/wiki/File:Chilham,_Attractive_half_timbered_buildings_-_geograph.org.uk_-_4833496.jpg) - CC BY-SA 2.0, 5334x3378. Angle/shows: row of half-timbered buildings. — local: `refs/common-timber-frame/02.jpg`
- [Timber Frame and Jettied Floor House, Aldbury - geograph.org.uk - 1578022.jpg](https://commons.wikimedia.org/wiki/File:Timber_Frame_and_Jettied_Floor_House,_Aldbury_-_geograph.org.uk_-_1578022.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: jettied floor detail.

Game camera to match: street-level oblique to read the jetty overhang; close view of a bay with studs and infill.

Benchmarks
- Frames of oak, walls filled with wattle and daub; square/small framing until the 15th century, close studding from the 15th. **[Q]** https://ruralhistoria.com/2023/12/13/timber-framed-houses/
- A jetty is an upper floor cantilevered on a bressummer projecting beyond the floor below. **[Q]** https://en.wikipedia.org/wiki/Post-and-plank (result set) / https://www.buildingconservation.com/articles/wattleanddaub/wattleanddaub.htm
- Wattle: horizontal ledgers every 0.6-0.9 m, hazel rods a finger-width apart. **[Q]** https://www.buildingconservation.com/articles/wattleanddaub/wattleanddaub.htm
- Maximum main span for traditional oak-frame types roughly 6.4 m. **[Q]** https://www.ehbp.com/faqs-building-process/building-specification/frame-types/
- Timber fire behaviour: see material/timber.

Tells
1. Frame must be visibly primary: posts, tie beams, braces and jointed connections; nailed stud walls look like a modern house.
2. Infill panels (wattle-and-daub or brick) fall out and crumble while the frame racks and stays partly standing.
3. Joints fail by peg/tenon pull-out before the timber itself breaks; critic should see intact long timbers in the pile.

## common/walkup-flats — walk-up flats

Reference media
- (no usable Commons files found; see gaps)
Note: the Commons search did not find usable walk-up flat photos; this id is a gap.

Benchmarks
- No dimensional source found. Storey pitch for a comparable mid-century housing block: Red Road 2.87 m [D from S], Ronan Point 2.9 m [D]; see landmark/tower. Brick module from common/terrace applies to load-bearing brick blocks.
- Stair-core/maisonette layout figures: **not sourced** (gap).

Tells
1. Load-bearing brick cross-walls at party lines with concrete or timber floors: walls fall as panels with courses opening, floors pancake.
2. Stair core is the stiff element and often the last thing standing.
3. Deck access/balconies: cantilevered slabs shear off first.

## common/steel-office — steel-frame office

Reference media
- [Steel framed office block under construction - geograph.org.uk - 582264.jpg](https://commons.wikimedia.org/wiki/File:Steel_framed_office_block_under_construction_-_geograph.org.uk_-_582264.jpg) - CC BY-SA 2.0, 640x430. Angle/shows: frame stage, 640x430. — local: `refs/common-steel-office/02.jpg`
- [LC Smith Building construction showing structural steel skeleton, ca 1913 (SEATTLE 3151).jpg](https://commons.wikimedia.org/wiki/File:LC_Smith_Building_construction_showing_structural_steel_skeleton,_ca_1913_(SEATTLE_3151).jpg) - Public domain, 2980x3799. Angle/shows: steel skeleton, c.1913 (public domain). — local: `refs/common-steel-office/03.jpg`
- [Moscow, 2nd Brestskaya Street - steel frame construction.jpg](https://commons.wikimedia.org/wiki/File:Moscow,_2nd_Brestskaya_Street_-_steel_frame_construction.jpg) - CC BY 3.0, 2976x2396. Angle/shows: steel frame construction. — local: `refs/common-steel-office/01.jpg`
- [Alaska Building under construction, Seattle, August 9, 1904 (MOHAI 3559).jpg](https://commons.wikimedia.org/wiki/File:Alaska_Building_under_construction,_Seattle,_August_9,_1904_(MOHAI_3559).jpg) - Public domain, 475x600. Angle/shows: 14-storey steel frame under construction, 1904 (public domain).

Game camera to match: street level looking up the frame; a frame-only shot during construction to check column and beam depth; close-up of a beam-column joint.

Benchmarks
- Optimum structural grid 7.5 m x 9 m for a business-park office; floor-to-ceiling 2.5-2.7 m speculative, 3 m prestige, plus floor depth incl. services; building width 12-15 m (two spans of 6-7.5 m) naturally ventilated, 15-18 m clear span if air-conditioned. **[Q]** https://www.building.co.uk/home/steel-insight-multi-storey-offices-/5035398.article ; https://www.steelconstruction.info/Multi-storey_office_buildings
- Cardington frame: 8 storeys, 6 m / 9 m / 6 m grid, 945 m2 plan. **[Q]** https://www.researchgate.net/publication/222000578_An_analysis_of_the_global_structural_behaviour_of_the_Cardington_steel-framed_building_during_the_two_BRE_fire_tests
- Cardington fires: gas temperatures over 1200 C, unprotected beams to 1100 C, no structural collapse; compartments 50-340 m2. **[S]** https://www.steelconstruction.info/Cardington_fire_test_data

Tells
1. Slender members: columns only a few hundred mm across at 7.5-9 m spacing; too few or too fat columns reads as a car park or warehouse.
2. Composite slab on beams; when beams fail the slab remains and hangs (Cardington catenary action), so expect sag before drop.
3. Curtain wall panels (glass/aluminium) hang off slab edges; they detach as whole panes/units.

## common/car-park — multi-storey car park

Reference media
- [The interior of the brightly lit, concrete structure of The Brook Multi Storey Car Park in Chatham, Kent, E...](https://commons.wikimedia.org/wiki/File:The_interior_of_the_brightly_lit,_concrete_structure_of_The_Brook_Multi_Storey_Car_Park_in_Chatham,_Kent,_England.jpg) - CC BY-SA 4.0, 7806x4391. Angle/shows: interior deck and columns, 7806x4391. — local: `refs/common-car-park/01.jpg`
- [Rishworth Street multi-storey carpark - geograph.org.uk - 1046348.jpg](https://commons.wikimedia.org/wiki/File:Rishworth_Street_multi-storey_carpark_-_geograph.org.uk_-_1046348.jpg) - CC BY-SA 2.0, 458x640. Angle/shows: exterior, portrait.
- [Manors car park (51218293491).jpg](https://commons.wikimedia.org/wiki/File:Manors_car_park_(51218293491).jpg) - CC0, 5184x3888. Angle/shows: concrete multi-storey exterior (CC0). — local: `refs/common-car-park/02.jpg`
- [Garrard Street car park, Reading - geograph.org.uk - 1075467.jpg](https://commons.wikimedia.org/wiki/File:Garrard_Street_car_park,_Reading_-_geograph.org.uk_-_1075467.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: exterior. — local: `refs/common-car-park/03.jpg`
- [Car park in Gravesend (34164270003).jpg](https://commons.wikimedia.org/wiki/File:Car_park_in_Gravesend_(34164270003).jpg) - CC0, 4000x3000. Angle/shows: car park (CC0). — local: `refs/common-car-park/04.jpg`

Game camera to match: ramp-level looking down an aisle; edge elevation with open-sided deck edges; pillar close-up.

Benchmarks
- 90-degree parking: one-way aisle 6.0 m, two-way 6.95 m, bin width 15.60-16.55 m; stall width 2.3-2.5 m for 45-degree bays. **[S]** https://steelconstruction.info/sectors/retail-buildings/car-parks/
- Ramps: at least 3.5 m single, 7 m double; slope 1:6 to 1:10; minimum clear headroom 2.1 m. **[S]** same URL
- Column spacing: 4.8 m (2 stalls, clear span, 5.7 m propped), 7.2 m (3 stalls, 8.1 m propped), 9.6 m (4 stalls, 10.5 m propped); steel deck max 4.5 m unpropped. **[S]** same URL
- Imposed load 2.5 kN/m2; minimum natural frequency 3.0 Hz; measured frequencies 2.8-5.18 Hz. **[S]** same URL

Tells
1. Open sides with parapet/barrier only, so a car park is near-transparent; solid walls read as a warehouse.
2. Long clear spans (7-10 m) with shallow decks: RC flat slabs punching shear failure, slab dropping around a column while neighbours stay.
3. Parked vehicles on decks (2.5 kN/m2 load) matter for load and debris.

## common/warehouse — warehouse

Reference media
- [Trans-shipment warehouse, Regent's Canal - geograph.org.uk - 953119.jpg](https://commons.wikimedia.org/wiki/File:Trans-shipment_warehouse,_Regent%27s_Canal_-_geograph.org.uk_-_953119.jpg) - CC BY-SA 2.0, 640x427. Angle/shows: canal-side brick warehouse.
- [A & T Burt building on Ferry Road.jpg](https://commons.wikimedia.org/wiki/File:A_%26_T_Burt_building_on_Ferry_Road.jpg) - CC BY-SA 2.0, 1280x960. Angle/shows: damaged Victorian brick warehouses (useful for failure look).
- [CurrieAndRichardsBuilding (4520642426).jpg](https://commons.wikimedia.org/wiki/File:CurrieAndRichardsBuilding_(4520642426).jpg) - CC BY-SA 2.0, 1800x1200. Angle/shows: 1875 warehouse. — local: `refs/common-warehouse/01.jpg`
- [End of Leeds-Liverpool Canal and Tobacco Warehouse - geograph.org.uk - 684149.jpg](https://commons.wikimedia.org/wiki/File:End_of_Leeds-Liverpool_Canal_and_Tobacco_Warehouse_-_geograph.org.uk_-_684149.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: side view. — local: `refs/common-warehouse/02.jpg`
- [Clerkenwell, Former George Farmiloe building, St John Street, EC1 - geograph.org.uk - 756323.jpg](https://commons.wikimedia.org/wiki/File:Clerkenwell,_Former_George_Farmiloe_building,_St_John_Street,_EC1_-_geograph.org.uk_-_756323.jpg) - CC BY-SA 2.0, 640x476. Angle/shows: Victorian warehouse/works elevation.

Game camera to match: canal-side elevation showing loading hoists and windows; interior with cast-iron columns.

Benchmarks
- Multi-storey warehouse upper floors: grid 5.8 m x 3.65 m bays with slim cast-iron columns 300-400 mm across, supporting inverted-Y cast-iron beams spanning 5.8 m. **[Q]** https://historicengland.org.uk/listing/the-list/list-entry/1242440 (page returned 403; from search summary, result set also included list entries 1376227 and 1419254)
- Cast-iron stanchions under timber floors from 1813-18 replaced oak storey posts; Building Acts pushed fireproof features (cast-iron columns, enclosed stair bay). **[Q]** https://historicengland.org.uk/images-books/publications/iha-railway-goods-sheds-warehouses/heag115-railway-goods-sheds-and-warehouses-iha/ (result set)
- Single-storey steel-frame sheds: not sourced (gap).

Tells
1. Brick walls with regularly spaced small windows; big doors at ground; floors timber-on-iron: collapse should be column-by-column with floors dishing.
2. Cast-iron columns are brittle: they snap cleanly at once rather than bending.
3. Stock (sacks, crates) adds load and debris.

## common/barn — barn

Reference media
- [Maidstone. The tithe barn was built in the 14th century and was subsequently used as the stables of the nea...](https://commons.wikimedia.org/wiki/File:Maidstone._The_tithe_barn_was_built_in_the_14th_century_and_was_subsequently_used_as_the_stables_of_the_nearby_palace_of_the_Archbishop_of_Canterbury.jpg) - Public domain, 4032x3024. Angle/shows: tithe barn exterior (public domain). — local: `refs/common-barn/01.jpg`
- [Aisled Barn Interior, Wycoller - geograph.org.uk - 1282274.jpg](https://commons.wikimedia.org/wiki/File:Aisled_Barn_Interior,_Wycoller_-_geograph.org.uk_-_1282274.jpg) - CC BY-SA 2.0, 1024x683. Angle/shows: interior of aisled barn.
- [The aisled barn at Shibden Hall - geograph.org.uk - 8262953.jpg](https://commons.wikimedia.org/wiki/File:The_aisled_barn_at_Shibden_Hall_-_geograph.org.uk_-_8262953.jpg) - CC BY-SA 2.0, 4864x3648. Angle/shows: exterior, high resolution. — local: `refs/common-barn/02.jpg`
- [Barn, Upton St. Leonards - geograph.org.uk - 876572.jpg](https://commons.wikimedia.org/wiki/File:Barn,_Upton_St._Leonards_-_geograph.org.uk_-_876572.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: large barn at Manor Farm. — local: `refs/common-barn/03.jpg`
- [Tithe Barn - Hodnet Hall Gardens (16760031874).jpg](https://commons.wikimedia.org/wiki/File:Tithe_Barn_-_Hodnet_Hall_Gardens_(16760031874).jpg) - CC BY-SA 2.0, 4288x3216. Angle/shows: tithe barn. — local: `refs/common-barn/04.jpg`

Game camera to match: gable-end elevation showing the aisled section; interior looking along the bays.

Benchmarks
- Great Coxwell Barn: 152 ft (46 m) x 43 ft (13 m), ridge 48 ft (15 m), seven bays, six pairs of posts. **[Q]** https://en.wikipedia.org/wiki/Great_Coxwell_Barn
- Great Barn at Manor Farm (Hillingdon): seven bays, clear span 17 ft (5.2 m), aisles 15 ft (4.6 m) each side. **[Q]** https://www.hillingdon.gov.uk/article/3891/The-Great-Barn-at-Manor-Farm
- The bay is the distance between principal roof trusses. **[Q]** https://www.henhamhistory.org/app/uploads/2020/12/CompleteGlossary-1.pdf

Tells
1. Roof carried by posts/tie beams and rafters, ridge low and long; clad in boards or brick infill, not sheeting.
2. Collapse: posts kick out at the base, roof racks into a long parallelogram before dropping.
3. Fire: barn with hay fed by fuel load: burn-through.

## common/chapel — chapel

Reference media
- [Nonconformist Chapel, Landkey (I).jpg](https://commons.wikimedia.org/wiki/File:Nonconformist_Chapel,_Landkey_(I).jpg) - CC BY-SA 4.0, 4225x3075. Angle/shows: Grade II 19th-century chapel front. — local: `refs/common-chapel/03.jpg`
- [Tabor Methodist Chapel, Brynmawr - geograph.org.uk - 1819574.jpg](https://commons.wikimedia.org/wiki/File:Tabor_Methodist_Chapel,_Brynmawr_-_geograph.org.uk_-_1819574.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: Welsh Methodist chapel.
- [Sandycroft Methodist Chapel - geograph.org.uk - 4947050.jpg](https://commons.wikimedia.org/wiki/File:Sandycroft_Methodist_Chapel_-_geograph.org.uk_-_4947050.jpg) - CC BY-SA 2.0, 3798x2766. Angle/shows: Methodist chapel. — local: `refs/common-chapel/01.jpg`
- [Calvinist Methodist Chapel - geograph.org.uk - 509963.jpg](https://commons.wikimedia.org/wiki/File:Calvinist_Methodist_Chapel_-_geograph.org.uk_-_509963.jpg) - CC BY-SA 2.0, 600x450. Angle/shows: austere chapel.
- [Nonconformist Cemetery Chapel, Cirencester.jpg](https://commons.wikimedia.org/wiki/File:Nonconformist_Cemetery_Chapel,_Cirencester.jpg) - CC BY-SA 4.0, 4000x3000. Angle/shows: cemetery chapel. — local: `refs/common-chapel/02.jpg`

Game camera to match: front (gable) elevation with the entrance and round-headed windows; side view to read windows and pitch.

Benchmarks
- Early chapels plain rectangular; wealthier congregations built two-storey chapels with classical facade and internal gallery. **[Q]** https://historicengland.org.uk/images-books/publications/iha-nonconformist-places-of-worship/ (result set)
- Dimensions not sourced (gap). Cemetery-chapel and Methodist examples on Commons for form only.

Tells
1. Gable front with a symmetrical door and windows, tall single-volume interior; bell-cote or small tower is minor.
2. Roof trusses span the whole nave: when walls go the roof falls as one rigid piece first.
3. Rubble should show stone/brick coursing and lime mortar.

---

# C. Collapse behaviours

## collapse/steel-highrise-implosion — explosive demolition of a steel-frame high-rise

Reference media
- [Capital One Tower Demolition 9-7-24.jpg](https://commons.wikimedia.org/wiki/File:Capital_One_Tower_Demolition_9-7-24.jpg) - CC0, 5184x3456. Angle/shows: high-rise implosion, 5184x3456 (CC0). — local: `refs/collapse-steel-highrise-implosion/01.jpg`
- [Implosion Begins of the New Haven Coliseum (53814625975).jpg](https://commons.wikimedia.org/wiki/File:Implosion_Begins_of_the_New_Haven_Coliseum_(53814625975).jpg) - CC BY-SA 2.0, 3008x2000. Angle/shows: frame 1 of a sequence: the start (steel-frame coliseum, not a tower). — local: `refs/collapse-steel-highrise-implosion/02.jpg`
- [Implosion of the New Haven Coliseum (53814520459).jpg](https://commons.wikimedia.org/wiki/File:Implosion_of_the_New_Haven_Coliseum_(53814520459).jpg) - CC BY-SA 2.0, 3008x2000. Angle/shows: mid-collapse. — local: `refs/collapse-steel-highrise-implosion/03.jpg`
- [Aftermath of the Implosion of the New Haven Coliseum (53814625990).jpg](https://commons.wikimedia.org/wiki/File:Aftermath_of_the_Implosion_of_the_New_Haven_Coliseum_(53814625990).jpg) - CC BY-SA 2.0, 3008x2000. Angle/shows: aftermath/pile. — local: `refs/collapse-steel-highrise-implosion/04.jpg`
- [Dust Cloud (363692640).jpg](https://commons.wikimedia.org/wiki/File:Dust_Cloud_(363692640).jpg) - CC BY 2.0, 1600x1066. Angle/shows: dust cloud from the same implosion. — local: `refs/collapse-steel-highrise-implosion/05.jpg`
- Categories: https://commons.wikimedia.org/wiki/Category:Implosions (Building implosions subcategory, 48 files); https://commons.wikimedia.org/wiki/Category:Building_demolition
Videos:
- Detroit's J.L. Hudson building implosion (Oct 1998): https://www.youtube.com/watch?v=GCoaUtxY21c
- Capital One Tower explosives demolition: https://www.youtube.com/watch?v=mVBHLZgAVzg
- Kingdome roof implosion, all angles: https://www.youtube.com/watch?v=MXjqAdkQgVU

Game camera to match: distance shot ~1.5 building-heights back at street level (the classic spectator view); a second from 2-3 blocks with skyline; ground-level dust.

Benchmarks
- J.L. Hudson's (24 Oct 1998, Controlled Demolition Inc.): 439 ft (134 m), 33 levels, 2.2 million sq ft, footprint 420 ft x 220 ft; steel columns over 500 lb/ft, flanges up to 7.25 in. **[S]** https://www.controlled-demolition.com/explosives-demolition/projects/jl-hudson-department-store/
- 4,118 charges in 1,100 locations, over 36,000 ft of detonating cord, 4,512 non-electric delays, 36 primary sequences, 216 micro-delays, 2,728 lb explosives; loaded by 12 people over 24 days. **[S]** same URL
- Debris pile average 35 ft, maximum 60 ft (tower location); adjacent People Mover 15 ft from east face. **[S]** same URL
- Pile height fraction 35/439 = 8 %, 60/439 = 13.7 % [D]. Pile height relative to 33 levels: the building compressed to ~1-2 storeys.
- Duration: "14 seconds" in one report, "30 ground-shaking seconds" in another; unresolved. **[Q]** https://www.fox2detroit.com/news/hudsons-building-implosion-25-years-since-the-dust-cloud-engulfed-the-city-of-detroit ; the upper tower "twisted and careened onto the pile". **[Q]** https://www.detroitnews.com/story/news/local/detroit-city/2023/10/24/25-years-since-hudsons-building-reduced-to-dust/71296808007/
- Free-fall time from 133.8 m = 5.22 s [D].
- Kingdome: 660 ft dome, "took 16.8 seconds", two phases (3 sections, then 3 more many seconds later), registered 2.3 on the Richter scale. **[S]** https://www.historylink.org/file/2252 ; charges 5,800. **[Q]** https://www.kiro7.com/sports/25-years-ago-today-kingdome-implodes-2000/WALBGHWY6BFUHBSCHGS7W3TIHQ/
- Failure cases: Royal Canberra Hospital 1997 (debris thrown 650 m, 1 death); Dallas office 2020 (core left standing). **[S]** https://en.wikipedia.org/wiki/Building_implosion
- Sequence: linear shaped charges sever steel; delays make the collapse fold inward; typical prep "up to six months" for complex structures. **[S]** https://en.wikipedia.org/wiki/Building_implosion
- Dust: see material/dust.

Tells
1. Collapse should start at the base/lower floors with the upper part dropping vertically as a rigid block before disintegrating; a top-down peel or a building that leans and topples like a tree is wrong for an implosion.
2. Final pile 8-14 % of original height; a pile that is 1/3 the height (too high) or a flat carpet (too low) fails.
3. Debris and dust plume expand outward well past the footprint (dust much wider than debris).
4. Column ends: severed steel columns show burnt/blown ends and long folded lengths, not neat 4 m segments.
5. Timing: Red Road's 31-storey block fell in about 4 s (free fall from 89 m is 4.3 s [D]) and Hudson's is reported at 14 s (disputed, 30 s in another report); a whole-building collapse taking well over 30 s, or one finishing in under 3 s, is suspect.

## collapse/rc-tower-implosion — explosive demolition of an RC tower block

Reference media
- [MacDonagh Implosion.JPG](https://commons.wikimedia.org/wiki/File:MacDonagh_Implosion.JPG) - CC BY-SA 3.0, 995x746. Angle/shows: Ballymun tower block implosion, mid-fall. — local: `refs/collapse-rc-tower-implosion/03.jpg`
- [Red Net Flats Slab block.jpg](https://commons.wikimedia.org/wiki/File:Red_Net_Flats_Slab_block.jpg) - Public domain, 4608x3072. Angle/shows: Red Road slab block prepared for demolition. — local: `refs/collapse-rc-tower-implosion/01.jpg`
- [Demolition site at Red Road flats - geograph.org.uk - 1262168.jpg](https://commons.wikimedia.org/wiki/File:Demolition_site_at_Red_Road_flats_-_geograph.org.uk_-_1262168.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: Red Road demolition site. — local: `refs/collapse-rc-tower-implosion/02.jpg`
- [Demolishing Pleck - geograph.org.uk - 434271.jpg](https://commons.wikimedia.org/wiki/File:Demolishing_Pleck_-_geograph.org.uk_-_434271.jpg) - CC BY-SA 2.0, 600x450. Angle/shows: tower block demolition in progress.
- [MacDonagh Tower.JPG](https://commons.wikimedia.org/wiki/File:MacDonagh_Tower.JPG) - CC BY-SA 3.0, 633x846. Angle/shows: MacDonagh tower seven days before implosion.
Videos:
- Ocean Tower implosion, South Padre Island (Dec 2009): https://www.youtube.com/watch?v=1IQUoZmtyOo
- Kingdome (RC roof): https://www.youtube.com/watch?v=F6BgKHBJebM

Game camera to match: same as the steel high-rise, plus a close ground view of pile at the end.

Benchmarks
- Ocean Tower: 31 storeys, 115.51 m (379 ft), RC, 55,000 short tons (50,000 t) at demolition; "tallest and largest reinforced concrete structure ever imploded"; 13 Dec 2009, ~9:00 am. **[S]** https://en.wikipedia.org/wiki/Ocean_Tower
- Charge: 705 kg (1,550 lb) explosives, 4,358 m of detonating cord, 1,841 holes on 8 blasting levels. **[Q]** https://en.wikipedia.org/wiki/Controlled_Demolition,_Inc.
- Observed: "a loud boom and a few seconds of nothing before the building waved in the air and dissolved into dust"; 55,000 tons of debris. **[Q]** https://www.mysanantonio.com/news/article/Leaning-South-Padre-tower-turned-into-55-000-tons-626882.php
- Red Road blocks were steel-framed per the article, so they are evidence for tower-block implosion behaviour, not for RC fracture: 31-storey point block, "taking about four seconds to fall" (May 2013); October 2015 blast used 275 kg of explosive, ripped the building around floors 6-8, two of six blocks stayed partly standing (top ~13 floors), later dismantled with cables and excavators. **[S]** https://en.wikipedia.org/wiki/Red_Road_Flats ; two blocks left standing with the top 13 floors: **[Q]** https://www.vice.com/en/article/we-watched-glasgows-iconic-red-road-tower-blocks-being-demolished-206/
- Free-fall time from 89 m = 4.26 s [D].
- Bulking factor 1.25-1.5 for loose rubble vs solid (weak commercial sources). **[Q]** https://tradecalculator.co.uk/general/rubble-removal-calculator/

Tells
1. A "tell" from real life: the Red Road failure showed the top 13 floors standing on cut lower floors; a critic should ask whether the sim can fail to collapse when the cut is only on a few storeys. If the sim always collapses fully, that is unrealistic optimism.
2. RC slabs pancake with broken slabs and rebar dangling; a smooth pulverised gravel pile is wrong.
3. Cores (RC shear walls) tend to remain taller than the surrounding pile.
4. Dust bloom is enormous compared to pile; rebar and floor slabs remain recognisable at the pile top.

## collapse/chimney-felling — explosive demolition of a masonry chimney (felling)

Reference media
- [Stella south power station chimney falling.jpg](https://commons.wikimedia.org/wiki/File:Stella_south_power_station_chimney_falling.jpg) - CC BY 3.0, 1660x1184. Angle/shows: scanned colour print of a chimney mid-fall. — local: `refs/collapse-chimney-felling/01.jpg`
- [Démolition des cheminées de la Raffinerie de Collombey 07 - Cheminée droite peu avant l'impact.jpg](https://commons.wikimedia.org/wiki/File:D%C3%A9molition_des_chemin%C3%A9es_de_la_Raffinerie_de_Collombey_07_-_Chemin%C3%A9e_droite_peu_avant_l%27impact.jpg) - CC BY-SA 4.0, 7591x3796. Angle/shows: right chimney nearly horizontal just before hitting the ground. — local: `refs/collapse-chimney-felling/02.jpg`
- [Démolition des cheminées de la Raffinerie de Collombey 09 - Nuage de poussière après l'effondrement.jpg](https://commons.wikimedia.org/wiki/File:D%C3%A9molition_des_chemin%C3%A9es_de_la_Raffinerie_de_Collombey_09_-_Nuage_de_poussi%C3%A8re_apr%C3%A8s_l%27effondrement.jpg) - CC BY-SA 4.0, 7591x3796. Angle/shows: dust cloud after both chimneys fell. — local: `refs/material-dust/02.jpg`
- [Dunlopillo chimney at Pannal (2).JPG](https://commons.wikimedia.org/wiki/File:Dunlopillo_chimney_at_Pannal_(2).JPG) - CC BY-SA 4.0, 2920x1356. Angle/shows: the scene seconds after demolition. — local: `refs/collapse-chimney-felling/06.jpg`
- [Blasting of a chimney at the former Henninger Brewery in Frankfurt am Main, Germany.jpg](https://commons.wikimedia.org/wiki/File:Blasting_of_a_chimney_at_the_former_Henninger_Brewery_in_Frankfurt_am_Main,_Germany.jpg) - CC BY-SA 3.0, 4179x1336. Angle/shows: blasting sequence, Frankfurt. — local: `refs/collapse-chimney-felling/04.jpg`
- [Kunstseidenwerk Pirna Fall kleiner Schornsteinsprengung 1997.jpg](https://commons.wikimedia.org/wiki/File:Kunstseidenwerk_Pirna_Fall_kleiner_Schornsteinsprengung_1997.jpg) - CC BY-SA 4.0, 6012x4188. Angle/shows: small chimney blast, 1997. — local: `refs/collapse-chimney-felling/05.jpg`
Videos (BBC Archive, Fred Dibnah):
- Steeplejack takes down a chimney brick by brick, 1979: https://www.youtube.com/watch?v=NKPApAsJbj4
- Fred Dibnah and wife topple a huge chimney with fire, 1979: https://www.youtube.com/watch?v=wphmEMNatp0
- ASARCO El Paso 2013 news video: https://www.krwg.org/regional/2013-04-13/video-asarco-demolition-in-el-paso

Game camera to match: side-on at 1.5-2 chimney heights on the fall axis perpendicular (to read the arc), and an end-on view along the fall line for the pile.

Benchmarks
- ASARCO Tacoma (1993): 571 ft radial brick chimney, felled "in less than 8 seconds"; out of plumb ~8 ft, rotated ~5 degrees; 450 lb dynamite; fell south into a prepared debris receptacle; debris 2.5 million bricks, 28 tons mortar, over 5,300 yd3 concrete. **[S]** https://www.controlled-demolition.com/explosives-demolition/projects/asarco-chimney/
- Dairyland windscreen 700 ft RC; Harllee Branch 1,007 ft (307 m); CDI claims >1,000 chimneys felled. **[S]** https://www.controlled-demolition.com/services/explosives-demolition/chimneys/
- 180 m RC chimney blast (C30, base outer radius 9.25 m, top 3.05 m): notch 6.0 m high at 0.5 m elevation, central angle 216 degrees (~60 % of circumference), 30-degree directional window each side, 124 kg emulsion explosive, 612 holes. **[S]** https://pmc.ncbi.nlm.nih.gov/articles/PMC10346864/
- Timeline (same chimney): cracks at 45 degrees at 0.5 s, main fracture connected at 2.0 s, notch closed at 4.5 s; sit-down ~2.5 s, 8.3 m total sit-down displacement; peak downward velocity 5.96 m/s; final rotation ~3 degrees at the end of the measured phase; total vibration 18.5 s; touchdown vibration <10 Hz vs blast >50 Hz. **[S]** same URL
- Other reports: upper part hit ground ~12.5 s after detonation and the lower part ~14 s in one documented case; neutral axis forms 0.5-3.0 s after the notch blast. **[Q]** https://www.nature.com/articles/s41598-025-29662-3 ; https://www.davidpublisher.com/Public/uploads/Contribute/550be79b59bba.pdf (summaries)
- El Paso 2013: 600 ft and 829 ft brick stacks toppled in under 30 s using 300 lb dynamite; dust damped by 26 misters (500,000 gal water). **[Q]** https://www.statesman.com/story/news/2013/04/13/iconic-el-paso-smelter-chimneys-demolished/9939594007/
- Traditional felling (Dibnah): remove bricks at the base, shore with timber props, set fire to the props. **[S]** https://en.wikipedia.org/wiki/Chimney_felling
- Lancashire mill chimney proportions: Broadstone 69 m tall, base 5.5 m to top 3.3 m (see landmark/mill).

Tells
1. The chimney rotates about a hinge at the base of the notch as a stiff rod; it should not fold like a rope. Tall chimneys can break in the middle on the way down (bottom collapse and middle break, per the 2025 Sci Rep paper).
2. The base "sits down" (drops several metres) before it tips: 2.5 s for a 180 m RC stack.
3. Landing: the shaft breaks into several chunks and brick-scale debris in a long, narrow, fan-shaped pile along the fall line; ASARCO pile was millions of bricks, not few large slabs.
4. Brick chimney vs RC: brick lets go along mortar joints into rings of courses; a brick chimney fragmenting into flat slab panels is wrong.
5. Dust: big cloud at the impact end.

## collapse/church-tower — explosive demolition of a church or tower

Reference media
- [Chichester Cathedral Spire Collapse 1861.jpg](https://commons.wikimedia.org/wiki/File:Chichester_Cathedral_Spire_Collapse_1861.jpg) - Public domain, 1070x1637. Angle/shows: aftermath of a natural spire collapse (public domain). — local: `refs/collapse-church-tower/01.jpg`
- [St Peter's Church demolition, ^1 - geograph.org.uk - 3863647.jpg](https://commons.wikimedia.org/wiki/File:St_Peter%27s_Church_demolition,_%5E1_-_geograph.org.uk_-_3863647.jpg) - CC BY-SA 2.0, 2967x1837. Angle/shows: mechanical demolition of a church, 1. — local: `refs/collapse-church-tower/02.jpg`
- [St Peter's Church demolition, ^4 - geograph.org.uk - 3863702.jpg](https://commons.wikimedia.org/wiki/File:St_Peter%27s_Church_demolition,_%5E4_-_geograph.org.uk_-_3863702.jpg) - CC BY-SA 2.0, 1280x960. Angle/shows: mechanical demolition of a church, 4. — local: `refs/collapse-church-tower/03.jpg`
- [Demolition of Wesley Methodist Church - geograph.org.uk - 3422283.jpg](https://commons.wikimedia.org/wiki/File:Demolition_of_Wesley_Methodist_Church_-_geograph.org.uk_-_3422283.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: chapel demolition.
- [Start of demolition of St Marys church, Hunslet (geograph 6115507).jpg](https://commons.wikimedia.org/wiki/File:Start_of_demolition_of_St_Marys_church,_Hunslet_(geograph_6115507).jpg) - CC BY-SA 2.0, 1024x768. Angle/shows: start of church demolition.

Game camera to match: 1.5 tower-heights back; a side-on shot of the tower dropping; aftermath close-up of pile.

Benchmarks
- Holy Trinity, Bingley (Norman Shaw, 1868): church and tower demolished by explosives on Palm Sunday, 7 April 1974 after the tower cracked in 1973 and foundations proved insufficient; residents evacuated after the tower audibly creaked. **[S]** https://en.wikipedia.org/wiki/Holy_Trinity_Church,_Bingley (no tower height or durations in the article)
- Chichester spire, 1861: 277 ft spire "telescoped in on itself" (see landmark/church). **[S]** https://en.wikipedia.org/wiki/Chichester_Cathedral
- Church demolition by machine is documented in Commons series (St Peter's, Wesley Methodist, St Mary Hunslet); no quantitative source.
- Quantitative church-implosion data (duration, pile height, ejecta): **not found** (gap).

Tells
1. A tall stone tower/spire collapses straight down into itself with a puff of dust, not tipping; a spire that topples intact is wrong.
2. Church rubble is ashlar blocks, roof timbers and slates; lead flashing and tracery stone separate.
3. Nave gable walls fall outward as panels; the roof trusses come down first when walls lose restraint.

## collapse/progressive-column-loss — progressive collapse after column loss

Reference media
- [Ronan Point collapse closeup.jpg](https://commons.wikimedia.org/wiki/File:Ronan_Point_collapse_closeup.jpg) - CC BY-SA 2.0, 538x800. Angle/shows: the collapsed corner. — local: `refs/collapse-progressive-column-loss/01.jpg`
- [Tower block collapse. Canning Town (geograph 2540469).jpg](https://commons.wikimedia.org/wiki/File:Tower_block_collapse._Canning_Town_(geograph_2540469).jpg) - CC BY-SA 2.0, 566x800. Angle/shows: Ronan Point collapse, portrait. — local: `refs/collapse-progressive-column-loss/05.jpg`
- [Wtc7 collapse progression.png](https://commons.wikimedia.org/wiki/File:Wtc7_collapse_progression.png) - Public domain, 1107x730. Angle/shows: NIST plan-view diagram of damage and collapse (public domain). — local: `refs/collapse-progressive-column-loss/02.png`
- [NIST 7 WTC Exterior buckling.jpg](https://commons.wikimedia.org/wiki/File:NIST_7_WTC_Exterior_buckling.jpg) - Public domain, 1498x978. Angle/shows: NIST illustration of exterior buckling (public domain). — local: `refs/material-steel/02.jpg`
- [WTC 7 aerial photo.jpg](https://commons.wikimedia.org/wiki/File:WTC_7_aerial_photo.jpg) - Public domain, 1013x766. Angle/shows: debris from the collapse, aerial (public domain). — local: `refs/collapse-progressive-column-loss/04.jpg`
- [WTC Building 7 Collapse 001.gif](https://commons.wikimedia.org/wiki/File:WTC_Building_7_Collapse_001.gif) - CC0, 490x360. Angle/shows: animated GIF of the collapse (CC0).

Game camera to match: elevation showing the failed bay and floors above; interior cutaway of a column line.

Benchmarks
- Ronan Point (16 May 1968, ~5:45 am): gas explosion in flat 90 on the 18th floor blew out the load-bearing flank wall; the floors above (living-room portions of the SE units) collapsed downward in a chain, 4 died at the time (+1 later). **[S]** https://en.wikipedia.org/wiki/Ronan_Point
- Post-1968 regulations required 34 kPa (4.9 psi) resistance in new buildings; existing 17 kPa. **[S]** same URL
- WTC 7 (fire-induced, not demolition): 47 storeys, collapse at 5:20:52 pm after ~7 hours of fire; visible north-face descent 5.4 s, 40 % longer than the 3.9 s free fall; stage 1 (0-1.75 s) slower than g, stage 2 (1.75-4.0 s) free fall, stage 3 (4.0-5.4 s) decelerating. **[S]** https://www.nist.gov/world-trade-center-investigation/study-faqs/wtc-7-investigation
- NIST final report: free-fall over ~8 stories (32 m / 105 ft) for ~2.25 s. **[Q]** https://www.nist.gov/world-trade-center-investigation/study-faqs/wtc-7-investigation (as summarised in a search; the fetched FAQ gave the stage timings above)
- Alternate-path design method removes one vertical element at a time; the GSA method is based on UFC 4-023-03. **[Q]** https://www.gsa.gov/system/files/Progressive_Collapse_2016.pdf
- Dynamic amplification factor about 2.0 under sudden (step) column removal in elastic response, often conservative for ductile RC frames. **[Q]** https://www.sciencedirect.com/science/article/abs/pii/S0093641309001566
- Cardington: 8-storey steel frame, catenary action of restrained beams after ~800 C; local buckling of bottom flanges near ends. **[Q]** https://www.researchgate.net/publication/222000578_An_analysis_of_the_global_structural_behaviour_of_the_Cardington_steel-framed_building_during_the_two_BRE_fire_tests

Tells
1. Initiation should be local and slow: the bay above a lost column sags for seconds before the failure propagates; the game must not either hold forever or jump instantly.
2. Propagation follows load paths and weakest ties (panel joints at Ronan Point, connections in steel); it stops when ties/catenary can carry the load.
3. When it does run away, the final descent approaches free fall for some floors (WTC 7 2.25 s), preceded by seconds of slower deformation: a uniform 0.7g descent from t=0 is wrong.
4. Debris pile is compact (footprint), not spread like a felled tree.

## collapse/wrecking-ball-terrace — wrecking-ball demolition of brick terraces

Reference media
- [Abrissbirne.jpg](https://commons.wikimedia.org/wiki/File:Abrissbirne.jpg) - CC BY-SA 3.0, 1200x1600. Angle/shows: wrecking ball at an old mill, side view, portrait.
- [Transbay Terminal Demolition - with wrecking ball (5235388469).jpg](https://commons.wikimedia.org/wiki/File:Transbay_Terminal_Demolition_-_with_wrecking_ball_(5235388469).jpg) - CC BY-SA 2.0, 5359x3260. Angle/shows: large building, ball on crane. — local: `refs/collapse-wrecking-ball-terrace/03.jpg`
- [Wrecking Ball - old Physicians Hospital New Orleans demolition, New Orleans 2006.jpg](https://commons.wikimedia.org/wiki/File:Wrecking_Ball_-_old_Physicians_Hospital_New_Orleans_demolition,_New_Orleans_2006.jpg) - CC BY 2.0, 1784x1398. Angle/shows: ball mid-swing. — local: `refs/collapse-wrecking-ball-terrace/01.jpg`
- [Great Lakes hospital building demo (14 May 13) 1 (8741989408).jpg](https://commons.wikimedia.org/wiki/File:Great_Lakes_hospital_building_demo_(14_May_13)_1_(8741989408).jpg) - CC BY 2.0, 4592x3056. Angle/shows: crane and ball, US Navy photo (CC BY 2.0). — local: `refs/collapse-wrecking-ball-terrace/04.jpg`
- [Jayne Building destruction circa 1957.jpg (6b045a48-67cd-4827-8d26-61236644d847).jpg](https://commons.wikimedia.org/wiki/File:Jayne_Building_destruction_circa_1957.jpg_(6b045a48-67cd-4827-8d26-61236644d847).jpg) - Public domain, 2100x1500. Angle/shows: eight-storey building partly demolished by crane (public domain).
- [Wrecking ball.jpg](https://commons.wikimedia.org/wiki/File:Wrecking_ball.jpg) - CC BY-SA 2.0, 2381x1905. Angle/shows: ball in use on the Rockwell building. — local: `refs/collapse-wrecking-ball-terrace/02.jpg`
- Category: https://commons.wikimedia.org/wiki/Category:Wrecking_balls

Game camera to match: 20-30 m from the wall, crane in frame so ball swing arc and wall are visible; close view of a wall face taking the hit.

Benchmarks
- Ball masses 450-5,400 kg (1,000-12,000 lb); modern pear shape with top cut off; forged not cast; largely replaced by hydraulic and long-reach excavators. **[S]** https://en.wikipedia.org/wiki/Wrecking_ball
- Medium-duty balls for brick walls and slabs: 680-1,360 kg (1,500-3,000 lb) in a trade listing. **[Q]** https://www.alibaba.com/product-insights/demolition-wrecking-ball.html (weak commercial source)
- Methods: swing (pendulum, secondary rope pulls the ball to the crane cab), drop, ramming. **[Q]** https://en.wikipedia.org/wiki/Wrecking_ball
- Brick unit: 215 x 102.5 x 65 mm; 9-inch (225 mm) party/external walls in byelaw terraces (see common/terrace). **[S]**
- Number of swings per wall, ball speed, debris throw: not sourced (gap).

Tells
1. A swinging ball opens a hole and pulls a wedge of bricks; the wall then falls in chunks along cracks, not as a single slab.
2. The ball is light against a whole wall (trade listing: 0.7-1.4 t for brick work), so walls take repeated hits and fail progressively, not in one blow.
3. Party walls left standing: the next house's wall is exposed with joist pockets and plaster.
4. Bricks mostly survive intact; mortar dust plumes.

## collapse/excavator — excavator demolition

Reference media
- [Erith high reach demolition excavator (geograph 7696618).jpg](https://commons.wikimedia.org/wiki/File:Erith_high_reach_demolition_excavator_(geograph_7696618).jpg) - CC BY-SA 2.0, 4802x3601. Angle/shows: high-reach machine before demolition. — local: `refs/collapse-excavator/02.jpg`
- [High reach excavator demolishing former hotel - geograph.org.uk - 4851905.jpg](https://commons.wikimedia.org/wiki/File:High_reach_excavator_demolishing_former_hotel_-_geograph.org.uk_-_4851905.jpg) - CC BY-SA 2.0, 800x600. Angle/shows: excavator on a hotel, UK. — local: `refs/collapse-excavator/03.jpg`
- [Specialist High Reach Excavator Demolishing the Stadium.jpg](https://commons.wikimedia.org/wiki/File:Specialist_High_Reach_Excavator_Demolishing_the_Stadium.jpg) - CC BY-SA 3.0, 1024x768. Angle/shows: stand demolition.
- [Demolition of stand with Specialist high reach excavator.jpg](https://commons.wikimedia.org/wiki/File:Demolition_of_stand_with_Specialist_high_reach_excavator.jpg) - CC BY-SA 3.0, 3264x2448. Angle/shows: stand demolition. — local: `refs/collapse-excavator/01.jpg`
- [Caterpillar 5080 Demolition High Reach Excavator (Caluire-et-Cuire) August 2022.jpg](https://commons.wikimedia.org/wiki/File:Caterpillar_5080_Demolition_High_Reach_Excavator_(Caluire-et-Cuire)_August_2022.jpg) - CC0, 4032x3024. Angle/shows: Cat 5080, 2022 (CC0). — local: `refs/collapse-excavator/04.jpg`
- [Long reach excavator in Rosslyn (full).jpg](https://commons.wikimedia.org/wiki/File:Long_reach_excavator_in_Rosslyn_(full).jpg) - CC BY-SA 3.0, 3648x2736. Angle/shows: long reach demolition. — local: `refs/collapse-excavator/05.jpg`
- Categories: https://commons.wikimedia.org/wiki/Category:Long_reach_excavators ; https://commons.wikimedia.org/wiki/Category:Building_demolition_in_the_United_Kingdom

Game camera to match: 30-50 m from base looking up the boom to the attachment; a cab-side view.

Benchmarks
- Long/high reach excavators: maximum reach up to 48 m (2016) and up to 67 m (2017) for ultra-high-reach demolition machines. **[S]** https://en.wikipedia.org/wiki/Long_reach_excavator
- Not suited to high side twisting forces from demolition attachments; instability at large operating distances; electronic cut-offs limit radius. **[S]** same URL
- Attachments: crushers/pulverisers for RC, shears (LaBounty shears fit 26,000-210,000 lb machines). **[Q]** https://www.equipmentworld.com/attachments/article/15289945/22-demolition-attachments-for-construction-equipment
- Wikimedia: high reach excavator demolishing former hotel and stadium stands (see media).

Tells
1. Machine works top-down and pulls material toward itself; debris lands in a controlled pile at the wall base.
2. Concrete is crushed and rebar cut by shear; long-reach boom flex and slow speed.
3. Speed: multi-day process; the sim should not clear a floor per second.

## collapse/column-cuts — thermite / cutting-charge column cuts

Reference media
- [Scintille di una lancia termica.jpg](https://commons.wikimedia.org/wiki/File:Scintille_di_una_lancia_termica.jpg) - CC BY-SA 4.0, 4254x3194. Angle/shows: thermal lance sparks on a building site (real cutting analogue). — local: `refs/collapse-column-cuts/01.jpg`
- [Thermal lance.2004-8-4.jpg](https://commons.wikimedia.org/wiki/File:Thermal_lance.2004-8-4.jpg) - CC BY-SA 3.0, 1026x777. Angle/shows: thermal lance in operation.
- [ThermiteReaction.jpg](https://commons.wikimedia.org/wiki/File:ThermiteReaction.jpg) - CC BY-SA 3.0, 2095x2322. Angle/shows: thermite reaction (laboratory scale). — local: `refs/collapse-column-cuts/02.jpg`
- [Thermite skillet.jpg](https://commons.wikimedia.org/wiki/File:Thermite_skillet.jpg) - CC BY-SA 2.5, 1024x682. Angle/shows: ~110 g of thermite mix burning. — local: `refs/collapse-column-cuts/03.jpg`

Game camera to match: 2-3 m from a column at chest height for the cut; a wide shot for the charge line.

Benchmarks
- Linear cutting charges sever mild steel up to 80 mm thick with plastic explosive; twice that with opposing pairs. **[Q]** https://www.tacticalelectronics.com/product/dioplex/
- Copper liner typically 1 mm in an inverted-V; some designs 7 mm copper. **[Q]** https://journals.sagepub.com/doi/10.1177/1687814017729089 (fetch returned 403)
- Metal-jacketed LSC core load 300-2,000 grains per foot (about 64-425 g/m by my conversion [D]; the search summary's "460-3,090 g/m" is a mis-conversion). **[Q]** https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9534874
- Kosciuszko: 944 linear shaped charges on a steel truss bridge. **[S]** https://www.controlled-demolition.com/explosives-demolition/projects/kosciuszko-bridge/
- Thermite (Linear Thermite Charge, Battelle patent): thermite jet cuts steel and concrete; normal reaction about 4,000 F, oxygen-assisted 10,000-16,000 F; device studs onto the column and remains attached. **[Q]** https://patents.google.com/patent/US7555986B2/en
- Documented use of thermite to demolish steel-frame buildings: none found; a forum review found no cited example of a high-rise brought down with thermite. **[S]** https://www.metabunk.org/threads/modern-uses-of-thermite-for-demolition-and-their-applicability-to-the-wtc.2870/
- Burn time per column section: not sourced (gap).

Tells
1. Cutting charges produce a clean angled cut in milliseconds with a bang; thermite is a slow burn (seconds to minutes) with molten iron and sparks; the game's tool should feel different.
2. Cut edge: sheared/molten smooth face with a slag lip; column drops on the cut plane and the remaining upper section kicks.
3. Only weakened columns fail; the frame above must have a way to go.

## collapse/bridge-span — bridge span demolition

Reference media
- [K-bridge north approach broken jeh.jpg](https://commons.wikimedia.org/wiki/File:K-bridge_north_approach_broken_jeh.jpg) - CC BY-SA 4.0, 4607x3071. Angle/shows: Kosciuszko: collapsed old approach. — local: `refs/collapse-bridge-span/01.jpg`
- [K-bridge old north pylon hammered jeh.jpg](https://commons.wikimedia.org/wiki/File:K-bridge_old_north_pylon_hammered_jeh.jpg) - CC BY-SA 4.0, 4176x3131. Angle/shows: Kosciuszko: hammer knocking away the old pylon. — local: `refs/collapse-bridge-span/02.jpg`
- [Sagamore Pkwy Bridge demolition.jpg](https://commons.wikimedia.org/wiki/File:Sagamore_Pkwy_Bridge_demolition.jpg) - CC BY 4.0, 1435x606. Angle/shows: explosive demolition of a steel span, side view. — local: `refs/collapse-bridge-span/03.jpg`
Videos:
- Old Kosciuszko Bridge implosion (1 Oct 2017), Euronews: https://www.euronews.com/video/2017/10/01/new-york-old-kosciuszko-bridge-blown-to-pieces-in-controlled-demolition
- UrbanTech main-span demolition page: https://www.urbantechusa.com/kociuszko-bridge-demolition
- ArchDaily 360 video: https://www.archdaily.com/880858/whatsapp:/send

Game camera to match: side-on from the bank at span level; a 45-degree end view at deck height.

Benchmarks
- Kosciuszko Bridge (old): 22-span steel bridge, 21 approach spans dropped in one event on 1 Oct 2017 at 8 am; 22 million lb steel; 944 linear shaped charges; method "energetic felling"; 5 ft (1.5 m) from new piers; adjacent cemetery 60 ft; monitoring wells 23 ft. **[S]** https://www.controlled-demolition.com/explosives-demolition/projects/kosciuszko-bridge/
- Timing: hundreds of charges fired within half a second, bridge on the ground half a second later. **[Q]** https://www.amny.com/nyc-transit/old-kosciuszko-bridge-demolition-this-weekend-1-14296678/ (result set; also Route Fifty)

Tells
1. Spans should drop nearly as rigid frames (1 s) then fold on impact, not slump slowly.
2. Truss members buckle in compression and tear at connections on impact; pile is a jumble of long members.
3. Severed member ends show the cut, not a random tear.

---

# D. Materials

## material/brick — brick masonry fracture and rubble

Reference media
- [Piles of bricks - Grand Prospect Hall demolition site - March 2022.jpg](https://commons.wikimedia.org/wiki/File:Piles_of_bricks_-_Grand_Prospect_Hall_demolition_site_-_March_2022.jpg) - CC BY-SA 4.0, 4032x2268. Angle/shows: brick piles at a demolition site. — local: `refs/material-brick/01.jpg`
- [Demolished houses and rubble (6466332339).jpg](https://commons.wikimedia.org/wiki/File:Demolished_houses_and_rubble_(6466332339).jpg) - No restrictions, 4000x4149. Angle/shows: rubble of demolished houses. — local: `refs/material-brick/02.jpg`
- [Newcastle West End demolition (6466326831).jpg](https://commons.wikimedia.org/wiki/File:Newcastle_West_End_demolition_(6466326831).jpg) - No restrictions, 4000x4011. Angle/shows: terrace demolition rubble. — local: `refs/material-brick/03.jpg`
- [Collapse of Unreinforced Masonry Buildings, Iran (Persia) - 1990 Manjil Roudbar Earthquake.jpg](https://commons.wikimedia.org/wiki/File:Collapse_of_Unreinforced_Masonry_Buildings,_Iran_(Persia)_-_1990_Manjil_Roudbar_Earthquake.jpg) - Public domain, 751x498. Angle/shows: earthquake collapse of URM (public domain). — local: `refs/material-brick/04.jpg`
- [Partial collapse of the city walls - geograph.org.uk - 827174.jpg](https://commons.wikimedia.org/wiki/File:Partial_collapse_of_the_city_walls_-_geograph.org.uk_-_827174.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: brick wall partial collapse.
- [Collapsed barn, Read's Rest - geograph.org.uk - 584397.jpg](https://commons.wikimedia.org/wiki/File:Collapsed_barn,_Read%27s_Rest_-_geograph.org.uk_-_584397.jpg) - CC BY-SA 2.0, 640x480. Angle/shows: collapsed flint/brick wall close-up.
- Categories: https://commons.wikimedia.org/wiki/Category:Debris ; https://commons.wikimedia.org/wiki/Category:Stacks_of_bricks ; https://commons.wikimedia.org/wiki/Category:Collapsed_buildings

Benchmarks
- Brick 215 x 102.5 x 65 mm; 225 x 112.5 x 75 mm working size; 3 courses = 225 mm. **[S]** https://www.imperialbricks.co.uk/guidance/standard-brick-size-in-the-uk/
- Unreinforced masonry walls in earthquakes fail out-of-plane by overturning, one-way bending or two-way bending; in-plane by sliding shear, diagonal cracking or flexure; walls not tied to cross-walls fail first. **[Q]** https://www.iitk.ac.in/nicee/wcee/article/13_1968.pdf ; https://www.researchgate.net/figure/Typical-failure-modes-of-unreinforced-masonry-walls-subjected-to-in-plane-loads-a_fig1_255589344
- Key parameters for out-of-plane capacity: aspect ratio, restraint at the top, thickness, vertical load, tensile/compressive strength. **[Q]** https://www.iitk.ac.in/nicee/wcee/article/14_05-04-0032.PDF
- ASARCO brick stack debris: ~2.5 million bricks (see collapse/chimney-felling). **[S]** https://www.controlled-demolition.com/explosives-demolition/projects/asarco-chimney/
- Material property references (no numbers extracted): LLNL-TR-417646 https://www.osti.gov/servlets/purl/966219 ; Brick Industry Association TN 3A https://www.gobrick.com/media/file/3a-brick-masonry-material-properties.pdf
- Fragment-size distributions of blast/machine brick rubble: not sourced. (Search returned recycled-aggregate and processed-waste gradings which are not comparable; do not use them for blast rubble.)

Tells
1. Cracks follow the mortar joints in stair-stepped diagonals; whole bricks separate from bricks with little breakage.
2. Rubble is mostly whole bricks and half-bricks with mortar attached, plus dust; large flat slab chunks of wall are the classic fake.
3. Wall edges left after collapse show toothed (racking) courses.
4. Piles slump to irregular slopes with no perfect right angles or flat faces.

## material/rc — reinforced concrete fracture with exposed rebar

Reference media
- [Fractured reinforced concrete column.JPG](https://commons.wikimedia.org/wiki/File:Fractured_reinforced_concrete_column.JPG) - Public domain, 1200x1600. Angle/shows: fractured RC column (public domain). — local: `refs/material-rc/04.jpg`
- [Broken bollard with rebar, aug 21.jpg](https://commons.wikimedia.org/wiki/File:Broken_bollard_with_rebar,_aug_21.jpg) - CC BY-SA 4.0, 3024x4032. Angle/shows: exposed rebar, London. — local: `refs/material-rc/01.jpg`
- [Broken concrete parking chock with exposed rebar.jpg](https://commons.wikimedia.org/wiki/File:Broken_concrete_parking_chock_with_exposed_rebar.jpg) - CC BY-SA 3.0, 4032x3024. Angle/shows: exposed rebar close-up. — local: `refs/material-rc/02.jpg`
- [Duzce 1999 earthquake damage Bilham 883.jpg](https://commons.wikimedia.org/wiki/File:Duzce_1999_earthquake_damage_Bilham_883.jpg) - Public domain, 800x681. Angle/shows: earthquake damage to five-storey concrete bank building (public domain).
- [CLOSE-UP VIEW OF SEGMENT OF DETERIORATING CURB SHOWING EXPOSED REBAR, LOOKING NORTHEAST - Escalante River B...](https://commons.wikimedia.org/wiki/File:CLOSE-UP_VIEW_OF_SEGMENT_OF_DETERIORATING_CURB_SHOWING_EXPOSED_REBAR,_LOOKING_NORTHEAST_-_Escalante_River_Bridge,_Spanning_Escalante_River_at_State_Route_12,_9.5_miles_East_of_HAER_UTAH,9-ESCA.V,1-10.tif) - Public domain, 5000x4003. Angle/shows: HAER: exposed rebar. — local: `refs/material-rc/03.jpg`

Benchmarks
- Eurocode 2 nominal cover: 20 mm for internal dry (XC1), 30 mm or more for external/aggressive exposure, recommended range 25-50 mm; minimum bar spacing the greater of 20 mm, bar diameter or aggregate size + 5 mm; column ties within 150 mm. **[Q]** https://eurocodeapplied.com/design/en1992/concrete-cover ; https://www.concretecentre.com/Codes/Eurocode-2/Detailing.aspx
- 180 m chimney (C30 RC): notch fractured and closed over 4.5 s with 8.3 m sit-down. **[S]** https://pmc.ncbi.nlm.nih.gov/articles/PMC10346864/
- Concrete rubble bulking factor 1.25-1.5. **[Q]** https://tradecalculator.co.uk/general/rubble-removal-calculator/
- Concrete tension/compression ratio and rebar yield: not independently sourced here (gap).

Tells
1. Concrete spalls away from rebar leaving a few tens of mm cover chunks; bars remain continuous and bent between slab pieces.
2. Fracture surface shows aggregate; broken faces are irregular, not planar.
3. Slabs hang from bars (dangling/tied) rather than falling free.
4. Column failures form a plastic hinge with crushed concrete bulging and buckled bars.

## material/timber — timber failure (splintering, charring)

Reference media
- [Splintered wood, Mullaghmore - geograph.org.uk - 7142056.jpg](https://commons.wikimedia.org/wiki/File:Splintered_wood,_Mullaghmore_-_geograph.org.uk_-_7142056.jpg) - CC BY-SA 2.0, 1024x768. Angle/shows: splintered wood.
- [Charred wooden beam from the original White House burned down in the War of 1812.jpg](https://commons.wikimedia.org/wiki/File:Charred_wooden_beam_from_the_original_White_House_burned_down_in_the_War_of_1812.jpg) - Public domain, 500x409. Angle/shows: charred beam (public domain). — local: `refs/material-timber/01.jpg`
- [SECOND FLOOR, CHARRED BEAMS IN SOUTH END (4' x 5' copy negative) - Governors Island, New York Arsenal, Stor...](https://commons.wikimedia.org/wiki/File:SECOND_FLOOR,_CHARRED_BEAMS_IN_SOUTH_END_(4%27_x_5%27_copy_negative)_-_Governors_Island,_New_York_Arsenal,_Storehouse_No._1,_New_York_Harbor_near_Andes_Road,_New_York,_New_York_County_HABS_NY,31-GOVI,6B-6.tif) - Public domain, 5000x3993. Angle/shows: HABS: charred beams. — local: `refs/material-timber/02.jpg`
- [St. Oswald's Church, Worleston after the fire - geograph.org.uk - 276016.jpg](https://commons.wikimedia.org/wiki/File:St._Oswald%27s_Church,_Worleston_after_the_fire_-_geograph.org.uk_-_276016.jpg) - CC BY-SA 2.0, 640x427. Angle/shows: roof timbers after the fire.
- [Fire behavior in mass timber structures (20241016-FS-DP-1032).jpg](https://commons.wikimedia.org/wiki/File:Fire_behavior_in_mass_timber_structures_(20241016-FS-DP-1032).jpg) - Public domain, 3024x4032. Angle/shows: US Forest Service mass-timber test burn (public domain). — local: `refs/material-timber/03.jpg`

Benchmarks
- Softwood one-dimensional charring rate 0.65 mm/min (Eurocode 5), nominal range 0.5-0.65 mm/min; char depth defined by the 300 C isotherm. **[Q]** https://www.researchgate.net/publication/225565230_Assessment_of_Eurocode_5_Charring_Rate_Calculation_Methods
- Bending failure classes for clear timber: simple tension, cross-grain tension, splintering tension (ragged, fibrous under-surface, tough woods), brash tension (clean brittle break), compression, horizontal shear; a beam is expected to fail first by crushing on the compression side in green wood. **[Q]** https://chestofbooks.com/home-improvement/woodworking/Mechanical-Properties-of-Wood/Failures-In-Timber-Beams.html
- Cardington-scale wood cribs used as fire load. **[S]** https://www.steelconstruction.info/Cardington_fire_test_data

Tells
1. Broken timber shows long splinters and fibres on the tension face with a compression crush wrinkle on the other; a clean flat saw-cut break is the fake.
2. Charred timber has an alligator/checked surface and the char layer protects the core; time (minutes) matters.
3. Nails/pegs pull out before the wood breaks in joints.

## material/steel — structural steel buckling and plastic hinges

Reference media
- [Tests of large bridge columns. (1918) (14800440423).jpg](https://commons.wikimedia.org/wiki/File:Tests_of_large_bridge_columns._(1918)_(14800440423).jpg) - No restrictions, 1628x3088. Angle/shows: column buckling tests, 1918. — local: `refs/material-steel/03.jpg`
- [The Bureau of Standards 5,000-Ton Testing Machine at Pittsburgh, 1916.jpg](https://commons.wikimedia.org/wiki/File:The_Bureau_of_Standards_5,000-Ton_Testing_Machine_at_Pittsburgh,_1916.jpg) - Public domain, 1395x1833. Angle/shows: 5,000-ton column test rig, 1916. — local: `refs/material-steel/01.jpg`
- [Steel from Collapsed WTC Towers (5941047922).jpg](https://commons.wikimedia.org/wiki/File:Steel_from_Collapsed_WTC_Towers_(5941047922).jpg) - Public domain, 2048x1536. Angle/shows: NIST: recovered structural steel (public domain). — local: `refs/material-steel/04.jpg`
- [NIST 7 WTC Exterior buckling.jpg](https://commons.wikimedia.org/wiki/File:NIST_7_WTC_Exterior_buckling.jpg) - Public domain, 1498x978. Angle/shows: NIST buckling illustration. — local: `refs/material-steel/02.jpg`

Benchmarks
- Steel retains about 60 % of room-temperature yield strength and 45 % of stiffness at 550 C, about 40 % of yield at 600 C; strength loss begins ~300 C and increases rapidly after 400 C; no recovery above 600 C. **[S]** https://www.steelconstruction.info/Fire_damage_assessment_of_hot_rolled_structural_steelwork
- Cardington: unprotected beams to 1100 C, atmospheric gas over 1200 C, no collapse; restrained beams pass from compression to catenary tension; bottom-flange local buckling near ends. **[S]** https://www.steelconstruction.info/Cardington_fire_test_data ; **[Q]** https://www.researchgate.net/publication/222000578_An_analysis_of_the_global_structural_behaviour_of_the_Cardington_steel-framed_building_during_the_two_BRE_fire_tests
- Eurocode 3 Class 1 sections can form plastic hinges with the rotation capacity required for plastic analysis; classes limit local buckling. **[Q]** https://www.steelconstruction.info/Member_design
- Eurocode 3 reduction factors (0.47 at 600 C, 0.23 at 700 C) and rotation capacity numbers: not sourced (gap; NIST TN 1714 PDF could not be parsed).

Tells
1. Steel sags and twists before it breaks; beams show mid-span sag and flange/web local buckling near supports.
2. Ends are torn or sheared at bolts/welds; whole members remain long and bent.
3. In fire, deformation begins at ~550 C after minutes; a sudden snap at first heating is wrong.
4. Plastic hinges show a kink, not a smooth arc.

## material/glass — glass breakage, annealed vs tempered

Reference media
- [Broken window glass in Esbjerg, 1.jpg](https://commons.wikimedia.org/wiki/File:Broken_window_glass_in_Esbjerg,_1.jpg) - CC BY-SA 2.0, 4000x3000. Angle/shows: broken window glass on the ground. — local: `refs/material-glass/01.jpg`
- [Broken window glass in Esbjerg, 3.jpg](https://commons.wikimedia.org/wiki/File:Broken_window_glass_in_Esbjerg,_3.jpg) - CC BY-SA 2.0, 4000x3000. Angle/shows: broken window glass, another. — local: `refs/material-glass/02.jpg`
- [Broken-plate-glass-window-fisher-body-21-detroit.jpg](https://commons.wikimedia.org/wiki/File:Broken-plate-glass-window-fisher-body-21-detroit.jpg) - CC BY-SA 4.0, 1500x1000. Angle/shows: large broken plate-glass window. — local: `refs/material-glass/03.jpg`
- [Shattered light fixture 3.jpg](https://commons.wikimedia.org/wiki/File:Shattered_light_fixture_3.jpg) - CC0, 5134x3327. Angle/shows: shattered glass fixture (CC0). — local: `refs/material-glass/04.jpg`
Note: no Commons photo of a tempered-vs-annealed comparison was found; the listed files show annealed plate/window breakage only.

Benchmarks
- EN 12150-1 fragmentation: punch test on a 1100 x 360 mm sample at the mid-point of the longest edge; fragments counted in a 50 x 50 mm area 3-5 minutes after breakage. **[S]** https://www.glassonweb.com/article/counting-fragments-tempered-glass-fragmentation-test
- Minimum count of 40 particles per 50 x 50 mm for 4-12 mm tempered glass. **[Q]** https://www.fortemp.com/news/counting-of-fragments-in-tempered-glass-fragmentation-test
- Annealed glass breaks into large, jagged, sharp shards; tempered into small blunt pieces; heat-strengthened in between (larger shards). **[Q]** https://research.tue.nl/en/publications/strength-and-fracture-behaviour-of-annealed-and-tempered-float-gl/
- Impact on window glass gives radial cracks from the impact point and concentric cracks between them. **[Q]** https://forensicfield.blog/glass-fractures-their-types/
- Glass tensile strength (annealed ~40 MPa): not independently sourced (gap).

Tells
1. Annealed: radial star cracks, then a few big triangular/wedge shards, with sharp edges; tempered: whole pane becomes small ~cubic granules in one instant.
2. Sheets pull out of frames in large pieces during a collapse; large annealed shards slide and hang.
3. Fragment count: an annealed pane shattering into 200 identical squares is the fake.

## material/dust — dust clouds

Reference media
- [Dust Cloud (363692640).jpg](https://commons.wikimedia.org/wiki/File:Dust_Cloud_(363692640).jpg) - CC BY 2.0, 1600x1066. Angle/shows: implosion dust cloud, New Haven Coliseum. — local: `refs/collapse-steel-highrise-implosion/05.jpg`
- [Dust cloud (363692743).jpg](https://commons.wikimedia.org/wiki/File:Dust_cloud_(363692743).jpg) - CC BY 2.0, 1600x1066. Angle/shows: same implosion, later frame. — local: `refs/material-dust/03.jpg`
- [Dust Cloud (363692552).jpg](https://commons.wikimedia.org/wiki/File:Dust_Cloud_(363692552).jpg) - CC BY 2.0, 1600x1066. Angle/shows: same implosion, earlier frame. — local: `refs/material-dust/04.jpg`
- [Demolition dust coventry 14n07.jpg](https://commons.wikimedia.org/wiki/File:Demolition_dust_coventry_14n07.jpg) - CC BY-SA 4.0, 2592x1944. Angle/shows: demolition dust cloud. — local: `refs/material-dust/01.jpg`
- [The dust cloud rolls in - geograph.org.uk - 4679113.jpg](https://commons.wikimedia.org/wiki/File:The_dust_cloud_rolls_in_-_geograph.org.uk_-_4679113.jpg) - CC BY-SA 2.0, 1200x803. Angle/shows: dust cloud rolling in.
- [Démolition des cheminées de la Raffinerie de Collombey 09 - Nuage de poussière après l'effondrement.jpg](https://commons.wikimedia.org/wiki/File:D%C3%A9molition_des_chemin%C3%A9es_de_la_Raffinerie_de_Collombey_09_-_Nuage_de_poussi%C3%A8re_apr%C3%A8s_l%27effondrement.jpg) - CC BY-SA 4.0, 7591x3796. Angle/shows: dust cloud after two chimneys fell. — local: `refs/material-dust/02.jpg`

Benchmarks
- 22-storey Baltimore implosion: downwind peak PM10 54,000-589 ug/m3 across 100-1130 m, 3000-fold and 20-fold above pre-implosion at 100 m and 1130 m; most sites back to background within 15 min (one study reports 20 min). **[Q]** https://www.tandfonline.com/doi/abs/10.1080/10473289.2003.10466275 (abstract via search; fetch was 403)
- Hudson's cloud: brown-grey cloud estimated ~300 ft high (the building was 439 ft); reached Jefferson Avenue, several blocks. **[Q]** https://www.fox2detroit.com/news/hudsons-building-implosion-25-years-since-the-dust-cloud-engulfed-the-city-of-detroit
- Kingdome roof collapsed "into a billowing dust cloud in less than 20 seconds". **[Q]** https://www.kiro7.com/sports/25-years-ago-today-kingdome-implodes-2000/WALBGHWY6BFUHBSCHGS7W3TIHQ/
- El Paso stack demolition used 26 misters (500,000 gal) to suppress dust. **[Q]** https://www.statesman.com/story/news/2013/04/13/iconic-el-paso-smelter-chimneys-demolished/9939594007/
- Implosion PM2.5 contained gypsum and calcium carbonate (drywall and cement dust). **[Q]** https://pubmed.ncbi.nlm.nih.gov/16878592
- Fragment size distributions: not sourced (gap).

Tells
1. Dust starts at the moment of impact of each floor/wall, not at the first blast; a cloud that appears before fall is fake.
2. Cloud radius >> debris radius and lasts 10-20 min at ground level before clearing; cloud rolls along the ground as a low density current first, then rises.
3. Colour: grey-white to tan (drywall/cement) not black smoke.
4. Dust thickens near the base and vertically lifts along the falling face.

---

# R. Rigging (ropes, chain, winches, hoists, grapples)

Used by `src/game/tools/lines.ts`, `winch.ts`, `tether.ts`, `hoist.ts`, `grapple.ts`, `src/render/ropes.ts` and the
rigging critic packs. Photos cached under `refs/rigging-<item>/`.

## rigging/pulldown — demolition by pulling with wire ropes

Reference media
- [SaddamStatue.jpg](https://commons.wikimedia.org/wiki/File:SaddamStatue.jpg) - Public domain per Commons (provenance "US military website", re-check before redistributing). Angle/shows: low angle, statue tilted ~45° off its plinth, wire rope + block + chain round the neck, pivoting at the feet. — local: `refs/rigging-pulldown/01.jpg`
- [1871 destruction of the Vendome Column.jpg](https://commons.wikimedia.org/wiki/File:1871_destruction_of_the_Vendome_Column.jpg) - Public domain. Angle/shows: side view, column mid-fall breaking into drum segments. — local: `refs/rigging-pulldown/02.jpg`
- [Colonne-vendôme-Illustration.jpg](https://commons.wikimedia.org/wiki/File:Colonne-vend%C3%B4me-Illustration.jpg) - Public domain. Angle/shows: pull ropes from the column top led to a capstan; the fall. — local: `refs/rigging-pulldown/03.jpg`
- [Démolition des cheminées de la Raffinerie de Collombey 03](https://commons.wikimedia.org/wiki/File:D%C3%A9molition_des_chemin%C3%A9es_de_la_Raffinerie_de_Collombey_03_-_Chute_de_la_chemin%C3%A9e_gauche.jpg) - CC BY-SA 4.0. Angle/shows: chimney rotating ~20° about its base hinge (felling kinematics). — local: `refs/rigging-pulldown/04.jpg`

Benchmarks
- Pulling medium: "a securely anchored winch or plant designed for towing and heavy enough to apply the required tension without sliding or lifting"; horizontal distance from the work to the pulling medium at least **2 × the height of the highest part being pulled**; nobody where a failing rope could strike them; walls cut into sections before pulling, **vertical rebar left uncut until the wall is over** (it is the hinge); chimney clear space ~1.5 × height. **[S]** https://www.safework.nsw.gov.au/__data/assets/pdf_file/0015/52161/Demolition-work-COP.pdf (s.4.13, p.43)
- UK THSP guidance: rope pulling is "attaching ropes, usually of steel, to a structure and pulling the pre-weakened structure to the ground by winch or tracked plant"; a failed pull leaves the structure unsafe. **[S]** https://my.thsp.co.uk/download-guidance.php?id=27 (p.16)
- BS 6187 (older editions, summarised): pulling rope ≥ 16 mm, factor of safety 6, rope flatter than 1 in 2, nobody between the tractor and the building or beside the rope. **[Q]** https://1library.net/article/methods-demolition-bs-code-practice-demolition.zw8eg6lz
- Firdos Square statue (12 m) was pulled over by an M88 recovery vehicle; a cable round the torso was rejected because "if the cable snapped, it might whiplash and kill people", so a chain went round the neck. **[S]** https://en.wikipedia.org/wiki/Firdos_Square_statue_destruction
- Vendôme Column (44 m, 1871): cables, pulleys and a capstan after bevelled cuts at the base; "broke up almost before it reached its bed". **[S]** https://bonjourparis.com/history/gustave-courbet-and-the-fall-of-the-vendome-column/ , https://en.wikipedia.org/wiki/Place_Vend%C3%B4me

Tells
1. A pulled structure hinges at a pre-weakened base and rotates toward the pull; an un-weakened building resists (the code says to cut walls into sections first).
2. The puller stands at least 2 × the height away; lines run shallow (flatter than 1 in 2).
3. Tall masonry breaks into segments during the rotation rather than landing whole.

## rigging/wirerope — steel wire rope, stiffness, snap-back, discard

Reference media
- [Steel wire rope on a drum.jpg](https://commons.wikimedia.org/wiki/File:Steel_wire_rope_on_a_drum.jpg) - CC0. Angle/shows: close-up of ~20 mm rope wraps on a winch drum, lay helix clear. — local: `refs/rigging-wirerope/01.jpg`
- [Close-up of wire rope assembly, Lisbon](https://commons.wikimedia.org/wiki/File:Close-up_of_wire_rope_assembly,_Jardim_da_Funda%C3%A7%C3%A3o_Calouste_Gulbenkian,_Lisbon,_Portugal_julesvernex2.jpg) - CC BY-SA 4.0. Angle/shows: taut thin rope into a swaged fork, lay visible. — local: `refs/rigging-wirerope/02.jpg`
- [Wire rope clamps.jpg](https://commons.wikimedia.org/wiki/File:Wire_rope_clamps.jpg) - CC BY-SA 4.0. Angle/shows: heavy rusty rope on a drum with U-bolt clamps. — local: `refs/rigging-wirerope/03.jpg`
- [Fraying wire rope.jpg](https://commons.wikimedia.org/wiki/File:Fraying_wire_rope.jpg) - CC BY 2.0. Angle/shows: galvanised rope with many broken outer wires sprung out along one section. — local: `refs/rigging-wirerope-broken/01.jpg`
- [Torn apart (15514192401).png](https://commons.wikimedia.org/wiki/File:Torn_apart_(15514192401).png) - CC BY 2.0. Angle/shows: parted rope end, strands broomed. — local: `refs/rigging-wirerope-broken/02.png`

Benchmarks
- 6x36 WS IWRC galvanised: 13 mm 0.691 kg/m, MBL 106.5 kN (1770) / **117.9 kN (1960)**; 16 mm 1.047 kg/m, 161.3 / **178.6 kN**. **[S]** https://steelwirerope.com/wp-content/uploads/2025/02/Datasheet-6x36-Galvanised-WS-IWRC-1.pdf ; cross-check **[S]** https://www.katradis.com/our-products/wire-ropes/standard-wire-ropes/6x36-ws-steel-core-iwrc/
- Apparent modulus 6x36 IWRC 6000 kp/mm² on the nominal area (worked example 28 mm, 200 m, 10 t → 540 mm); constructional stretch 0.25 % at SF 5. **[S]** https://www.certex.co.uk/steel-wire-rope-properties → 58.8 GPa; EA 7.81 MN (13 mm), 11.83 MN (16 mm); elastic strain at MBL 1.51 %. **[D]**
- Rope modulus about half plain steel's; elongation at break 3.2–4.7 %. **[S]** https://www.casar.de/Portals/0/Documents/Brochures/technical-documentation.pdf (p.24)
- Stored energy U = F²L/2EA: 13 mm at MBL over 30 m 26.7 kJ, 16 mm 40.4 kJ; free-end recoil v = F/√(EA·m') ≈ 51 m/s. **[D]**
- Snap-back: synthetic ends up to 800 km/h, wires up to 500 km/h; a rope may recoil past its securing point "to a distance almost equal to the remaining length"; synthetics give little warning. **[S]** https://www.westpandi.com/news-and-resources/loss-prevention-bulletins/snap-back-zones/
- OCIMF/COSWP: treat the whole mooring area as the snap-back danger zone; painted zones give false security; older geometry: recoil up to 200 % and ~20° deviation. **[S]** (secondary) https://www.athinatraining.gr/wp-content/uploads/2024/01/snap-back-zones-training-moments-final.pdf
- Discard: ten broken wires in one lay or five in one strand; kinking, crushing, bird-caging. **[S]** https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.184 ; ISO 4309 example 9 broken wires over 6d. **[S]** https://www.safed.co.uk/publications-home/tc2-machinery-lift-crane/policy-statements-for-download/54-guidance-on-wire-rope-discard-criteria-as-detailed-within-bs-iso-4309-2017/file

Tells
1. Wire rope reads as six strands laid round the core (lay length ~6.5 d), dark grease in the grooves, crowns bright.
2. Failing rope: broken outer wires stick out as short spikes, then strands open (birdcage), then the end brooms.
3. A parted loaded line whips back past its anchor; nobody should stand in line with it.

## rigging/synthetic — nylon kinetic rope, HMPE line, round slings

Reference media
- [LIROS Dyneema hollow.jpg](https://commons.wikimedia.org/wiki/File:LIROS_Dyneema_hollow.jpg) - CC BY-SA 3.0. Angle/shows: macro of grey Dyneema hollow braid, frayed end. — local: `refs/rigging-synthetic/03.jpg`
- [Fishermen with tractors at Caspian Sea.jpg](https://commons.wikimedia.org/wiki/File:Fishermen_with_tractors_at_Caspian_Sea.jpg) - CC BY 2.0. Angle/shows: tractor winch hauling orange synthetic rope (small in frame). — local: `refs/rigging-synthetic/02.jpg`

Benchmarks
- Yankum 7/8" (22 mm) double-braid nylon kinetic rope: MBS 28,600 lb (127.2 kN), stretches "up to 30%". **[S]** https://yankum.com/products/python-kinetic-recovery-rope
- ~20 % elongation in proper use, 30 % at break; size the rope at ~3 × the recovering vehicle's GVW; run in at ≤ 5 mph; ropes "smoothly transfer the kinetic energy". **[S]** https://www.asroffroad.com/kinetic-recovery-rope-info-use/
- Snatch strap ~20 % stretch, laid with ~1 m of slack. **[S]** https://en.wikipedia.org/wiki/Snatch_strap
- Samson AmSteel-Blue 3/8": 0.0506 kg/m, min break 17,600 lb (78.3 kN), elongation 0.96 % at 30 % of break. **[S]** https://www.samsonrope.com/mooring/amsteel--blue → EA ≈ 2.72 MN. **[D]**
- MAIB (Zarga): UHMPE alone ~2 % elongation, "minimal snap-back"; the danger came from an elastic tail. **[S]** https://www.iims.org.uk/maib-releases-safety-warning-following-mooring-line-failure/
- Polyester round slings: 7:1 safety factor. **[S]** https://www.h-lift.com/products/polyester-round-sling-en1492-2

Tells
1. Kinetic rope visibly lengthens under load and gives it back; HMPE barely stretches and, being ~14 × lighter than steel of the same strength, carries little into a recoil.
2. Braided rope shows a diamond weave; cut or overloaded yarns fuzz.

## rigging/chain — grade 80 lifting chain (EN 818-2)

Reference media
- [Chain Block (YS).JPG](https://commons.wikimedia.org/wiki/File:Chain_Block_(YS).JPG) - CC BY-SA 3.0. Angle/shows: chain block on a tripod. — local: `refs/rigging-chain/03.jpg`
- [US Navy 030306-N-5362F-002 fall chains](https://commons.wikimedia.org/wiki/File:US_Navy_030306-N-5362F-002_Airman_Apprentice_Shyhede_Randall_from_Dallas,_Texas,_cleans_the_%27fall_chains%27_used_to_lift_heavy_equipment_such_as_jet_engines.jpg) - Public domain. Angle/shows: hanging load chains. — local: `refs/rigging-chain/02.jpg`

Benchmarks
- 10 mm: pitch 30 mm, WLL 3.15 t, MBF 126 kN, 2.20 kg/m; 13 mm: pitch 39 mm, WLL 5.3 t, MBF 212 kN, 3.70 kg/m; minimum 20 % elongation before failure. **[S]** https://www.h-lift.com/products/grade-80-chain-for-chain-sling-en-818-2
- Chain axial stiffness: not sourced (practically inextensible below proof load = 2.5 × WLL). Gap.

## rigging/hoist — lever hoists and wire-rope pulling hoists

Reference media
- [Tirfor T35 grip puller 01.jpg](https://commons.wikimedia.org/wiki/File:Tirfor_T35_grip_puller_01.jpg) - CC BY 2.0. Angle/shows: Tirfor body, rope, hook and handle. — local: `refs/rigging-leverhoist/01.jpg`
- [Carl Stahl Hebelzug Flaschenzug.jpg](https://commons.wikimedia.org/wiki/File:Carl_Stahl_Hebelzug_Flaschenzug.jpg) - CC BY-SA 3.0 de. Angle/shows: red lever hoist (lever, load chain, hooks). — local: `refs/rigging-leverhoist/02.jpg`
- [Comealong.jpg](https://commons.wikimedia.org/wiki/File:Comealong.jpg) - Public domain. Angle/shows: cable come-along. — local: `refs/rigging-leverhoist/03.jpg`

Benchmarks
- Kito LB032 (3.2 t): pull to lift the rated load **363 N**, load chain 10 × 28 mm, 15 kg, lever 415 mm, load signal at 100–120 % of capacity. **[S]** https://kito.net/files/downloads/lb-oll/manuals/en/OM-L5ZZZZ-CEE-01.pdf
- Yale UNOplus-A 3 t: 20 mm lift per full lever turn, 40 daN handle pull at WLL. **[S]** https://www.cmco.com/globalassets/catalogs--documents/emea/en/yale_unoplus_a_4pages_2021_12_15_wup_en.pdf → 50 turns per metre; ~1.47 m of hand travel per turn, so ~6 mm of chain per ~0.46 m stroke of a 415 mm lever. **[D]**
- Tirfor TU-32: WLL 3,200 daN, 54 kg lever effort, 30 mm rope travel per forward stroke, 16.3 mm rope breaking 16,000 daN, shear-pin overload protection. **[S]** https://www.tractel.com/PIM/Technical%20Data%20Sheets/LH/tirfor/TU%20Series/T2102_EN%20ind01%20TIRFOR%20TU.pdf
- Stroke rate of an operator: not sourced (judgement, 0.7–1.3 strokes/s). Gap.

## rigging/winch — vehicle recovery winches

Reference media
- [JeepLiberty Winch SelfRecovery.JPG](https://commons.wikimedia.org/wiki/File:JeepLiberty_Winch_SelfRecovery.JPG) - CC BY-SA 4.0. Angle/shows: taut wire rope to a tree, people standing aside. — local: `refs/rigging-winch/01.jpg`
- [RA1 tram rescue vehicle Vallila depot winch.jpg](https://commons.wikimedia.org/wiki/File:RA1_tram_rescue_vehicle_Vallila_depot_winch.jpg) - CC BY 4.0. Angle/shows: bumper winch, roller fairlead, wire rope. — local: `refs/rigging-winch/02.jpg`

Benchmarks
- Pierce 18,000 lb hydraulic recovery winch: 23 ft/min max line speed at 15.9 gpm, 19.4:1 two-stage planetary, ½" × 165 ft rope. **[S]** https://www.piercearrowinc.com/products/18000-lb-hydraulic-recovery-winch → 80.1 kN, 0.117 m/s. **[D]**
- Smittybilt 17.5K electric: 77.8 kN on layer 1 (62 % by layer 4); 6.9 m/min with no load, 0.99 m/min at full load. **[S]** https://static.thiecommerce.com/assets/production/smittybilt-gen2-winch-specs/a53f2a49672d517004f322c9cd04af3f.pdf
- A snatch block doubles the pull **[S]** https://www.warn.com/warn-winch-performance-specifications-pulling-capacity-by-layer and halves the speed. **[D]**
- OEM winch ropes break close to the rated pull (11 mm 1960-grade 84.4 kN vs 77.8 kN, 1.08 ×). **[D]**

## rigging/grapple — line throwers, grapnels, powered ascenders

Reference media
- [15th MEU Marines ... 141208-M-ST621-015.jpg](https://commons.wikimedia.org/wiki/File:15th_MEU_Marines_train_in_combined_arms_training_141208-M-ST621-015.jpg) - Public domain. Angle/shows: grapnel mid-throw, trailing line. — local: `refs/rigging-grapnel/01.jpg`
- [20th century folding grapnel anchor unfolded](https://commons.wikimedia.org/wiki/File:20th_century_folding_grapnel_anchor_13_5_kg_66_cm_marked_SAV_Norway_unfolded.jpg) - CC BY 4.0. Angle/shows: four-fluke grapnel, 3/4 view. — local: `refs/rigging-grapnel/02.jpg`

Benchmarks
- Restech PLT pneumatic line thrower: Pick-up Grapple **85 m**, projectiles to 230 m, 200/300 bar. **[S]** https://restech.no/all-products/plt-multi/
- Weapon-launched grapnel hook: 75–100 m, 150 m of line. **[S]** https://www.prc68.com/I/LaunchedGrapnelHook.html
- CMI five-tine steel grappling hook: 1.6 kg, 21.6 cm across, overall MBS 3,900 lb (17.3 kN), each tine 2,000 lb (8.9 kN). **[S]** https://helixoperations.com/products/cmi-grappling-hook
- Atlas APA-4 powered ascender: up to 66 m/min (1.1 m/s), 160 kg standard / 250 kg heavy-duty. **[S]** https://helixoperations.com/Tactical/Products/Motorised-Ascenders/Atlas-Powered-Ascender-APA-4
- Edge bearing of masonry/concrete under one tine: not sourced (judgement 3.5–6 kN). Gap.

---

# Gaps (unsourced or weak)

- Gothic roof pitch; church-implosion duration/pile (Bingley 1974 has no numbers in the source); retail floor-to-floor for Art Deco stores.
- UK riveted truss road-bridge photographs (Commons returned US HAER records only).
- Walk-up flats dimensions and photos; chapel dimensions; Victorian terrace roof pitch and storey height.
- Thermite burn behaviour per column; documented thermite use in building demolition (found none).
- Hudson's and Ocean Tower collapse durations (one source each, conflicting for Hudson).
- Fragment-size distributions for blast rubble (brick or concrete); concrete tension/compression ratio; Eurocode 3 reduction factors and rotation capacity; glass tensile strength; tempered/annealed comparison photographs.
- Wrecking-ball swing counts and ball speeds; debris throw distances for wrecking balls and excavators.
- Rigging: chain axial stiffness; operator stroke rate on a lever hoist; edge bearing under a grapnel tine; a lorry's stall pull on a rope (the vehicle model gives ~31 kN in reverse).
