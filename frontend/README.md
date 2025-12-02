# WaterBender Frontend

This repository contains a backend and the WaterBender frontend (React + Vite, Mapbox GL, shadcn/ui). The notes below focus on the frontend in `frontend/`, how data is loaded, and what each page is intended to do.

## Getting started
- Prereqs: Node 18+, npm.
- Install and run: `cd frontend && npm install && npm run dev`.
- Environment: create `frontend/.env` with at least `VITE_MAPBOX_TOKEN=<your_mapbox_token>`. Optional overrides: `VITE_BACKEND_URL` (default `https://fyp-ba-water-bender-six.vercel.app`), `VITE_BACKEND_TOKEN` (Bearer auth), `VITE_BACKEND_TIMEOUT_MS` (default 30000).

## Data loading (MapDataContext)
- `src/context/mapDataContext.jsx` wraps the app (see `src/main.jsx`). It loads everything once on startup, exposes state via `useMapData`, and shows a loading overlay on non-home routes while data is fetched.
- For each dataset it first calls the API on `VITE_BACKEND_URL` with `VITE_BACKEND_TOKEN` and a timeout (defaults to 30s). If the call fails or times out it falls back to the static file in `public/map`:
  - Planning areas: `/api/planning-area/` → `public/map/planning_area.geojson`
  - Subzones: `/api/subzone/` → `public/map/subzone_area.geojson`
  - Road network: `/api/road-network/` → `public/map/road_network.geojson`
  - Flood events: `/api/flood-3layers/` → `public/map/floods_3layers_new.csv`
  - Amenities: `/api/amenity-3layers/` → `public/map/amenity_3layers.csv`
  - Amenity category lookup: `/api/amenity-cat-lookup/` → `public/map/amenity_category_lookup_rows.csv`
  - Flood scenarios for simulation: `/api/road-network-flood-scenarios/` → `public/map/road_network_flood_scenarios.csv`
- The context normalizes CSV/JSON into GeoJSON FeatureCollections, builds lookups for planning areas, subzones, and roads, enriches floods with named locations and segments, enriches amenities with category names, and aggregates road-level counts. It exposes the raw and enriched collections, category lookup, flood scenarios, and `loading/error` flags.

## Routes and intent
- `/home`: landing page that introduces the tool and links into the map-based pages with static Mapbox backdrops.
- `/historicalFloodMap`: dashboard layout with filters (planning area, subzone, amenity category/type, flood type, date range) that choropleths planning areas/subzones, shows flood heatmaps and amenities, and renders ranking charts in the side panels.
- `/floodEvents`: event-level explorer. Filter and rank floods, then select one to view its origin/end, inner/outer rings, nearby amenities and roads, and weighted impact scores. Configurable amenity weights, ring sizes, and centrality weighting; includes a learn dialog and sortable table.
- `/roadCentrality`: computes a blended importance score per road segment using betweenness/closeness plus amenity and flood counts with preset or custom weights. Map and table views with filters, per-category toggles, and a road detail panel.
- `/simulation`: builds a road graph, snaps amenities, and runs multi-source Dijkstra for baseline vs flooded conditions. Supports manual flood markers or predefined scenarios, filters by planning area and amenity type, and reports planning-area deltas, road impacts, reachable vs unreachable nodes, and CSV export.
- `/uploadData`: three-step flow to upload amenity or flood CSV plus matching GeoJSON to `/api/upload-data`, with previews before submit.
- `/dashboard`: small map/selection prototype not currently linked in the router.

## Frontend layout
- `frontend/src/pages`: top-level route components listed above.
- `frontend/src/components/pagecomponents`: page-specific modules (maps, tables, panels, dialogs).
- `frontend/src/components/shared`: header/navigation.
- `frontend/src/components/ui`: reusable UI primitives (shadcn).
- `frontend/src/context/mapDataContext.jsx`: data loading, enrichment, and `useMapData` hook.
- `frontend/src/lib/simulation`: graph building, Dijkstra, metrics, and amenity helpers used by the simulation page.
- `frontend/src/hooks`: custom hooks (e.g., `useSimulationComputation`).
- `frontend/src/utils`: map helpers and worker code; `public/map` holds the static fallback datasets.

## When the API is down or data changes
- The app will automatically use the static files in `public/map` when API calls fail. Replace those files with updated CSV/GeoJSON (keep the same filenames) to serve fresh data during outages, then restart the dev server or rebuild.
- Once the API is reachable again, use `/uploadData` to push new amenity or flood datasets to the backend, or point `VITE_BACKEND_URL` at an alternate backend instance.
