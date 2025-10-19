# Quick Start: OD Flow-Based Accessibility

This guide will help you get started with OD (Origin-Destination) flow-based accessibility analysis in **under 10 minutes**.

## Prerequisites

1. **LTA DataMall API Key**
   - Visit: https://datamall2.mytransport.sg/
   - Sign up and request API access
   - Copy your API key

2. **Python Dependencies**
   ```bash
   pip install geopandas pandas requests h3 pysal rtree scikit-learn matplotlib seaborn
   ```

3. **Required Data Files**
   - Subzone boundaries: `backend/etl/data/geojson/subzone_area.geojson`
   - Planning area boundaries: `backend/etl/data/geojson/planning_area.geojson`
   - Amenities dataset: `backend/etl/data/amenities/amenities_3layers.csv`

## Step 1: Set API Key

```bash
# Option 1: .env file (preferred)
echo 'SLA_API_KEY=your-api-key-here' >> ./backend/.env  # or project root .env

# Option 2: Environment variable
export SLA_API_KEY="your-api-key-here"

# Option 3: Add to your shell profile (~/.bashrc or ~/.zshrc)
echo 'export SLA_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

## Step 2: Run Example Analysis

The easiest way to get started is using the example script:

```bash
cd backend/etl/amenities/step_04_accessibility_analysis

# Basic analysis (train + bus, healthcare facilities, March 2024)
python example_od_accessibility.py --date 202403

# Different category
python example_od_accessibility.py --date 202403 --category transport_services

# Train only
python example_od_accessibility.py --date 202403 --modes train

# Compare models
python example_od_accessibility.py --date 202403 --compare-models
```

**Output:**
- Accessibility scores (GeoJSON and CSV)
- Demand distribution maps
- Visualization plots
- All saved to `output/od_accessibility/`

## Step 3: Python Script Example

Create a file called `my_od_analysis.py`:

```python
#!/usr/bin/env python3
import os
import geopandas as gpd
import pandas as pd

from step_04_accessibility_analysis import (
    LTAODClient,
    ODAccessibilityEngine,
    ODAccessibilityConfig
)

# 1. Fetch OD data
print("Fetching OD data from LTA DataMall...")
client = LTAODClient(api_key=os.getenv("SLA_API_KEY") or os.getenv("LTA_API_KEY"))
od_train = client.fetch_od_train(date="202403")  # March 2024
od_bus = client.fetch_od_bus(date="202403")

# 2. Configure engine
print("Configuring accessibility engine...")
config = ODAccessibilityConfig(
    aggregation_level="subzone",
    day_types=["WEEKDAY"],  # Weekday patterns only
    time_periods=["7", "8", "9"],  # Morning peak hours
)

engine = ODAccessibilityEngine(
    subzones_geojson="backend/etl/data/geojson/subzone_area.geojson",
    planning_areas_geojson="backend/etl/data/geojson/planning_area.geojson",
    config=config,
    lta_client=client
)

# 3. Load amenities
print("Loading amenity data...")
amenities_df = pd.read_csv("backend/etl/data/amenities/amenities_3layers.csv")

# Filter to healthcare facilities
healthcare = amenities_df[
    amenities_df["amenity_category"] == "Healthcare_facilities"
].copy()

# Convert to GeoDataFrame
amenities_gdf = gpd.GeoDataFrame(
    healthcare,
    geometry=gpd.points_from_xy(healthcare["lon"], healthcare["lat"]),
    crs="EPSG:4326"
)

# 4. Compute accessibility
print("Computing OD-based accessibility...")
results = engine.compute_with_od_flows(
    amenities=amenities_gdf,
    od_train=od_train,
    od_bus=od_bus,
    model="hansen"  # Hansen gravity accessibility (default)
)

# 5. Export results
print("Exporting results...")
engine.export_results(
    results,
    output_dir="output/my_analysis"
)

# 6. Print summary statistics
scores = results["accessibility_scores"]["accessibility_score"]
print(f"\nAccessibility Summary:")
print(f"  Mean:   {scores.mean():.4f}")
print(f"  Median: {scores.median():.4f}")
print(f"  Min:    {scores.min():.4f}")
print(f"  Max:    {scores.max():.4f}")

# Find top 5 most accessible subzones
top_5 = results["accessibility_scores"].nlargest(5, "accessibility_score")
print(f"\nTop 5 Most Accessible Subzones:")
for idx, row in top_5.iterrows():
    print(f"  {row['spatial_unit']}: {row['accessibility_score']:.4f}")

print("\n✓ Analysis complete!")
```

Run it:
```bash
python my_od_analysis.py
```

## Step 3.5: Run OD Accessibility Through the Pipeline

Once your API key is configured you can trigger OD accessibility directly from the amenities pipeline:

```bash
python backend/etl/amenities/pipeline.py --steps 4 --od-date 202403
# Optional tuning
# Switch to 2SFCA for supply-demand fairness analysis
python backend/etl/amenities/pipeline.py \
    --steps 4 \
    --od-date 202403 \
    --od-modes train bus \
    --od-day-types WEEKDAY \
    --od-time-periods 7 8 9 \
    --od-model 2sfca \
    --od-aggregation both

The pipeline defaults to Hansen gravity accessibility; use `--od-model 2sfca` or `--od-model e2sfca` when you need supply-demand balancing metrics.
```

Outputs are written to `backend/etl/data/od_accessibility/`:

```
backend/etl/data/od_accessibility/
├── od_accessibility_subzone.geojson
├── od_accessibility_subzone.csv
├── od_demand_distribution_subzone.geojson
├── od_accessibility_planning.geojson
├── od_accessibility_planning.csv
└── od_demand_distribution_planning.geojson
```

## Step 4: View Results

Results are saved to `output/od_accessibility/` (or your custom output directory):

```
output/od_accessibility/
├── healthcare_facilities_hansen_scores.geojson  # Spatial data
├── healthcare_facilities_hansen_scores.csv      # Tabular data
├── healthcare_facilities_hansen_demand.geojson  # Demand distribution
├── healthcare_facilities_hansen_map.png         # Visualization
└── healthcare_facilities_hansen_histogram.png   # Distribution plot
```

**View in QGIS:**
1. Open QGIS
2. Drag and drop `*_scores.geojson`
3. Style by `accessibility_score` column
4. Use "YlOrRd" color ramp

**View in Python:**
```python
import geopandas as gpd
import matplotlib.pyplot as plt

gdf = gpd.read_file("output/od_accessibility/healthcare_facilities_hansen_scores.geojson")

gdf.plot(
    column="accessibility_score",
    cmap="YlOrRd",
    legend=True,
    figsize=(12, 10)
)
plt.title("Healthcare Accessibility (Hansen OD Flow-Based)")
plt.show()
```

## Common Use Cases

### Use Case 1: Peak vs Off-Peak Accessibility

```python
# Morning peak
morning_config = ODAccessibilityConfig(
    day_types=["WEEKDAY"],
    time_periods=["7", "8", "9"]
)

# Off-peak
offpeak_config = ODAccessibilityConfig(
    day_types=["WEEKDAY"],
    time_periods=["10", "11", "14", "15"]
)

# Compare
for label, config in [("Morning Peak", morning_config), ("Off-Peak", offpeak_config)]:
    engine = ODAccessibilityEngine(config=config, ...)
    results = engine.compute_with_od_flows(...)
    print(f"{label}: mean accessibility = {results['accessibility_scores']['accessibility_score'].mean():.4f}")
```

### Use Case 2: Compare Multiple Categories

```python
categories = ["healthcare_facilities", "transport_services", "essential_services"]

for category in categories:
    amenities_filtered = amenities_df[amenities_df["amenity_category"] == category]
    amenities_gdf = gpd.GeoDataFrame(...)

    results = engine.compute_with_od_flows(amenities=amenities_gdf, ...)

    print(f"{category}: mean = {results['accessibility_scores']['accessibility_score'].mean():.4f}")
```

### Use Case 3: Time Series Analysis

```python
# Analyze multiple months
dates = ["202401", "202402", "202403"]  # Jan-Mar 2024

monthly_results = {}
for date in dates:
    od_train = client.fetch_od_train(date=date)
    od_bus = client.fetch_od_bus(date=date)

    results = engine.compute_with_od_flows(
        amenities=amenities_gdf,
        od_train=od_train,
        od_bus=od_bus
    )

    monthly_results[date] = results["accessibility_scores"]["accessibility_score"].mean()

# Plot trend
import matplotlib.pyplot as plt
plt.plot(dates, [monthly_results[d] for d in dates])
plt.xlabel("Month")
plt.ylabel("Mean Accessibility")
plt.title("Accessibility Trend")
plt.show()
```

## Troubleshooting

### Problem: "SLA_API_KEY not found"

**Solution:**
```bash
# Check if set
echo $SLA_API_KEY

# If empty, set it

# Or pass directly in Python
client = LTAODClient(api_key="your-key-here")
```

### Problem: "No data available for date"

**Solution:**
- OD data is published monthly by the 10th
- Can only request last 3 months
- Use a valid date: `202403` (YYYYMM format)
- Check LTA DataMall status page

### Problem: "Module not found"

**Solution:**
```bash
# Install all dependencies
pip install geopandas pandas requests h3 pysal rtree scikit-learn

# Or use requirements file
pip install -r requirements.txt
```

### Problem: "File not found: subzone_area.geojson"

**Solution:**
- Ensure you're in the correct directory
- Use absolute paths:
```python
subzones_geojson="/absolute/path/to/backend/etl/data/geojson/subzone_area.geojson"
```

## Next Steps

1. **Read the full documentation**: [README_OD_ACCESSIBILITY.md](README_OD_ACCESSIBILITY.md)
2. **Explore different models**: Try "hansen", "2sfca", and "e2sfca"
3. **Integrate with pipeline**: Add OD analysis to your ETL workflow
4. **Customize parameters**: Adjust decay functions, distance thresholds, etc.
5. **Compare with traditional methods**: Run both OD-based and population-based analyses

## Example Output

After running the analysis, you should see output like:

```
======================================================================
Fetching OD Train Data
======================================================================
  Requesting OD train data (date=202403)...
  ✓ Download link received (expires in 5 min)
  Downloading ZIP file...
  ✓ Downloaded: data/lta_od_cache/od_train_202403.zip
  Extracting ZIP...
  ✓ Found 1 CSV file(s)
  ✓ Cached to: data/lta_od_cache/od_train_202403.csv

✓ OD Train data loaded: 1,245,832 records
  Date range: ['202403']
  Day types: ['WEEKDAY' 'WEEKEND']
  Total trips: 45,678,912

======================================================================
Computing OD Flow-Based Accessibility
======================================================================
Model: hansen
Aggregation level: subzone

Step 1: Computing demand from OD flows...
  Processing train OD data...
    ✓ Train demand: 323 spatial units, 12,345,678 total trips
  Processing bus OD data...
    ✓ Bus demand: 323 spatial units, 8,765,432 total trips
  ✓ Combined demand: 323 spatial units, 21,111,110 total trips

Step 2: Computing Hansen accessibility...

======================================================================
Results Summary
======================================================================
Spatial units analyzed: 323
Total demand (trips): 21,111,110
Amenities: 1,234

Accessibility scores:
  Mean:   0.1234
  Median: 0.0987
  Min:    0.0001
  Max:    0.8765
  Std:    0.0876

Low-accessibility areas (bottom 25%):
  Count: 81
  Examples: ['Lim Chu Kang', 'Sungei Kadut', 'Tuas', 'Pioneer', 'Western Water Catchment']

✓ Analysis complete!
```

## Resources

- **LTA DataMall**: https://datamall2.mytransport.sg/
- **Documentation**: [README_OD_ACCESSIBILITY.md](README_OD_ACCESSIBILITY.md)
- **PySAL Guide**: https://pysal.org/access/
- **Example Scripts**: [example_od_accessibility.py](example_od_accessibility.py)

Happy analyzing! 🚇📊
