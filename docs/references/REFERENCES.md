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

# E. Utilities

## utility/water-burst — burst water main, geyser, flooded street

Reference media
- [Burst Water Main in Melbourne July 2019.jpg](https://commons.wikimedia.org/wiki/File:Burst_Water_Main_in_Melbourne_July_2019.jpg) - CC BY-SA 4.0, 4032x3024. Angle/shows: street level over a flooded junction; a brown sheet of water running over the asphalt, standing ripples, the kerb as a dam. — local: `refs/utility-water/01.jpg`
- [Busted main July 2011 in Maryland IMG 1927 (5934154780).jpg](https://commons.wikimedia.org/wiki/File:Busted_main_July_2011_in_Maryland_IMG_1927_(5934154780).jpg) - CC BY 2.0, 5184x3456. Angle/shows: low over the road after a main burst under it: asphalt slabs lifted and scattered, soil and gravel washed out across the carriageway, muddy water. — local: `refs/utility-water/02.jpg`
- [Burst water main - Collier Street - geograph.org.uk - 1696834.jpg](https://commons.wikimedia.org/wiki/File:Burst_water_main_-_Collier_Street_-_geograph.org.uk_-_1696834.jpg) - CC BY-SA 2.0, 960x1280. Angle/shows: across the street at a jet coming out of the road: a narrow white column at the foot opening into a drifting mist plume taller than the two-storey buildings, the street wet all round. — local: `refs/utility-water/03.jpg`
- [Fire hydrant knocked over.jpg](https://commons.wikimedia.org/wiki/File:Fire_hydrant_knocked_over.jpg) - CC BY 2.5, 604x483. Angle/shows: a pillar hydrant sheared at its breakaway flange, lying beside the open stand-pipe (dry: its valve at the main held). — local: `refs/utility-water/04.jpg`
- [(20241231) Berlin Wedding water pipe broke 01.jpg](https://commons.wikimedia.org/wiki/File:(20241231)_Berlin_Wedding_water_pipe_broke_01.jpg) - CC BY-SA 4.0, 4096x3072. Angle/shows: night, street level: a thin sheet of water over the whole road mirroring street lights, the pavement dark and glossy beside it. — local: `refs/utility-water/06.jpg`

Game camera to match: (1) across the street at 10-30 m from the jet, eye height, jet against sky and buildings (ref 03); (2) low over the wet road looking along it (refs 01, 06); (3) close on the break crater (ref 02).

Benchmarks
- 16-inch ductile-iron main (Centennial, CO): water shot "about 50 feet" (15 m) into the air; the rupture was ~2 ft x 10 in; a 25 sq ft piece of asphalt was lifted and moved ~3 ft. **[S]** https://www.denverwater.org/tap/main-break-creates-impressive-geyser
- Reported geysers: 20-30 ft (6-9 m) for a 12-inch main, 60 ft (18 m) for a 24-inch main. **[Q]** https://www.cbsnews.com/amp/pittsburgh/news/arlington-avenue-geyser , https://www.inquirer.com/philly/news/breaking/20100617_Water_main_breaks__becomes_a_geyser_in_N_E__Phila_.html
- UK guaranteed minimum 7 m static head (0.7 bar) at the stop valve; households typically 1.5-3 bar, 3-4 bar good. **[Q]** https://www.ofwat.gov.uk/households/supply-and-standards/water-pressure/
- Exit speed of a jet v = Cv·√(2ΔP/ρ): 3.5 bar → 26 m/s, ideal height ΔP/ρg = 36 m; a 15 m geyser from a 16-inch main is ~40 % of an ideal 3.5 bar head (drag and break-up). **[D]**
- US minimum distribution pressure 35 psi (2.4 bar) at 1.5 gpm per connection (Texas TCEQ). **[S]** https://twri.tamu.edu/news/2020/december/the-physics-of-a-water-main-break/

Tells a harsh critic should check
1. A jet from a main is a coherent white/grey column only for its first few metres, then a mist plume that drifts downwind (ref 03); cotton-ball puffs or a clean tapered cone are wrong.
2. Height must follow pressure: extra breaks on the same network visibly lower every jet (shared supply).
3. Water on the ground is a thin sheet that goes where the ground slopes and stops at kerbs; wet ground is darker and glossy with sky/lamp reflections (refs 01, 06); tents or sheets draped over objects are wrong.
4. A burst under a road brings soil: brown water, washed-out gravel and lifted asphalt (ref 02); a clean blue fountain out of intact pavement is wrong.

## utility/power-fault — arc flash, downed live conductor, transformer fire, blackout

Reference media
- [Electrical arc flash.webm](https://commons.wikimedia.org/wiki/File:Electrical_arc_flash.webm) - CC BY 3.0, 960x720 video. Angle/shows: inside a switch room: the arc lights the whole room violet-white, blowing out detail. — local (poster frame): `refs/utility-power/01.jpg`
- [Hurricane Isaias sparking electrical wires from tree branch Hatboro PA.jpeg](https://commons.wikimedia.org/wiki/File:Hurricane_Isaias_sparking_electrical_wires_from_tree_branch_Hatboro_PA.jpeg) - CC BY-SA 4.0, 4032x3024. Angle/shows: street level, daylight: a small orange-white arc and flame where a branch lies on LV/distribution conductors. — local: `refs/utility-power/02.jpg`
- [Downed power lines in Issaquah, Washington.jpg](https://commons.wikimedia.org/wiki/File:Downed_power_lines_in_Issaquah,_Washington.jpg) - CC BY-SA 4.0, 3968x2976. Angle/shows: night, along the road: conductors hanging from a pole down to the verge and across the carriageway. — local: `refs/utility-power/03.jpg`
- [Downed power line and closed road in Morris County, NJ after a storm at night 01.jpg](https://commons.wikimedia.org/wiki/File:Downed_power_line_and_closed_road_in_Morris_County,_NJ_after_a_storm_at_night_01.jpg) - CC BY 4.0, 3774x2830. Angle/shows: a conductor lying slack across a road from a leaning pole. — local: `refs/utility-power/04.jpg`
- [Transformator on fire.jpg](https://commons.wikimedia.org/wiki/File:Transformator_on_fire.jpg) - CC BY 2.0, 533x800. Angle/shows: a transformer fire seen across a city: a dense black-grey smoke column rising hundreds of metres. — local: `refs/utility-power/05.jpg`
- [Cottingham sub station fire -2535 - panoramio.jpg](https://commons.wikimedia.org/wiki/File:Cottingham_sub_station_fire_-2535_-_panoramio.jpg) - CC BY 3.0, 1200x799. Angle/shows: a substation transformer burning: orange oil flames low in the compound under a rolling black plume. — local: `refs/utility-power/06.jpg`
- [Lechatelierite created by high voltage power line arcing on rocky soil- 2014-02-12 23-02.jpg](https://commons.wikimedia.org/wiki/File:Lechatelierite_created_by_high_voltage_power_line_arcing_on_rocky_soil-_2014-02-12_23-02.jpg) - CC BY-SA 3.0, 2178x1535. Angle/shows: close: fused glassy soil where a downed HV line arced into the ground. — local: `refs/utility-power/07.jpg`

Game camera to match: (1) street level 10-20 m from a pole line, looking along the span (refs 02-04); (2) across a substation compound at 15-30 m (ref 06); (3) wide, the smoke column over the roofs (ref 05).

Benchmarks
- Arc temperatures up to 35,000 °F (19,400 °C); radiant injury out to ~20 ft (6 m); copper expands ~67,000× on vaporising (the arc blast); a 480 V, 20 kA phase-to-phase arc is ~9.6 MW, 1.6 MJ over 10 cycles. **[S]** https://en.wikipedia.org/wiki/Arc_flash
- An arc flash lasts milliseconds to under a second (it burns until protection clears). **[Q]** https://e-hazard.com/arc-flash-temperatures-injuries-a-safety-guide/
- Ground round a downed line may be energised out to ~35 ft (10 m); a downed line "can be completely silent and motionless" and still live, and does not always spark or arc; wet ground widens the zone. **[Q]** https://www.prairielandelectric.com/understanding-step-potential , https://www.flaggerforce.com/blog/stay-safe-when-power-lines-fall-flagger-force/
- Step potential: the voltage between two feet in different voltage zones round a fault into the ground; shuffle away with feet together. **[S]** https://www.eversource.com/residential/safety/electric-safety/downed-power-lines
- LV earth fault through soil: U0/R, e.g. 230 V / 15 Ω ≈ 15 A, far under any feeder fuse's melting current, so a live end on earth stays live. **[D]** (R from src/destruction/electrical.ts R_EARTH)
- Transformer oil: ~60-80 L in a 25 kVA pole unit, 650-800 L in a 500 kVA three-phase distribution transformer. **[Q]** https://transformer4u.com/transformer-oil-capacity-chart-complete-kva-reference-table/ , https://www.yctransformer.com/blog/what-is-the-oil-capacity-of-a-pole-mounted-substation-transformer-if-oil-fill-2131145.html
- High-pressure sodium street lamps cannot restrike hot: 1-2 min (up to 15) before they relight after an interruption, then ~4 min to full output. **[Q]** https://www.ecmweb.com/content/article/20891217/minimize-hid-lighting-system-downtime

Tells a harsh critic should check
1. The flash: blue-violet-white, lights the surroundings for a fraction of a second, then sparks of molten copper arcing down and a grey-brown puff; not a lingering glow.
2. A snapped conductor falls and lies (or dangles) along the ground from its insulator; it does not vanish. A live one on soil may sit quietly or spit small arcs; one touching metal or the other conductor arcs hard until protection clears.
3. Transformer failure: bang and flash, then an oil pool fire low in the compound under a dense black column that lasts (refs 05, 06).
4. Lights on the failed network go out together, after a stutter, and sodium lamps do not come straight back on.

---

# F. Weapons (bank VI ordnance and fire)

Main sources fetched for this section (reused below):
- TM 3-376A *Portable Flame Thrower M2-2* (1944), Gutenberg: https://www.gutenberg.org/files/53669/53669-h/53669-h.htm
- FM 3-06.11 (urban operations) ch. 7: https://www.globalsecurity.org/military/library/policy/army/fm/3-06-11/ch7.htm, and ch. 8: https://www.globalsecurity.org/military/library/policy/army/fm/3-06-11/ch8.htm
- FM 3-23.25 App. A (backblast safety): https://www.globalsecurity.org/military/library/policy/army/fm/3-23-25/appa.htm
- IMAS TNMA 09.30/04, *Fuel Air Explosive (FAE) systems* (2013): https://www.mineactionstandards.org/fileadmin/uploads/imas/Standards/English/TNMA_09.30.04_Ed.1_Am.1.pdf
- Review of empirical concrete impact formulae (IJSCET): https://journal.uthm.edu.my/index.php/IJSCET/article/download/53/12
- Gsponer, *B61-based RNEP* (arXiv, includes an appendix on the Young/Sandia equation): https://arxiv.org/pdf/physics/0510052
- Gibbon, *The Artillerist's Manual* (1860), OCR text: https://archive.org/details/artilleristsman00gibbgoog
- *Ordnance Manual* (US, 1861), OCR text: https://archive.org/details/ordnancemanualfo00unit
- Markova et al. 2020, *Fire Size of Gasoline Pool Fires*: https://pdfs.semanticscholar.org/d183/b7cad3d58312bf50fa48a3cfacd2e24bdcad.pdf

---

## weapon/flamethrower

### Reference media
- `refs/weapon-flamethrower/01.jpg`: https://commons.wikimedia.org/wiki/File:USm2flamethrower.jpg (Public domain, US Army/NARA). Luzon, 1945. A kneeling M2 operator; the backpack tanks and hose are clear. Fuel is burning low across dry vegetation in a wall of bright, ragged flame, with a large column of **black, sooty smoke** rising behind it.
- `refs/weapon-flamethrower/02.jpg`: https://commons.wikimedia.org/wiki/File:Flamethrower-iwo-jima-194502.jpg (Public domain). Iwo Jima, Feb 1945. The operator is moving with the M2 backpack (two fuel tanks with a pressure bottle between them).
- `refs/weapon-flamethrower/03.jpg`: https://commons.wikimedia.org/wiki/File:M9E1-7_flamethrower_tank_group.jpg (Public domain, HQDA). Diagram of the M9E1-7 tank group: one fuel tank with a nitrogen sphere.
- YouTube [Q]: War Dept FB 178 "Flame Thrower Fuels" (1944), which shows thickened and unthickened fuel fired side by side: https://www.youtube.com/watch?v=NAXoz9cA3Z0 ; M2 demonstration: https://www.youtube.com/watch?v=qPxJVuQcV1w ; restored M2-2 firing: https://www.youtube.com/watch?v=g6ZHQY3iRCc

### Benchmarks
- M2-2 fuel capacity: "4 gallons" of fuel, plus void for air or nitrogen [S TM 3-376A]. That is 4 × 3.785 = **15.1 L** [D]. Wikipedia gives two 2 US gal (7.6 L) tanks [S https://en.wikipedia.org/wiki/M2_flamethrower].
- M2-2 pressures: pressure tank 1,700–2,100 psi. Fuel tanks regulated to 350 psi, which is 350 × 6.895 = **2.41 MPa** [S TM; D].
- M2-2 range: liquid (unthickened) fuel "as far as 20 yards" (**18 m**). Thickened fuel **40 yd (37 m)**. Underbrush and wind reduce both [S TM; D]. Wikipedia gives effective 20 m and max 40 m [S wiki].
- M2-2 firing time for a full load: "approximately 8 to 9 seconds" of continuous fire [S TM]. Flow rate ≈ 15.1 L / 8.5 s ≈ **1.8 L/s** [D]. This matches Wikipedia's ~0.5 US gal/s (1.9 L/s) [S wiki].
- Ignition: a cylinder of 5 incendiary charges, each burning 8–12 s [S TM].
- Weight: 43 lb empty; 68–72 lb filled (19.5 kg / 31–33 kg) [S TM; D].
- Thickened fuel recipe: one 5¼ lb can of thickener per 20 US gal of gasoline [S TM]. By mass: 2.38 kg thickener in 75.7 L × ~0.74 kg/L = 56 kg of gasoline, so ≈ **4 %** [D; the gasoline density is my assumption].
- M9 (Vietnam era): one 4¼ US gal (**16 L**) tank; 25 lb empty / 52 lb full; effective range 45–55 m; flow ~0.7 US gal/s (2.6 L/s) [S https://en.wikipedia.org/wiki/M9_flamethrower]. Full-load burn ≈ 16 / 2.6 ≈ **6 s** [D].
- Napalm flame temperature: "800 to 1,200 °C" [S https://en.wikipedia.org/wiki/Napalm]. Hydrocarbon pool flames reach up to 1,400 °C [S Markova 2020].
- Burning on the target: thickened fuel "clings to and burns in or on the target for as long as 6 minutes" [S TM].
- **Gasoline pool burning, measured** [S Markova 2020, Table 2; 20 mm initial depth, 140 s tests]:

| pool area | mass loss rate | mass burning rate m″ | HRR | HRR per area [D] |
|---|---|---|---|---|
| 0.25 m² (D 0.56 m) | 0.0122 kg/s | 0.046–0.049 kg/m²·s | 506–528 kW | ≈ 2.0–2.1 MW/m² |
| 0.66 m² (D 0.92 m) | 0.0349 kg/s | 0.051–0.052 kg/m²·s | 1474–1511 kW | ≈ 2.2–2.3 MW/m² |
| 2.8 m² (D 1.89 m) | 0.0877 kg/s | 0.034 kg/m²·s | 4127 kW | ≈ 1.47 MW/m² |

- Babrauskas large-pool constants for gasoline: m″∞ = **0.055 kg/m²·s** and kβ = **2.1 m⁻¹** [Q https://www.ojp.gov/pdffiles1/nij/grants/238704.pdf, search summary]. The heat of combustion of 43.7 MJ/kg is my recollection and is not sourced. Check: 0.049 kg/m²·s × 43.7 MJ/kg = **2.1 MW/m²**, which agrees with the measured HRR per area [D].
- Regression rate: 0.05 kg/m²·s ÷ 740 kg/m³ = 6.8e-5 m/s ≈ **4 mm/min** of pool depth [D; density assumed]. At that rate a 1 mm splash film lasts only ~15 s, while a napalm gob burns for minutes [D + TM].

### Tells a harsh critic should check
- Thickened fuel travels as a **narrow, arcing, rope-like rod** that stays mostly intact to the target and then splashes and sticks. Unthickened fuel makes a short, billowing, smoky plume that "largely" burns up in flight [S TM]. A cone-shaped "gas jet" is wrong for napalm.
- The stream is **ballistic**: it droops with range, and it can be skipped into apertures: fuel "strikes the target with force enough to ricochet inside" [S TM].
- Burning fuel should **stay on surfaces and pool**. Gobs keep burning for minutes, and pools burn at a steady rate per unit area (~0.05 kg/m²·s). Fire should not vanish when the trigger is released.
- Smoke should be **heavy and dark (sooty)**. Liquid fuel gives more initial flame and smoke than thickened fuel [S TM]. A headwind above 5 mph blows heat back toward the firer [S TM].
- Ammo is **short**: ~6–9 s of trigger time per load, fired in bursts. The operator may "wet" a target with unignited bursts first and then ignite it [S TM].

---

## weapon/grenade-launcher

### Reference media
- `refs/weapon-grenade-launcher/01.jpg`: https://commons.wikimedia.org/wiki/File:M203_grenade_launcher_live-fire_exercise_130713-N-NZ935-162.jpg (Public domain, USN). M203 live fire aboard USS Denver.
- `refs/weapon-grenade-launcher/02.jpg`: https://commons.wikimedia.org/wiki/File:M224_mortar_firing.jpg (Public domain). An M224 60 mm mortar at the moment of firing, with muzzle flash and blast.
- `refs/weapon-grenade-launcher/03.jpg`: https://commons.wikimedia.org/wiki/File:130724-M-MX805-001_-_1-6_fires_M224_mortar_system_(Image_1_of_5).jpg (Public domain, USMC). An M224 crew laying the gun.
- YouTube [Q]: M224 live fire: https://www.youtube.com/watch?v=CSLVAtr87tU ; https://www.youtube.com/watch?v=DfkOeHQXAaM

### Benchmarks: 40 mm low-velocity (40×46 mm)
- Muzzle velocity **76 m/s** (250 ft/s). Max range about **400 m**. Effective range 350 m against an area target and 150 m against a point target [S https://en.wikipedia.org/wiki/M203_grenade_launcher; same 76 m/s on https://en.wikipedia.org/wiki/M79_grenade_launcher].
- Drag check: the vacuum max range would be v²/g = 76² / 9.81 = 589 m, against 400 m actual [D].
- Flight time to 150 m on a flat trajectory: sin 2θ = 150·9.81/76² = 0.255, so θ ≈ 7.4° and TOF = 2·76·sin 7.4°/9.81 ≈ **2.0 s** in vacuum [D]. The shot is slow and visibly arcs.
- Arming distance **14–27 m** [S M203 wiki; M79 wiki].
- Grenade mass ~227 g [S M203 wiki].
- M406 HE: fill **32 g Composition B** [S https://bulletpicker.com/cartridge_-40mm-he_-m406.html]. It throws "over 300 fragments" at **1,524 m/s**, with a **5 m lethal radius** [S M79 wiki]. The M203 wiki also states a "casualty radius 130 m" [S]. That figure looks like a danger/hazard radius rather than an effect radius, so do not model casualties out to 130 m.
- M433 HEDP: 45 g Comp A5 [Q https://en.wikipedia.org/wiki/United_States_40_mm_grenades search summary]. Penetrates ≥ 5 cm (2 in) of armour at ≤ 150 m [S M203 wiki]. FM 3-06.11 Table 7-7 gives HEDP penetration of 20 in double sandbags, 16 in sand-filled cinder block, 12 in pine logs, and 2 in armour plate [S FM 3-06.11 ch7].
- Accuracy in cities: gunners can place grenades into windows at 125 m and bunker apertures at 50 m, but "cannot consistently hit windows at 50 meters when forced to aim and fire quickly" [S FM 3-06.11 ch7].

### Benchmarks: M224 60 mm mortar

| charge zone | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| muzzle velocity (m/s) | 65 | 126 | 170 | 208 | 241 |
| range, min–max (m) | 70–400 | 200–1300 | 350–2100 | 500–2800 | 650–3500 |

Source for the table: [S https://man.fas.org/dod-101/sys/land/m720.htm]. Wikipedia gives HE range as 70–3,490 m [S https://en.wikipedia.org/wiki/M224_mortar].
- Cartridge mass 1.68 kg [S FAS]. Rate of fire 20 rpm sustained, 30 rpm in short bursts [S FAS; wiki].
- HE fill **conflicts** between sources. M888: 0.36 kg (0.79 lb) Comp B [S M224 wiki]. M720: 0.19 kg (0.42 lb) Comp B [S https://bulletpicker.com/cartridge_-60mm-he_-m720.html]. Another search summary gives M720 as 358 g [Q metis.fenixinsight.com]. Resolve this before tuning.
- Fuze options (M734): proximity, near-surface burst, impact, or delay [S FAS].
- Time of flight, vacuum upper bound at 241 m/s: at 45°, 2·241·0.707/9.81 ≈ **35 s**; at ~79°, 2·241·0.981/9.81 ≈ **48 s** [D]. Real TOF at full charge is roughly 20–50 s. That estimate is not sourced, so find a firing table (FT 60-P-1) before relying on it.
- Fragment count and velocity for 60 mm: **not found**.

### Tells a harsh critic should check
- The 40 mm round is **slow enough to see** (76 m/s), follows a pronounced lob, and does **not detonate inside ~14–27 m**. At close range it is a dud that thuds.
- The 40 mm HE blast is small (32 g fill). It throws fragments and a puff of grey-black smoke, not a fireball. Hand-grenade-class fragments "cannot penetrate a single layer of sandbags, a cinder block, or a brick building" [S FM 3-06.11 ch7].
- A mortar bomb falls **steeply** after a long flight (tens of seconds). You hear it, then see a sharp dusty burst with radial fragment scars. It punches roofs rather than walls.
- A fixed "explosion sphere" is wrong for both. The damage is fragment-dominated and directional to the ground, with a small crater.

---

## weapon/thermobaric

### Reference media
- `refs/weapon-thermobaric/01.jpg`: https://commons.wikimedia.org/wiki/File:RPO-A_missile_and_launcher.jpg (Public domain). The RPO-A launcher tube and its rocket.
- `refs/weapon-thermobaric/02.jpg`: https://commons.wikimedia.org/wiki/File:Fuel_Air_Explosive_bombs_in_South_Vietnam_1970.jpg (Public domain, USN). FAE bombs, 1970.
- `refs/weapon-thermobaric/03.jpg`: https://commons.wikimedia.org/wiki/File:USS_McNulty_(DDE-581)_sunk_as_target_with_FAE_1972.jpg (Public domain, USN). A second-generation FAE (BLU-95/96) detonating over a target ship, 1972. It shows the wide, flat cloud-burst geometry.
- YouTube [Q]: RPO-A and RPO PDM-A (English subs): https://www.youtube.com/watch?v=AWMVPhyAi54 ; RPO Shmel: https://www.youtube.com/watch?v=ybpr3g0v7_8

### Benchmarks: weapons
- RPO-A Shmel: calibre **93 mm**, mass 11 kg, muzzle velocity **125 ± 5 m/s**, effective range 20–1,000 m (sight to 600 m) [S https://en.wikipedia.org/wiki/RPO-A_Shmel].
- RPO-M: 90 mm, and its "blast effect is equivalent to 5.5 kg" of TNT [S RPO-A wiki; also https://en.wikipedia.org/wiki/Thermobaric_weapon]. The RPO-A's effect is reportedly "similar to" a 122 mm howitzer shell [S IMAS Annex B].
- TBG-7V (RPG-7): 105 mm, 4.5 kg. Fill 1.9 kg thermobaric mix plus 0.25 kg A-IX-1 booster. Lethal radius **10 m** [S https://en.wikipedia.org/wiki/RPG-7]. The RPG thermobaric warhead is "said to produce effects comparable to" 2 kg of TNT [S IMAS Annex B].
- SMAW-NE: **1.8 kg (4 lb) PBXN-113** enhanced-blast warhead, used in Iraq to collapse structures [S https://en.wikipedia.org/wiki/Mk_153_Shoulder-Launched_Multipurpose_Assault_Weapon].

### Benchmarks: FAE physics (the two-stage burst)
- **Stage 1:** a central burster charge of **1–2 % of the fuel mass** ruptures the case and disperses the fuel as an aerosol [S IMAS §6.3].
- **Stage 2:** a second detonator initiates the cloud. The delay between dispersion and initiation is "of the order of **150 ms**" (150 ms for the CBU-55B), which is short enough that weather has little effect [S IMAS §6.3, §7.8].
- Cloud size: a 33 kg charge makes a cloud "up to **30 m** in diameter" [S IMAS]. The BLU-73/B (CBU-72) uses **75 lb (34 kg) ethylene oxide**, bursts at 30 ft (9 m), and gives a cloud **60 ft (18 m) across and 8 ft (2.4 m) thick** [S https://www.globalsecurity.org/military/systems/munitions/cbu-72.htm].
- Detonation pressure and velocity [S IMAS Table 5]:
  - FAE: ~**19 bar** at **1,800 m/s**
  - TNT: 190,000 bar at 6,950 m/s
- The IMAS note gives eardrum rupture at "approximately 2 Bar" and says FAE is ~10× that [S IMAS fn 7].
- Energy per unit mass, fuel only [S IMAS Table 3]:
  - propylene oxide 7.9 kcal/g
  - ethylene oxide 6.9 kcal/g
  - TNT 1.1 kcal/g
- Explosive efficiency is "less than 40%", because air is only 21 % O₂ and the cloud is inhomogeneous [S IMAS §7.2].
- Explosive limits, % by volume in air [S IMAS Table 7]:
  - oxirane (ethylene oxide) 3–80
  - ethyne 2–100
  - ethene 3–34
  - methane 5–14
  - propane 2–10
  - gasoline 2–8
- Another search summary gives ethylene oxide as 3–100 % [Q cameochemicals.noaa.gov]. Propylene oxide limits were **not confirmed**.
- Decay with distance (1 t ethene cloud), overpressure as % of the TNT-equivalent value [S IMAS Table 6]: **50 %** at 10 m from the cloud edge, **139 %** at 20 m, **374 %** at 50 m. The blast falls off far more slowly than from a point charge. The FAE blast wave also lasts longer, so its impulse is higher [S IMAS §7.4].
- TNT equivalence: W_TNT = K · W_F · (F / F_TNT), where K is efficiency and F is heat of explosion [S IMAS §7.3]. Example: 34 kg EO × 0.35 × (6.9/1.1) ≈ **75 kg TNT-energy equivalent** [D; K = 0.35 is my assumption within "<40%"].
- Enclosed spaces: thermobarics are "considerably more effective when used in enclosed spaces such as tunnels, buildings" because they burn atmospheric oxygen. In confinement the pressure pulse is extended to **10–50 ms** [S Thermobaric wiki].
- Thermobaric vs FAE: a thermobaric warhead disperses and ignites "immediately" on impact. It gives a stronger expanding push but less of the "vacuum" effect than an FAE, which needs time to spread [S IMAS Annex B].

### Tells a harsh critic should check
- **There must be a visible delay.** An FAE shows a burst, a spreading grey-white aerosol cloud (~0.1–0.15 s), and then a flash through the whole cloud volume. A hand-held thermobaric warhead instead gives one big, slow, orange fireball that fills rooms and vents out of windows and doors.
- The peak pressure is **lower than HE's**, but the blast lasts **much longer**. Fragmentation and a crater should be minimal. The damage comes from push and heat, most of all inside rooms, where doors and windows blow outward and occupants are hit through corridors.
- The fireball should **follow the geometry**, flowing around corners and down corridors, instead of being a sphere clipped by walls.
- Afterward there is scorching, lingering smoke and dust, and unburnt fuel residue. A dud leaves a toxic liquid (EO/PO) [S IMAS §11].

---

## weapon/heat-recoilless

### Reference media
- `refs/weapon-heat-recoilless/01.jpg`: https://commons.wikimedia.org/wiki/File:M3A1_MAAWS_firing_HEDP_502.jpg (Public domain). A Carl-Gustaf M4 firing HEDP 502. The **rear fireball is larger and brighter than the muzzle signature**: incandescent white-yellow with greenish edges, about 2–3 m across. A sheet of dust runs along the ground, the finned round is visible about 1 m ahead of a white muzzle-smoke puff, and spent tubes lie in the backblast zone.
- `refs/weapon-heat-recoilless/02.jpg`: https://commons.wikimedia.org/wiki/File:AT4_Backblast_(6323136).jpg (Public domain). An AT4 firing, with the backblast plume.
- `refs/weapon-heat-recoilless/03.jpg`: https://commons.wikimedia.org/wiki/File:AT4_CS.jpg (Licence Ouverte / French Army). AT4 CS, the confined-space variant with a saltwater countermass.
- YouTube [Q]: AT4 in slow motion: https://www.youtube.com/watch?v=YJ55vE3aUA8 ; SMAW and AT4: https://www.youtube.com/watch?v=nBB82rLVrP4

### Benchmarks
- **Carl Gustaf (84 mm)**, all [S https://en.wikipedia.org/wiki/Carl_Gustaf_8.4_cm_recoilless_rifle]:
  - muzzle velocity **230–255 m/s**
  - mass: M4 6.6 kg, M3 10 kg
  - HEAT FFV551 penetrates up to **400 mm RHA**; tandem 751 penetrates more than 500 mm
  - HEDP 502 penetrates more than **150 mm RHA**
  - ASM 509 has an impact mode and a delay mode
  - backblast "dangerous to **30 m**", with hazard to about **50–75 m**
- The backblast danger zone extends "up to 60 meters" to the rear [S https://thedefensepost.com/2025/08/07/carl-gustaf-guide/]. The HEAT 655 CS round can be fired from small enclosures [S CG wiki].
- The ASM 509 sheet describes an **enhanced-blast** warhead that destroys buildings and parapets "made of bricks and light concrete" [S https://www.saab.com/globalassets/event/aeroindia/84-mm-asm-509.pdf; numeric fields could not be extracted from this PDF].
- **AT4 (M136)** [S https://en.wikipedia.org/wiki/AT4]:
  - 84 mm; 6.7 kg (CS: 8 kg)
  - muzzle velocity **290 m/s** (CS: 220 m/s)
  - 440 g **octol** HEAT fill
  - FM 3-06.11 says it can penetrate "more than 17.5 inches (450 millimeters)" of armour plate and has a **10 m** minimum arming distance [S FM 3-06.11 ch7]
- **M67 (90 mm)** [S https://en.wikipedia.org/wiki/M67_recoilless_rifle]:
  - muzzle velocity **213 m/s** (700 ft/s)
  - the HEAT round weighs 3.06 kg
  - it penetrates **350 mm** of steel, **1.1 m** of packed soil, or **0.8 m** of reinforced concrete
  - backblast: 43 m long, 120° angle, danger zone to 28 m [Q a-1-6.org / namu.wiki search summary]
- **Against walls** [S FM 3-06.11 ch7]:
  - A breach hole for troops should be about **50 in high × 30 in wide (1.27 × 0.76 m)**; a loophole is about **8 in (20 cm)**.
  - AT4 or Carl Gustaf "may require **3 to 5 rounds**" to penetrate brick walls, and they "usually will not penetrate a heavy European-style stone wall".
  - SMAW-D makes a hole in brick "often large enough to be a breach hole", and multiple shots breach reinforced concrete, but "it will not cut reinforcing steel bars".
  - Against wood frame, a single round makes a breach hole plus significant spall.
- **Backblast geometry:**
  - AT4: "extends **100 meters** to the rear of the launcher in a **90-degree fan**"; no walls or obstructions within **5 m** behind the firer [S FM 3-23.25 App A]
  - SMAW: 90 m, 60° cone; lethal to 30 m [S SMAW wiki]
- HEAT hole diameter in concrete or brick: **not found**. The only hole sizes found are the FM breach and loophole targets above.

### Tells a harsh critic should check
- A HEAT round against masonry makes a **small, deep hole with spall behind it**, not a big crater. The front face shows a small shallow cone, the back face scabs, and several rounds are needed for a man-sized hole in brick. Rebar survives.
- **Backblast is as dramatic as the muzzle blast:** a long cone of dust, gas and debris behind the firer (30 m lethal, up to 100 m hazard). A wall within ~5 m behind the firer reflects it back onto the firer.
- There is a loud report, a puff of smoke, and a projectile you can see for a moment at ~220–290 m/s.
- An anti-structure or enhanced-blast round (ASM 509 or SMAW-NE) should look different from HEAT: a room-filling blast rather than a jet.

---

## weapon/bunker-buster

### Reference media
- `refs/weapon-bunker-buster/01.jpg`: https://commons.wikimedia.org/wiki/File:F-15E_gbu-28_release.jpg (Public domain, USAF). An F-15E releasing a GBU-28; the long, slender body is visible.
- `refs/weapon-bunker-buster/02.jpg`: https://commons.wikimedia.org/wiki/File:U.S._Marines_prepare_to_fire_a_shoulder-launched_multipurpose_assault_weapon.jpg (Public domain). Marines preparing to fire a SMAW (83 mm), the shoulder-scale analogue.
- YouTube [Q]: GBU-28 overview: https://www.youtube.com/watch?v=FVkYe8tNZX4 ; https://www.youtube.com/watch?v=KJTq9yb_Zow

### Benchmarks
- **GBU-28** [S https://en.wikipedia.org/wiki/GBU-28]:
  - 4,000–5,000 lb class (1,800–2,300 kg)
  - fill: 630 lb (286 kg) tritonal in early models; 675 lb (306 kg) AFX-757 in the C/B
  - penetrates "over 160 feet (50 m) of earth or 16 feet (5 m) of solid concrete"
  - a sled test went through **22 ft (6.7 m) of reinforced concrete** and travelled on ~800 m
  - FAS says the sled test went through ">20 feet of concrete" and a flight test through ">100 feet of earth"; diameter 14.5 in, length ~19 ft (153 in) [S https://man.fas.org/dod-101/sys/smart/gbu-28.htm]
- Gsponer takes a **terminal velocity of 0.5 km/s** for the GBU-28 and predicts **5.9 m** of concrete. He cites the GBU-28/BLU-113 as claimed to go through 7 m of concrete or 30 m of earth. For the B61-11 at 500 m/s he gets ~2.4 m of concrete [S arXiv 0510052 §3–4]. Impact velocity is otherwise **not published** in the sources fetched.
- **BLU-109:** 2,000 lb (910 kg); **250 kg tritonal**; steel case about **1 in (25 mm)** thick; **FMU-143** delayed tail fuze [S https://en.wikipedia.org/wiki/BLU-109_bomb]. Its concrete penetration depth was not stated.
- **SMAW HEDP (shoulder-scale delay mode)** [S SMAW wiki]:
  - The fuze tells hard targets (high deceleration: the case "mushrooms", so it detonates on the surface) from soft ones (low deceleration: delayed, deeper).
  - It penetrates **20 cm of double-reinforced concrete**, **30 cm of brick**, ≤ 20 mm of RHA, or **2.1 m of sandbags**.
  - Muzzle velocity 220 m/s.
- BROACH and Bunkerfaust: **not researched** (gap).
- **Young/Sandia equation** [S Gsponer App. 8, rewritten form]:
  - D ≈ 9.63 · S · N · (L·ρ_eff/ρ_Fe)^0.7 · (v[km/s] − 0.0305), with D in m and L the penetrator length in m.
  - In Young's SI form this is **D = 0.000018 · S · N · (m/A)^0.7 · (V − 30.5)** for V ≥ 61 m/s. Here m is in kg, A is the cross-section in m², and V is in m/s [D]. Check: (ρ_Fe·L)^0.7 = 7900^0.7 · L^0.7 = 535 · L^0.7, and 0.000018 × 535 = 0.00963 per m/s = 9.63 per km/s. That matches, but the 0.000018 constant is my recollection of SAND97-2426, backed only by this match.
  - Concrete S-number: S = 0.085·K_e·(11 − P)·(t_c·T_c)^−0.06·(5000/f_c)^0.3, with f_c in psi, P = % rebar by volume, t_c = cure time in years, T_c = thickness in target calibres, and K_e a width factor [S https://www.scielo.br/j/lajss/a/zvf9CzSsdKSRwj9N5dnJccF/?lang=en; summariser extraction, so verify against SAND97-2426 https://digital.library.unt.edu/ark:/67531/metadc697639/].
  - The Sandia equations fit best below **800 m/s** [Q academia.edu comparison paper, search summary].
  - Worked GBU-28 example [D]: m = 2,130 kg, d = 0.368 m, so A = 0.1064 m² and m/A = 20,020 kg/m². (m/A)^0.7 = 1,026. With S = 0.9 and N = 1.0 (my assumptions), D = 0.000018 × 0.9 × 1.0 × 1,026 × (500 − 30.5) ≈ **7.8 m**, against the 6.7 m sled result.
- **Modified NDRC (Kennedy 1976)** [S IJSCET review, eqs 15–25]:
  - G = (180/√f_c) · N* · (M/d) · (V/(1000·d))^1.8, in FPS units: M in lb, d in in, V in ft/s, f_c in psi.
  - In SI: **G = 3.8×10⁻⁵ · N* · M/(d·√f_c) · (V/d)^1.8**, with M in kg, d in m, V in m/s, f_c in Pa.
  - x/d = 2·√G for x/d ≤ 2 (G ≤ 1), and x/d = G + 1 for x/d > 2 (G > 1).
  - Nose factor N*: flat 0.72, hemispherical 0.84, blunt 1.0, very sharp 1.14.

### Tells a harsh critic should check
- The penetrator makes a **small entry hole**, then comes a delay: the fuze fires after the bomb is buried, so the blast is **internal**. The surface shows a modest hole plus heave or venting through openings, while the interior is gutted.
- Depth goes as (m/A)^0.7: a long, dense, narrow body. A wide or light warhead should **not** penetrate deeply however fast it goes. Normal-strength concrete stops it far sooner than soil does (roughly 5–7 m of concrete versus ~30–50 m of earth).
- At small scale, a fuze that tells hard from soft targets: it bursts on the surface against concrete and goes deep against sandbags and wood.
- Oblique impacts ricochet or yaw. Penetration is for near-normal hits only.

---

## weapon/satchel

### Reference media
- `refs/weapon-satchel/01.jpg`: https://commons.wikimedia.org/wiki/File:Blocks_of_C4_in_Iraq.jpg (Public domain, US Army). A stack of 10 C-4 blocks (the M112 shape: olive wrap, long flat block).
- `refs/weapon-satchel/02.jpg`: https://commons.wikimedia.org/wiki/File:8th_ESB_DFT_urban_breaching_range_(5468270).jpg (Public domain, USMC). A Marine arming a breaching charge on an urban breaching range.
- `refs/weapon-satchel/03.jpg`: https://commons.wikimedia.org/wiki/File:Knocking_Softly,_Assaultmen_Utilize_Breaching_Charges_DVIDS206234.jpg (Public domain, USMC). A door breaching charge detonating: flash, dust and flying door debris.
- YouTube [Q]: https://www.youtube.com/watch?v=rUKTIt5GQrM (hole in a concrete wall); https://www.youtube.com/watch?v=SX8YugEydcQ (wall breach test)

### Benchmarks
- **M112 block:** 1.25 lb (**0.57 kg**) of C-4; about 2 × 1.5 × 11 in (**51 × 38 × 280 mm**) [S https://en.wikipedia.org/wiki/C-4_(explosive)]. An EBAD product sheet gives 1 × 2 × 11 in [Q ebad.com, search summary].
- The block has **pressure-sensitive adhesive tape on one face** [S https://www.globalsecurity.org/military/systems/munitions/m112-c4.htm]. RE factor **1.34** [S GlobalSecurity]. Wikipedia gives brisance at 115–130 % of TNT [S wiki].
- C-4 detonation velocity **8,092 m/s**; density ~1.73 g/cm³ [S C-4 wiki].
- **M183 assembly:** 16 × M112, 4 priming assemblies, and an M85 carrying case [S wiki; GS]. Total mass 16 × 1.25 lb = **20 lb (9.1 kg)** of C-4 [D]. The priming det-cord is 1.5–6.1 m long [S wiki].
- M37: **not verified** (gap).
- **Satchel against walls** [S FM 3-06.11 ch8]: against a non-reinforced concrete wall, C-4 in a satchel gives:
  - **2 lb (0.9 kg):** a mousehole
  - **5 lb (2.3 kg):** a man-sized hole
  - **7 lb (3.2 kg):** a two-man hole
  - **10 lb (4.5 kg):** a vehicle-sized hole
- **TNT for reinforced concrete** [S FM 3-06.11 ch8, Table 8-2]:
  - ≤ 10 cm → **5 kg**
  - 10–15 cm → **10 kg**
  - 15–20 cm → **20 kg**
- **Breaching formula** [Q https://info.publicintelligence.net/USArmy-Explosives.pdf, search summary; FM 3-34.214]: P = R³·K·C. P is pounds of TNT, R the breaching radius (≈ wall thickness), K a material factor, and C a tamping/placement factor. The K and C tables were **not retrieved**: the ResearchGate pages returned 403.
- Scaling check against Table 8-2 [D]: the charge doubles for each +5 cm step, while the pure R³ law would give (15/10)³ = 3.4× and (20/15)³ = 2.4×. The table's thickness bands are coarse. Use R³ as the shape of the curve and fit the constant to the FM 3-06.11 anchor points.
- FM 3-06.11 advises that "all mechanical means should be used first" for mouseholes [S ch8].

### Tells a harsh critic should check
- A contact charge on masonry makes a **roughly circular breach with rubble thrown mostly away from the charge side**. It also leaves a scabbed back face, a dust cloud, and a lot of fine debris. Reinforced concrete keeps a **mesh of bent rebar** across the hole.
- The required charge grows roughly with **thickness cubed**, so a wall twice as thick needs ~8× the charge (not 2×). An untamped charge in open air is much less efficient than a tamped one.
- The satchel is **heavy (≈9 kg), placed by hand, with a fuse delay**. Blocks stick to the wall with adhesive tape. The detonation is an instant sharp crack with a grey-white flash and no lingering fireball.
- Blast overpressure hits the placer side too. Real breachers stand off or take cover around a corner.

---

## weapon/cannon-penetration

### Reference media
- `refs/weapon-cannon-penetration/01.jpg`: https://commons.wikimedia.org/wiki/File:Fort_Pulaski_Damaged_Wall.jpg (Public domain). Close-up of a Fort Pulaski wall scarred by 1862 artillery.
- `refs/weapon-cannon-penetration/02.jpg`: https://commons.wikimedia.org/wiki/File:Fort_Pulaski,_GA,_US_(14).jpg (CC BY-SA 3.0, Bubba73). A face-on brick scarp. The **shot craters are funnel-shaped with a deeper core**; bricks are spalled out in irregular patches roughly 0.5–1.5 m across, and some patches have merged along a line.
- `refs/weapon-cannon-penetration/03.jpg`: https://commons.wikimedia.org/wiki/File:Fort_Pulaski,_GA,_US_(21).jpg (CC BY-SA 3.0, Bubba73). An oblique view along the same wall. The dense crater field shows the spread of hits; later repairs are visible in different-coloured brick.
- YouTube: none found.

### Benchmarks
- 32-pounder: shot 14.4 kg, calibre 160–163 mm, muzzle velocity **~487 m/s (~1,600 ft/s)** [S https://en.wikipedia.org/wiki/32-pounder_gun].
- 24-pounder: muzzle velocity 1,625 ft/s (495 m/s), falling to about 300 ft/s at 3,500 yd. It penetrates 62 in of brickwork at that range [Q search summary; the 62 in looks implausible at 91 m/s striking velocity, so do not use it]. Shot mass 11.7 kg, calibre 152 mm [S https://en.wikipedia.org/wiki/24-pounder_long_gun].
- Earth [S Manucy, https://www.gutenberg.org/files/20483/20483-h/20483-h.htm]:
  - a 24-pdr at 100 yd buries the ball **12 ft (3.7 m)**
  - at 200 yd it penetrates **12–24 ft (3.7–7.3 m)** of earthwork, depending on how "poor and hungry" the earth is
  - a Dutch 48-pdr at 130 yd put a ball 20 ft into a rampart
- Fort Pulaski, 1862 [S Manucy]:
  - brick walls **7½ ft (2.3 m)** thick, breached from ~1 mile in a little over 24 h
  - rifled James projectiles went "19 to 26 inches" into the wall per fair shot
  - smoothbore columbiads went only **13 in**
- **Crater shape** [S Gibbon p. 267–8, archive.org OCR]:
  - the hole is funnel-shaped, ending in a cylindrical part whose depth is **5–8 ball diameters**
  - the shock splits and cracks the masonry in a circle **4–5 ft (1.2–1.5 m)** across for the largest calibres
  - field-gun shot "will easily penetrate walls from one and a half feet to two feet thick", but "good masonry four feet thick" resists them unless a regular breach is made
- For a 24-pdr ball (~5.8 in, 148 mm), that depth is 5–8 × 0.148 = **0.74–1.18 m** [D].
- **Oblique hits and ricochet** [S Gibbon p. 273–4]:
  - Against solid masonry, a ball striking at under **33°** "will glance off".
  - The ball is sometimes thrown back up to **150 yd**; masonry pieces fly **50–80 yd**.
  - Breaching method: a horizontal cut at a height ≈ the wall thickness, so the rubble ramp forms at 45°. Shots are spaced ~1.5 yd apart for 24-pdrs.
- **Metz 1834 data** [S Ordnance Manual 1861 pp. 368–372, archive.org OCR]:
  - Tabulated penetrations in good rubble masonry (Vauban scarp) run roughly 7–27 in across French calibres, charges and ranges. The OCR is too garbled to attribute each value to a gun.
  - Multipliers: **×1.25** for medium masonry, **×1.76 for brick**, **×0.46** for hard limestone.
  - The mean funnel diameter is about **5× the shot diameter**; fragments are projected back ~45–50 yd.
  - Earth multipliers: ×0.63 sand with gravel; ×1.11 wet clay; ×1.50 settled light earth; ×1.90 fresh light earth.
- **NDRC scabbing and perforation limits** [S IJSCET eqs 22–25]:
  - scabbing: **h_s/d = 7.91·(x/d) − 5.06·(x/d)²** for x/d ≤ 0.65, and **h_s/d = 2.12 + 1.36·(x/d)** for 0.65 < x/d ≤ 11.75
  - perforation: **e/d = 3.19·(x/d) − 0.718·(x/d)²** for x/d ≤ 1.35, and **e/d = 1.32 + 1.24·(x/d)** for 1.35 < x/d ≤ 13.5
- Worked 24-pdr example [D]:
  - Inputs: M = 10.9 kg, d = 0.147 m, V = 300 m/s, f_c = 30 MPa, N* = 1.0 (sphere).
  - V/d = 2,041, and 2,041^1.8 = 9.07×10⁵. M/(d·√f_c) = 10.9/(0.147 × 5,477) = 0.01354.
  - G = 3.8×10⁻⁵ × 0.01354 × 9.07×10⁵ = 0.467, so x/d = 2√G = 1.37 and **x ≈ 0.20 m** into concrete.
  - Scabbing thickness h_s = (2.12 + 1.36 × 1.37) × 0.147 ≈ **0.58 m**.
  - Perforation thickness e = (1.32 + 1.24 × 1.37) × 0.147 ≈ **0.44 m**.
  - Brick is weaker than concrete, so the ~0.9–1.2 m from the Gibbon/Metz brick values is consistent.

### Tells a harsh critic should check
- Round shot on brick makes a **funnel crater about 5 ball diameters wide around a deeper hole**, plus a ring of cracks. There are no clean round holes, and a single ball does not go through thick masonry.
- A breach is **cumulative**: rows of hits cut a horizontal slot, then the wall above collapses into a 45° rubble ramp. Rifled shot penetrates about twice as deep as smoothbore shot at range (Pulaski).
- Balls **bounce back** off masonry and ricochet off glancing faces (under 33°). Ricochet along the ground was a deliberate tactic.
- Earth **swallows** shot, taking metres of penetration with almost no damage. Scabbing sends fragments off the back face before full perforation.

---

## weapon/rocket-backblast

### Reference media
- `refs/weapon-rocket-backblast/01.jpg`: https://commons.wikimedia.org/wiki/File:Backblast_area_clear_(31027495255).jpg (Public domain, US Army). An AT4 simulator firing at NTC; the dust plume behind the tube is visible.
- `refs/weapon-rocket-backblast/02.jpg`: https://commons.wikimedia.org/wiki/File:ASSF_firing_RPG-7.jpg (Public domain). An RPG-7 firing, with the smoke and dust cone behind it.
- `refs/weapon-rocket-backblast/03.jpg`: https://commons.wikimedia.org/wiki/File:M72_LAW_firing_practice_at_Lai_Khe.jpg (Public domain). M72 LAW firing practice, Vietnam.
- YouTube [Q]: https://www.youtube.com/watch?v=9WRGwi34ges (backblast area clear); https://www.youtube.com/watch?v=BCN0y4BHiGs ("rocket backblast sends soldier flying"); https://www.youtube.com/watch?v=hZxCtAaXivM (AT4 and SMAW live fire)

### Benchmarks

| weapon | backblast length | angle | notes / source |
|---|---|---|---|
| RPG-7 | **30 m** | **70°** | "no obstacles, walls, etc within 2 meters behind", "at least 3 meters" advised; "Firing from inside a small room is to be discouraged" [S https://sadefensejournal.com/the-rpg-7-system-primer/4/]. Wiki: 2 m rear standoff enough in rooms [S RPG-7 wiki]. 1977 Warsaw Pact guide: kill zone 20 m in 45° cone, danger 20–70 m [Q SADJ/search] |
| M72 LAW | **40 m** | danger + caution zones | 5 m rear clearance in combat [S FM 3-23.25 App A]; backblast gas ~**760 °C** [S https://en.wikipedia.org/wiki/M72_LAW] |
| AT4 (M136) | **100 m** | **90° fan** | no walls within **5 m** [S FM 3-23.25 App A] |
| SMAW | **90 m** | **60° cone** | lethal to **30 m** [S SMAW wiki] |
| Carl Gustaf | dangerous to 30 m; hazard 50–75 m (up to 60 m) | not found | [S CG wiki; defensepost] |
| M67 90 mm | 43 m | 120° | [Q] |

- RPG-7 flight: boost 115 m/s; the sustainer lights after ~10 m and reaches **300 m/s** [S RPG-7 wiki].
- **Fire-from-enclosure rules** [S FM 3-06.11 ch7 §7-5b(5)]:
  - sturdy building; ceiling **≥ 7 ft (2.1 m)**, with loose plaster and ceiling boards removed
  - floor **≥ 15 × 12 ft (4.6 × 3.7 m)**, "the larger the room, the better"
  - **≥ 20 ft² (1.86 m²)** of openings to the rear or side
  - all personnel forward of the weapon's rear, wearing helmets, armour, eye protection and earplugs
  - all glass and small loose objects removed
- Minimum room volume ≈ 4.57 × 3.66 × 2.13 = **36 m³** [D]. The old M72 FFE rating needed ≥ 3.7 × 4.6 m, "roughly 50 cubic meters", with ventilation; that rating was removed in 2010 [S M72 wiki].
- **What happens in the room** (Aberdeen HEL tests with LAW, Dragon and TOW from masonry and frame buildings) [S FM 3-06.11 ch7]:
  - "The most serious hazard that can be expected is hearing loss."
  - "Little hazard exists … from any type of flying debris."
  - Search summary of the same chapter: the backblast "rarely displaces furniture"; most debris is plaster chips and wood trim, and large chunks of plasterboard can come off ceilings [Q].
- **Table 7-9 structural damage** [S FM 3-06.11 ch7]:
  - masonry + LAW: no structural damage, slight wall damage, slight debris
  - small frame + Dragon: **severe** structural and wall damage
  - medium frame + Dragon: lamps and chairs overturned
  - large frame + TOW: severe wall damage
- The AT4 may be fired from an enclosure "in combat only when no other tactical option exists"; in training, never from an enclosure or behind a barrier [S FM 3-23.25 App A].
- Countermass designs avoid this. The AT4-CS uses a **saltwater countermass** whose spray "captures and dramatically slows down the pressure wave" [S AT4 wiki]. The M72A8/A10 use a liquid countermass [S M72 wiki].
- Peak overpressure in the room, in kPa: **not found** (gap).

### Tells a harsh critic should check
- Backblast is a **cone of hot gas, dust and debris** behind the tube, as long as or longer than the muzzle flash is bright: tens of metres, 60–90°. It lifts dust, flattens grass, and can throw loose objects.
- A **wall close behind the firer** (under 2–5 m) reflects the blast onto the firer and crew.
- **Firing indoors**: the room fills with dust and smoke, and shatters any glass left in the windows. Ceiling plaster and boards come down, light frame walls can be damaged, and the crew is concussed or deafened. Masonry rooms survive, and the effect depends on room size and open vents.
- The projectile leaves slowly and the rocket motor burns visibly. On an RPG-7 the sustainer lights ~10 m out with a second flare.

---

## weapon/confined-blast — any charge inside a room

Sources fetched for this section:
- Salvado, Tavares, Teixeira-Dias & Cardoso (2017), *Confined explosions: the effect of compartment geometry*, J. Loss
  Prev. Process Ind. 48:126-144 (accepted manuscript): https://www.pure.ed.ac.uk/ws/files/34748553/JLPP_3479_AFAM.pdf
- Catovic & Kljuno (2021), *Review of methods for prediction of internal blast loading*, PEN 9(2):534-544:
  https://pdfs.semanticscholar.org/6035/72df9d1349d84292cf9428567b6b85ef81cd.pdf (quotes Baker, Cox, Westine, Kulesz &
  Strehlow, *Explosion Hazards and Evaluation*, 1983)
- Hu, Wu, Lukaszewicz, Dragos, Ren & Haskett (2011), *Characteristics of confined blast loading in unvented structures*,
  IJPS 2(1): https://opus.lib.uts.edu.au/bitstream/10453/118537/1/2041-4196.2.1.21.pdf

### Benchmarks
- Two loads inside a structure: the reflected shock with its reverberations, then the quasi-static gas pressure, which
  depends on the room's volume, its vent area and the explosive [S Catovic & Kljuno §2].
- Reverberations: each re-reflection taken at half the one before (P_r2 = P_r1/2, P_r3 = P_r2/2, then nothing), so
  for a slow-responding wall the train is one pulse of **1.75 ×** the first reflected pressure and impulse
  [S Catovic & Kljuno eqs. 1-4, after Baker et al. 1983].
- Gas blow-down through vents: P(t) = (P_QS + P0)·e^(−2.13 τ) − P0, τ = α_e·A_s·a0·t / V (α_e the vent share of the
  wall area A_s, a0 the sound speed); it reaches ambient at τ_max = ln((P_QS + P0)/P0) / 2.13, and the gas impulse is
  the area under the curve [S Catovic & Kljuno eqs. 12-15].
- Peak gas pressure, UFC 3-340-02 Fig. 2-152 as replotted with test data: **~0.4 bar at W/V = 0.0058 kg/m³**
  [S Salvado et al. §6, Fig. 18]. Full afterburn of TNT's products needs W/V below **0.387 kg/m³**; the total energy
  with afterburn is **~3.22 ×** the heat of detonation [S Salvado et al. §6].
- A detonation-only hydrocode (no afterburn) gives far less: P_g = 1.50·x^0.967 MPa, x = W/V in kg/m³
  [S Hu et al. 2011, eq. 7] (0.076 MPa at 0.046 kg/m³ against 0.20 MPa from the fit below [D]); afterburn is most of a
  real room's gas pressure.
- Degree of venting runs from fully vented through partially vented to fully confined [S Salvado et al. Fig. 1, after
  UFC 3-340-02]. Subsequent reflections are usually weaker than the first, but in slender compartments they can be
  stronger [S Salvado et al. §7].

### What the game does (src/sim/fields/blast.ts, src/destruction/structure.ts)
- The room is found on the building as it stood when the charge went off: its real ceiling and walls, glazing counted
  as open. The charge holes only what lies inside its contact-breach radius, P = R³·K·C with masonry K 0.35 and C 3.2
  (weapon/satchel): 2.5 kg TNT → 0.52 m [D]. A charge planted on a wall is on the side it was planted on.
- P_QS = 2.25 MPa·(W/V)^0.78, W the charge's own TNT-eq (no ground-reflection factor). 0.40 bar at 0.0058 kg/m³ [D,
  matches the S point]; 1.19 bar for 2.5 kg in 108 m³ [D], against the afterburn energy bound
  (γ − 1)·3.22·4.184 MJ/kg·W/V = 1.25 bar [D]. The 2.25 MPa anchor at W/V = 1 kg/m³ is carried over from the earlier
  fit and is **not re-sourced**.
- Blow-down on the Baker curve through the room's vent area (openings, the charge's own breach, and, once they have
  moved hL/2(h + L) out, the wall panels the gas blows out); what a member takes is its first 50 ms.
- Reverberations: 0.75 × the wall's own normal reflected impulse on top of the direct shock (the 1.75 × train).
- Share held: 1 below a vent ratio A/V^⅔ of 0.3, none past 1.5 (judgement, **not sourced**; UFC's charts were not read).
- The gas load moves things: masonry panels by the SDOF P–I verdict, slabs and sheet walls bounding the room pushed out
  by (gas + reverberation impulse) × area.
- Test (tests/confinement.test.ts), 2.5 kg at 1 m in a 6 × 3 × 6 m 9 in brick room under a 25 cm RC slab: open (no
  roof) walls ~6 % down; 3 × 3 m opening (vent ratio 0.53, held 0.81, gas impulse ~0.5 kPa·s) ~20-50 % of the site
  down; closed (gas impulse ~5 kPa·s) ~98 % down with the slab thrown off [D, sim].

## weapon gaps and conflicts
- Constants K and C for P = R³KC (FM 3-34.214 tables): source blocked. Propylene oxide LEL/UEL. HEAT hole diameters in concrete or brick. Peak room overpressure when firing from an enclosure. 60 mm fragment data. BROACH, Bunkerfaust and M37 specs.
- M720/M888 fill: 0.19 kg vs 0.36 kg. 40 mm "casualty radius 130 m" is a danger radius, not an effect radius. The 24-pdr "62 in brick at 3,500 yd" is implausible. The Young SI constant 0.000018 is reconstructed from memory and a unit match.

## weapon/bunker-buster (game spec)
- GBU-39 Small Diameter Bomb: 285 lb (129 kg) total, 206 lb (93 kg) warhead, 36 lb (16 kg) AFX-757, 7.5 in (190 mm) body,
  1.80 m long, penetrates "greater than 3 ft (0.91 m) of steel reinforced concrete", air-burst and delay fuze options
  **[S]** https://en.wikipedia.org/wiki/GBU-39_Small_Diameter_Bomb
- Game check: Young with m 129 kg, A = π·0.095² m², V 260 m/s, S 0.8 (reinforced) gives D ≈ 1.2 m **[D]**, consistent
  with "> 0.91 m". The 260 m/s impact speed and the RE 1.3 for AFX-757 (→ 21 kg TNT-eq) are assumptions, not sourced.

## weapon known gaps (critic loop, 4 rounds)
- Point charges indoors (fixed, see weapon/confined-blast): the survey used to clear a breach sphere (≥ 1.5 m) round the
  charge before judging cover, so a nearby ceiling was lost and the room never registered as confined. Every charge is
  now judged on the room as it stood.
- Contact breaches are sized by P = R³·K·C with C fitted (3.2 → 5 lb C-4 ≈ 1 m² in plain concrete) and reinforced
  concrete fitted to FM 3-06.11 Table 8-2; K/C tables from FM 3-34.214 were not retrieved. Holes are only as fine as
  the pieces the wall is built of.
- Headless scenario outcomes depend on case order within one process (shared piece ids and random streams); a marginal
  case (four holed slabs over a contained burst) swings between ~1 % and ~78 % demolished.
- Thermobaric in the open does little to a brick wall 1.7 m from the cloud centroid; the energy ledger beyond the
  shock (fireball heat, afterburn) is not reported. A secondary field deflagration can follow in a burning room.
- Flamethrower gas cells next to burning timber sit at the field's 2000 °C clamp (the existing timber fire model); the
  fuel's own plume is gated at 1050 °C.
- HEAT: per-round hole area is not measured; the face blast (15 % of the fill) is a calibration, not a sourced split.
- Frames: evidence shots exist for round 1 only (in-app browser, ~10 fps).

# Gaps (unsourced or weak)

- Gothic roof pitch; church-implosion duration/pile (Bingley 1974 has no numbers in the source); retail floor-to-floor for Art Deco stores.
- UK riveted truss road-bridge photographs (Commons returned US HAER records only).
- Walk-up flats dimensions and photos; chapel dimensions; Victorian terrace roof pitch and storey height.
- Thermite burn behaviour per column; documented thermite use in building demolition (found none).
- Hudson's and Ocean Tower collapse durations (one source each, conflicting for Hudson).
- Utilities: no Commons photo of a pillar hydrant sheared *wet* (US wet-barrel type) or of a live LV conductor arcing on the ground; geyser heights are news reports, not measurements.
- Fragment-size distributions for blast rubble (brick or concrete); concrete tension/compression ratio; Eurocode 3 reduction factors and rotation capacity; glass tensile strength; tempered/annealed comparison photographs.
- Wrecking-ball swing counts and ball speeds; debris throw distances for wrecking balls and excavators.
