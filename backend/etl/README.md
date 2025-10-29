# ETL Pipelines

Clean, modular ETL pipelines for processing amenities, floods, ACRA businesses, and PUB weather data.

## Overview

All ETL pipelines follow the same clean architecture:
- **One pipeline per domain** (amenities, floods, acra, pub)
- **Multiple stages** within each pipeline
- **Shared components** in `common/`
- **All data** stored in `backend/etl/data/`

## Architecture

```
etl/
├── common/               # Shared pipeline components
│   ├── pipeline.py                    # Pipeline orchestrator
│   ├── pipeline_stage.py              # Base stage class
│   └── database_write_stage.py        # Reusable DB write stage
│
├── data/                 # ALL data files (centralized)
│   ├── amenities_consolidated.geojson
│   ├── amenities_3layers.csv
│   ├── floods_3layers.csv
│   ├── geojson/          # Reference layers (planning areas, subzones)
│   └── roadnetwork/      # Road network data
│
├── amenities/            # Amenities pipeline
│   ├── stages/           # Pipeline stages
│   │   ├── fetch_and_consolidate_stage.py
│   │   └── three_layers_stage.py
│   ├── processors/       # Processing logic (used by stages)
│   ├── amenities_pipeline.py          # Pipeline orchestrator
│   └── run_amenities_pipeline.py      # Run script
│
├── floods/               # Floods pipeline
│   ├── stages/           # Pipeline stages
│   │   ├── load_floods_stage.py
│   │   └── process_floods_three_layers_stage.py
│   ├── floods_pipeline.py             # Pipeline orchestrator
│   └── run_floods_pipeline.py         # Run script
│
├── acra/                 # ACRA businesses pipeline
│   ├── pipeline.py                    # Pipeline with all stages
│   └── run_acra_pipeline.py           # Run script
│
└── pub/                  # PUB weather alerts pipeline
    ├── stages/           # Pipeline stages
    ├── weather_alerts_pipeline.py     # Pipeline orchestrator
    └── run script files
```

## Pipelines

### 1. Amenities Pipeline

**Purpose:** Process amenity data (childcare, schools, hawker centres, etc.)

**Stages:**
1. **FetchAndConsolidateStage** - Fetch from OneMap API + consolidate with GeoJSON/OSM
2. **AmenitiesThreeLayersStage** - Geocode to PA/SZ, classify, match roads
3. **DatabaseWriteStage** - Upload to Supabase

**Input:** OneMap API + local files
**Output:** `data/amenities_3layers.csv` → Supabase `amenities` table

**Run:**
```bash
python backend/etl/amenities/run_amenities_pipeline.py
```

---

### 2. Floods Pipeline

**Purpose:** Process flood event data

**Stages:**
1. **LoadFloodsStage** - Load from floods CSV
2. **ProcessFloodsThreeLayersStage** - Match to PA/SZ/RN
3. **DatabaseWriteStage** - Upload to Supabase

**Input:** `data/floods/floods_fixed.csv`
**Output:** `data/floods_3layers.csv` → Supabase `floods` table

**Run:**
```bash
python backend/etl/floods/run_floods_pipeline.py
```

---

### 3. ACRA Businesses Pipeline

**Purpose:** Process business registration data from data.gov.sg

**Stages:**
1. **FetchACRAStage** - Fetch from data.gov.sg API
2. **TransformACRAStage** - Filter and clean business data
3. **LocationIQPostalGeocodeStage** - Geocode by postal code
4. **DatabaseWriteStage** - Upload to Supabase

**Input:** data.gov.sg API (27 datasets A-Z)
**Output:** `data/acra_all.csv` → Supabase `acra_companies` table

**Columns:** uen, entity_name, street_name, building_name, postal_code
**Status Filter:** Live Company, Live, Converted to LLP, Live (Receiver or Receiver and Manager appointed)

**Run:**
```bash
python backend/etl/acra/run_acra_pipeline.py
```

**Schedule:** Run monthly (cron job)

---

### 4. PUB Weather Alerts Pipeline

**Purpose:** Process weather alert messages from PUB

**Stages:**
1. **WeatherAlertsProcessingStage** - Parse alert text
2. **LocationGeocodingStage** - Geocode locations
3. **WeatherAlertsDatabaseWriteStage** - Upload to Supabase

**Input:** Weather alert messages
**Output:** Supabase `PUB_weather_alerts` table

---

## Common Components

### Pipeline Base Class
All pipelines extend `etl.common.pipeline.Pipeline`:
- Sequential stage execution
- Error handling
- Logging
- Async support

### PipelineStage Base Class
All stages extend `etl.common.pipeline_stage.PipelineStage`:
- Standardized `process()` method
- Config validation
- Error handling

### DatabaseWriteStage
Reusable stage for writing to Supabase:
- Batch writing
- Upsert support
- Flexible data formats (dict, list, DataFrame, Pydantic)

## Data Flow

```
┌─────────────────┐
│  Data Sources   │
│  - OneMap API   │
│  - data.gov.sg  │
│  - CSV files    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Stage 1: Fetch │
│  & Load Data    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Stage 2:       │
│  Transform &    │
│  Process        │
│  (3 layers)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Stage 3:       │
│  Database Write │
│  (Supabase)     │
└─────────────────┘
```

## Three Layers Processing

Most pipelines include "3 layers" processing that matches locations to:

1. **Planning Areas (PA)** - `pa_id` or `start_pa_id`/`end_pa_id`
2. **Subzones (SZ)** - `sz_id` or `start_sz_id`/`end_sz_id`
3. **Road Network (RN)** - `rn_id` or `start_rn_id`/`end_rn_id`

This enables spatial analysis across Singapore's administrative boundaries and road network.

## File Organization

### Data Files
All data is stored in `backend/etl/data/`:
- Input files: GeoJSON, CSV
- Intermediate files: Use temp files (auto-cleaned)
- Output files:
  - `amenities_consolidated.geojson` - Consolidated amenities
  - `amenities_3layers.csv` - Amenities with PA/SZ/RN IDs
  - `floods_3layers.csv` - Floods with PA/SZ/RN IDs
  - `acra_all.csv` - ACRA businesses (uen, entity_name, street_name, building_name, postal_code)

### Code Files
Each pipeline has minimal, focused files:
- `stages/` - One file per stage
- `*_pipeline.py` - Pipeline orchestrator
- `run_*_pipeline.py` - Executable run script

## Adding a New Pipeline

1. Create pipeline directory: `backend/etl/my_pipeline/`
2. Create stages in `stages/` folder
3. Create pipeline class extending `Pipeline`
4. Create run script
5. Data goes to `backend/etl/data/`

Example:
```python
from backend.etl.common.pipeline import Pipeline
from backend.etl.common.database_write_stage import DatabaseWriteStage

class MyPipeline(Pipeline):
    def __init__(self, config=None, db_table="my_table"):
        stages = [
            MyFetchStage(),
            MyProcessStage(),
            DatabaseWriteStage(table_name=db_table),
        ]
        super().__init__(name="My Pipeline", stages=stages, config=config)
```

## Scheduling

Set up cron jobs or task schedulers to run pipelines:

```bash
# Run amenities pipeline daily
0 2 * * * cd /path/to/project && python backend/etl/amenities/run_amenities_pipeline.py

# Run ACRA pipeline monthly
0 3 1 * * cd /path/to/project && python backend/etl/acra/run_acra_pipeline.py

# Run floods pipeline every 3 months
0 4 1 */3 * cd /path/to/project && python backend/etl/floods/run_floods_pipeline.py
```

## Development

### Running Locally
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Run a pipeline
python backend/etl/amenities/run_amenities_pipeline.py
```

### Testing
Each stage can be tested independently:
```python
from backend.etl.amenities.stages import FetchAndConsolidateStage

stage = FetchAndConsolidateStage()
result = await stage.process(None)
```

### Logging
All pipelines use Python's logging module:
```python
import logging
logging.basicConfig(level=logging.INFO)
```

## Benefits of This Architecture

✅ **Consistent** - All pipelines follow the same pattern
✅ **Modular** - Stages are independent and reusable
✅ **Testable** - Each stage can be tested in isolation
✅ **Maintainable** - Clear separation of concerns
✅ **Scalable** - Easy to add new pipelines or stages
✅ **Observable** - Built-in logging and error handling

## Migration from Old Code

The old messy code has been cleaned up:
- ❌ Removed: Multiple scattered scripts
- ❌ Removed: Duplicate pipeline stage implementations
- ❌ Removed: Data files in pipeline directories
- ✅ Added: Clean pipeline orchestrators
- ✅ Added: Reusable stage classes
- ✅ Added: Centralized data directory
