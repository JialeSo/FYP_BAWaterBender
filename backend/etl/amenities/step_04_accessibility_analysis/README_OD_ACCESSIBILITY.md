# OD Flow-Based Accessibility Analysis

## Overview

This module extends the PySAL-based accessibility analysis framework with **Origin-Destination (OD) passenger flow data** from LTA DataMall. Instead of using static population estimates as demand proxies, this approach uses **actual revealed travel behavior** to compute more accurate accessibility metrics.

## Key Features

- **Real travel demand weighting**: Uses actual passenger flows from LTA's public transport network
- **Multi-modal integration**: Combines train (MRT/LRT) and bus OD data
- **Temporal filtering**: Filter by weekday/weekend and time-of-day patterns
- **Spatial aggregation**: Aggregate flows to subzones, planning areas, or H3 hexagons
- **PySAL integration**: Leverages existing accessibility models (Hansen, 2SFCA, E2SFCA)
- **Comprehensive geocoding**: Maps PT codes (station/bus stop codes) to coordinates

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    LTA DataMall API                             │
│  ┌──────────────────────┐    ┌──────────────────────┐           │
│  │ OD Train (MRT/LRT)   │    │ OD Bus               │           │
│  │ /ltaodataservice/    │    │ /ltaodataservice/    │           │
│  │ PV/ODTrain           │    │ PV/ODBus             │           │
│  └──────────────────────┘    └──────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    LTAODClient                                  │
│  • API authentication                                           │
│  • Data download (S3 ZIP files)                                 │
│  • CSV parsing and caching                                      │
│  • Rate limiting and retry logic                                │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ODGeocoder                                   │
│  • Map PT codes to lat/lon coordinates                          │
│  • Spatial join to subzones/planning areas                      │
│  • Aggregate OD flows by spatial unit                           │
│  • Support H3 hexagon aggregation                               │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                 ODAccessibilityEngine                           │
│  • Compute demand from OD flows (destination volumes)           │
│  • Apply PySAL accessibility models with OD-weighted demand     │
│  • Compare traditional vs OD-based accessibility                │
│  • Export results (GeoJSON, CSV, visualizations)                │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. LTAODClient

Handles data extraction from LTA DataMall API.

**Key Methods:**
- `fetch_od_train(date)`: Download train OD data
- `fetch_od_bus(date)`: Download bus OD data
- `fetch_bus_stops()`: Get bus stop locations
- `fetch_all_od_data(start_date, end_date)`: Batch download

**Data Format:**

| Column | Description | Example |
|--------|-------------|---------|
| YEAR_MONTH | YYYYMM format | 202403 |
| DAY_TYPE | Weekday/Weekend | WEEKDAY |
| TIME_PER_HOUR | Hour of day (0-23) | 8 |
| PT_TYPE | Mode (MRT/BUS) | MRT |
| ORIGIN_PT_CODE | Origin station/stop code | NS1 |
| DESTINATION_PT_CODE | Destination code | NS2 |
| TOTAL_TRIPS | Number of trips | 1250 |

### 2. ODGeocoder

Maps PT codes to geographic coordinates and aggregates flows.

**Key Methods:**
- `geocode_train_od(od_train_df)`: Geocode train OD pairs
- `geocode_bus_od(od_bus_df)`: Geocode bus OD pairs
- `aggregate_to_subzones(od_gdf)`: Aggregate to subzone level
- `aggregate_to_planning_areas(od_gdf)`: Aggregate to planning area level
- `aggregate_to_h3(od_gdf, resolution)`: Aggregate to H3 hexagons

**Station Code Mapping:**
Contains comprehensive mapping of Singapore MRT/LRT station codes:
- North-South Line (NS1-NS28)
- East-West Line (EW1-EW33)
- Circle Line (CC1-CC29)
- Downtown Line (DT1-DT35)
- North-East Line (NE1-NE17)

### 3. ODAccessibilityEngine

Computes accessibility using OD-weighted demand.

**Configuration Options:**

```python
config = ODAccessibilityConfig(
    aggregation_level="subzone",          # or "planning_area", "h3"
    h3_resolution=9,                      # if using H3
    time_periods=["7", "8", "9"],        # peak hours (optional)
    day_types=["WEEKDAY"],                # filter by day type (optional)
    train_weight=1.0,                     # weight for train flows
    bus_weight=1.0,                       # weight for bus flows
    decay_function="power",               # distance decay function
    decay_beta=2.0,                       # decay parameter
    max_distance_km=10.0                  # search radius
)
```

**Accessibility Models:**

1. **Hansen Gravity Model**
   - Equation: `A_i = Σ_j (S_j * f(d_ij))`
   - Best for: General accessibility assessment
   - Does not use demand weighting

2. **2SFCA (Two-Step Floating Catchment Area)**
   - Step 1: Compute supply-to-demand ratio at each amenity
   - Step 2: Sum ratios at each origin
   - Best for: Healthcare, essential services
   - **Uses OD flow volumes as demand weights**

3. **E2SFCA (Enhanced 2SFCA)**
   - Like 2SFCA but with distance decay bands
   - More realistic representation
   - **Uses OD flow volumes with distance weighting**

## Usage Examples

### Basic OD-Based Accessibility

```python
from step_04_accessibility_analysis import (
    LTAODClient,
    ODAccessibilityEngine,
    ODAccessibilityConfig
)

# 1. Fetch OD data
client = LTAODClient(api_key="your-api-key")
od_train = client.fetch_od_train(date="202403")
od_bus = client.fetch_od_bus(date="202403")

# 2. Configure engine
config = ODAccessibilityConfig(
    aggregation_level="subzone",
    day_types=["WEEKDAY"],
    time_periods=["7", "8", "9"],  # Morning peak
)

engine = ODAccessibilityEngine(
    subzones_geojson="data/geojson/subzone_area.geojson",
    planning_areas_geojson="data/geojson/planning_area.geojson",
    config=config,
    lta_client=client
)

# 3. Load amenities
amenities_gdf = gpd.read_file("amenities.geojson")

# 4. Compute accessibility
results = engine.compute_with_od_flows(
    amenities=amenities_gdf,
    od_train=od_train,
    od_bus=od_bus,
    model="hansen"  # Switch to "2sfca" for supply-demand fairness
)

# 5. Export results
engine.export_results(results, output_dir="output/od_accessibility")
```

### Compare Traditional vs OD-Based Accessibility

```python
from step_04_accessibility_analysis import (
    AccessibilityService,
    ODAccessibilityEngine
)

# Traditional population-based accessibility
traditional_service = AccessibilityService()
traditional_results = traditional_service.analyze_citywide(
    categories=["healthcare_facilities"],
    model="hansen"
)

# OD flow-based accessibility
od_engine = ODAccessibilityEngine(...)
od_results = od_engine.compute_with_od_flows(
    amenities=amenities_gdf,
    od_train=od_train,
    od_bus=od_bus,
    model="hansen"
)

# Compare distributions
import matplotlib.pyplot as plt

fig, axes = plt.subplots(1, 2, figsize=(14, 6))

axes[0].hist(traditional_results["healthcare_facilities"].scores, bins=50)
axes[0].set_title("Traditional (Population-Based)")

axes[1].hist(od_results["accessibility_scores"]["accessibility_score"], bins=50)
axes[1].set_title("OD Flow-Based")

plt.show()
```

### Time-of-Day Analysis

```python
# Morning peak accessibility
morning_config = ODAccessibilityConfig(
    day_types=["WEEKDAY"],
    time_periods=["7", "8", "9"]
)

# Evening peak accessibility
evening_config = ODAccessibilityConfig(
    day_types=["WEEKDAY"],
    time_periods=["17", "18", "19"]
)

# Off-peak accessibility
offpeak_config = ODAccessibilityConfig(
    day_types=["WEEKDAY"],
    time_periods=["10", "11", "14", "15"]
)

# Compare temporal patterns
for label, config in [("Morning", morning_config), ("Evening", evening_config)]:
    engine = ODAccessibilityEngine(config=config, ...)
    results = engine.compute_with_od_flows(...)
    print(f"{label} peak accessibility: mean={results['accessibility_scores']['accessibility_score'].mean()}")
```

### Multi-Modal Weighting

```python
# Weight train flows more heavily (e.g., for regional accessibility)
config = ODAccessibilityConfig(
    train_weight=2.0,  # Train counts double
    bus_weight=1.0     # Bus at normal weight
)

# Weight bus flows more heavily (e.g., for local accessibility)
config = ODAccessibilityConfig(
    train_weight=0.5,
    bus_weight=1.5
)
```

## Integration with Pipeline

To integrate OD-based accessibility into the main ETL pipeline:

```python
# In pipeline.py or custom analysis script

from core.config import Config
from step_04_accessibility_analysis import (
    LTAODClient,
    ODAccessibilityEngine,
    ODAccessibilityConfig
)

config = Config()

# Fetch OD data
client = LTAODClient()
od_train = client.fetch_od_train(date="202403")
od_bus = client.fetch_od_bus(date="202403")

# Configure OD engine
od_config = ODAccessibilityConfig(
    aggregation_level="subzone",
    day_types=["WEEKDAY"]
)

od_engine = ODAccessibilityEngine(
    subzones_geojson=config.paths.subzones_geojson,
    planning_areas_geojson=config.paths.planning_areas_geojson,
    config=od_config,
    lta_client=client
)

# Load processed amenities
import pandas as pd
amenities_df = pd.read_csv(config.paths.amenities_with_priority_csv)
amenities_gdf = gpd.GeoDataFrame(
    amenities_df,
    geometry=gpd.points_from_xy(amenities_df["lon"], amenities_df["lat"]),
    crs="EPSG:4326"
)

# Compute for multiple categories
for category in ["healthcare_facilities", "transport_services", "essential_services"]:
    category_amenities = amenities_gdf[
        amenities_gdf["amenity_category"] == category
    ]

    results = od_engine.compute_with_od_flows(
        amenities=category_amenities,
        od_train=od_train,
        od_bus=od_bus,
        model="hansen"
    )

    # Export
    od_engine.export_results(
        results,
        output_dir=config.paths.accessibility_planning_csv.parent,
        prefix=f"od_{category}"
    )
```

## Data Requirements

### LTA DataMall API Access

1. **Register for API key**: https://datamall2.mytransport.sg/
2. **Store API key**: Add `SLA_API_KEY=your-key` to your `.env` (preferred) or run `export SLA_API_KEY="your-key"` in your shell. (`LTA_API_KEY` is still accepted for backward compatibility.)
3. **Rate limits**: Respect LTA's rate limiting policies
4. **Data availability**: OD data updated monthly (by 10th of each month)

### Spatial Boundaries

- **Subzones**: `data/geojson/subzone_area.geojson`
- **Planning Areas**: `data/geojson/planning_area.geojson`

### Amenity Data

Required columns:
- `lon`, `lat`: Coordinates (WGS84)
- `amenity_category`: Category classification
- `importance_score`: Capacity/supply weight (optional, defaults to 1.0)

## Performance Considerations

### Caching

LTAODClient automatically caches downloaded data:
- Location: `data/lta_od_cache/`
- Format: CSV files
- Naming: `od_{mode}_{date}.csv`

To clear cache:
```bash
rm -rf data/lta_od_cache/*
```

### Memory Usage

Large datasets (e.g., full month of bus OD data) can be memory-intensive:

```python
# Filter before processing
od_bus_filtered = od_bus[od_bus["DAY_TYPE"] == "WEEKDAY"]
od_bus_peak = od_bus_filtered[od_bus_filtered["TIME_PER_HOUR"].isin([7, 8, 9])]
```

### Parallel Processing

For analyzing multiple categories/time periods:

```python
from concurrent.futures import ProcessPoolExecutor

def analyze_category(category, od_train, od_bus):
    # ... analysis code ...
    return results

with ProcessPoolExecutor(max_workers=4) as executor:
    futures = [
        executor.submit(analyze_category, cat, od_train, od_bus)
        for cat in categories
    ]
    results = [f.result() for f in futures]
```

## Troubleshooting

### API Errors

**"No download link in API response"**
- Check date format (YYYYMM)
- Verify date is within last 3 months
- Confirm data has been generated (after 10th of month)

**"Request failed"**
- Check API key validity
- Verify internet connection
- Check LTA DataMall service status

### Geocoding Issues

**"Unmapped station codes"**
- Update `SINGAPORE_TRAIN_STATIONS` dictionary with new stations
- Check for typos in station codes
- Verify station codes against LTA's official list

**"No bus stop data"**
- Ensure `lta_client` is provided to ODGeocoder
- Check bus stops API endpoint availability

### Spatial Join Failures

**"No spatial units matched"**
- Verify CRS consistency (all should be EPSG:4326)
- Check boundary file integrity
- Ensure coordinates are within Singapore bounds

## References

### LTA DataMall API
- **User Guide**: LTA DataMall API User Guide v6.4 (July 2025)
- **OD Train Endpoint**: `https://datamall2.mytransport.sg/ltaodataservice/PV/ODTrain`
- **OD Bus Endpoint**: `https://datamall2.mytransport.sg/ltaodataservice/PV/ODBus`

### Academic References
- Luo, W., & Wang, F. (2003). Measures of spatial accessibility to health care in a GIS environment. *Environment and Planning B*, 30(6), 865-884.
- Wan, N., Zou, B., & Sternberg, T. (2012). A three-step floating catchment area method for analyzing spatial access to health services. *International Journal of Geographical Information Science*, 26(6), 1073-1089.

### PySAL Documentation
- **PySAL Access**: https://github.com/pysal/access
- **Spatial Access Methods**: https://access.readthedocs.io/

## Future Enhancements

- [ ] Integration with real-time PT data (bus/train arrival times)
- [ ] Network-based distance (instead of Euclidean/Haversine)
- [ ] Time-varying accessibility (hourly temporal resolution)
- [ ] Comparison with mobile phone location data
- [ ] Machine learning models for predicting OD patterns
- [ ] Interactive web dashboard for visualization

## License

Part of FYP BAWaterBender project.

## Contact

For questions or issues, please contact the development team.
