# Destructovibe /optimize probes (measure.py format: label | runs | command). Dev-loop wall times.
# Runtime ms/step metrics are NOT wall times: run them with
#   python3 .optimize/runtime.py --out .optimize/runs/<ts>-runtime.json [--compare <prev>-runtime.json]   (~6 min)
# Render (needs `npx vite --port 5206 --strictPort` running; 5196 may be taken by other agents' tools):
#   node .optimize/render-probe.mjs http://localhost:5206/ > .optimize/runs/<ts>-render.txt
# Profiles: node --cpu-prof --cpu-prof-dir=<dir> scripts/sim.mjs ...; python3 .optimize/cpuprof.py <dir>/*.cpuprofile
types     | 3 | npx tsc --noEmit
test      | 1 | npm test
build     | 3 | npm run build
checkbld  | 3 | node scripts/check-building.ts cottage-row
levels    | 1 | npm run validate:levels
