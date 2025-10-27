Amenities ETL Pipeline
======================

This package contains the end‑to‑end ETL that consolidates raw amenity sources,
geocodes them, enriches with classifications, maps amenities to the road
network, and produces accessibility outputs for planning analysis. The pipeline
is organised into modular steps so you can run the entire flow or invoke
individual stages when iterating.

Overview
--------

The pipeline is surfaced through the step functions defined in
`backend/etl/amenities/pipeline.py` and exposed to the shared ETL framework via
`AmenitiesPipelineStage`. Each step can be triggered independently or chained
through the common `Pipeline` orchestrator.

High-level execution sequence:

1. **Step 00 – Consolidation**
   * Location: `step_00_consolidation/consolidate_clean.py`
   * Merges the curated GeoJSON sources and the OSM Onemap dataset into a single
     amenities FeatureCollection.
   * Cleans and infers amenity names where missing.
   * Output: `backend/etl/data/amenities_consolidated.geojson`

2. **Step 01 – Geocoding**
   * Location: `step_01_geocoding/geocoder_fast.py`
   * Bulk geocodes amenities against planning areas, subzones, and postal
     reference data; optionally snaps the nearest road name (using GeoPandas and
     spatial joins).
   * Output: `backend/etl/data/01_amenities_geocoded.csv`

3. **Step 02 – Classification**
   * Location: `step_02_classification/classifier.py`
   * Joins amenities with priority/weight metadata, recomputes importance
     scores, and ensures every record has category labels.
   * Output: `backend/etl/data/02_amenities_classified.csv`

4. **Step 03 – Road Network Mapping**
   * Location: `step_03_network_mapping/road_matcher_osmnx.py`
   * Uses OSMnx to snap each amenity to the nearest road segments from the OSM
     road network, producing the final amenities output with renamed columns.
   * Reads from: `backend/etl/data/roadnetwork/road_network_final.geojson`
   * Output: `frontend/public/map/amenities_3layers.csv` (with columns: `pa_id`, `sz_id`, `rn_id`)
   * Dependency: OSMnx / NetworkX stack.

5. **Step 04 – Accessibility Analysis** (optional)
   * Location: `step_04_accessibility_analysis/service_pysal.py`
   * Runs the PySAL-based accessibility engine to generate category-specific
     accessibility grids and aggregated scores. If PySAL dependencies are not
     present, the pipeline preserves existing outputs instead of failing.
   * Outputs:
     * Category GeoJSON/CSV grids under `backend/etl/data/amenities/`
     * Planning and subzone CSV summaries:
       * `backend/etl/data/04_accessibility_planning.csv`
       * `backend/etl/data/04_accessibility_subzone.csv`
   * Dependencies: GeoPandas, PySAL (`access`, `rtree`, `h3`, etc.).

5. **Step 04 – Accessibility Analysis** (optional)
   * Location: `step_04_accessibility_analysis/service_pysal.py`
   * Runs the PySAL-based accessibility engine to generate category-specific
     accessibility grids and aggregated scores. If PySAL dependencies are not
     present, the pipeline preserves existing outputs instead of failing.
   * Outputs:
     * Category GeoJSON/CSV grids under `backend/etl/data/amenities/`
     * Planning and subzone CSV summaries:
       * `backend/etl/data/04_accessibility_planning.csv`
       * `backend/etl/data/04_accessibility_subzone.csv`
   * Dependencies: GeoPandas, PySAL (`access`, `rtree`, `h3`, etc.).

6. **Step 05 – Accessibility Fusion** (optional)
   * Location: `step_05_accessibility_fusion/fusion.py`
   * Combines multi-model accessibility outputs into composite indices suitable
     for planning dashboards and enriches the consolidated amenities dataset.
   * Outputs:
     * `backend/etl/data/05_accessibility_planning_fusion.csv`
     * `backend/etl/data/05_accessibility_subzone_fusion.csv`
     * `backend/etl/data/amenities/amenities_accessibility_enriched.csv`
   * If required inputs are missing the fusion stage copies existing inputs
     through so that the downstream file set remains consistent.

Running the Pipeline
--------------------

### Python entry point

Use the built-in CLI wrapper to run specific steps or the entire flow:

```bash
python backend/etl/amenities/pipeline.py --steps 0 1 2 3 4 5
```

Command arguments:

* `--steps`: one or more step numbers (0–5). Omit to run all steps.
* `--plot / --no-plot`: toggles plotting for Step 04.

### Via the shared ETL framework

For orchestrations that mix amenities with other ETL jobs, instantiate the
`AmenitiesPipelineStage` (analogous to `WeatherAlertsDatabaseWriteStage`) and
plug it into the common `Pipeline`:

```python
from backend.etl.common import Pipeline, AmenitiesPipelineStage

stage = AmenitiesPipelineStage(config={"steps": [0, 1, 2, 3], "plot": False})
pipeline = Pipeline(name="amenities-etl", stages=[stage])
asyncio.run(pipeline.run())
```

### Writing to Supabase

To load the final `amenities_3layers` dataset into Supabase, add the
`AmenitiesDatabaseWriteStage` after running the ETL stages:

```python
from backend.etl.common import Pipeline, AmenitiesPipelineStage, AmenitiesDatabaseWriteStage

pipeline = Pipeline(
    name="amenities-etl-to-supabase",
    stages=[
        AmenitiesPipelineStage(config={"steps": [0, 1, 2, 3, 4, 5]}),
        AmenitiesDatabaseWriteStage(
            table_name="amenities_3layers",
            config={"batch_size": 1000, "on_conflict": "amenity_id"},
        ),
    ],
)
asyncio.run(pipeline.run())
```

The database stage reads the CSV from
`backend/etl/data/amenities/amenities_3layers.csv` by default; override the
`csv_path` config key if you persist the file elsewhere.

Dependencies
------------

* Core steps: `pandas`, `geopandas`
* Postal lookup: Local `backend/etl/data/onemap/onemap_postal_codes.csv`
* Step 03: `osmnx`, `networkx`
* Step 04: `geopandas`, `h3`, `rtree`, `pyproj`, `pysal/access`
* Step 05: `pandas`, `numpy`

Ensure the prerequisites are installed (see `requirements.txt`) before
executing the optional spatial steps.

Outputs
-------

All generated artefacts land under `backend/etl/data/`. The final dataset for
downstream analytics is `backend/etl/data/amenities/amenities_3layers.csv`. If
you prefer to persist outputs elsewhere (e.g. Supabase), add a database write
stage after Step 05 similar to the pattern used in `WeatherAlertsDatabaseWriteStage`.
