import pandas as pd
import geopandas as gpd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from shapely.geometry import Point
import warnings
warnings.filterwarnings('ignore')

# Cell 1: Load your data
def load_singapore_data():
    """Load your Singapore data"""
    print("Loading Singapore data...")
    
    childcare = gpd.read_file("./geojson/childcare.geojson")
    planning_area = gpd.read_file("./geojson/planning_area.geojson")
    
    print(f"✅ Loaded {len(childcare)} childcare facilities")
    print(f"✅ Loaded {len(planning_area)} planning areas")
    
    # Display columns to see what data we have
    print(f"\nChildcare columns: {childcare.columns.tolist()}")
    print(f"Planning area columns: {planning_area.columns.tolist()}")
    
    # Check CRS
    print(f"Childcare CRS: {childcare.crs}")
    print(f"Planning area CRS: {planning_area.crs}")
    
    return childcare, planning_area

# Cell 2: Prepare data for accessibility analysis
def prepare_data_for_accessibility(childcare, planning_area):
    """Prepare data - use planning area centroids as origins"""
    print("Preparing data for accessibility analysis...")
    
    # Make sure both datasets have the same CRS
    if childcare.crs != planning_area.crs:
        childcare = childcare.to_crs(planning_area.crs)
        print("Aligned CRS between datasets")
    
    # Create planning area centroids as origins
    origins = planning_area.copy()
    origins['centroid'] = origins.geometry.centroid
    origins['demand'] = 100  # Assume uniform demand for now
    
    # Prepare childcare data 
    destinations = childcare.copy()
    destinations['capacity'] = 100  # Assume uniform capacity for now
    
    print(f"Prepared {len(origins)} planning areas as origins")
    print(f"Prepared {len(destinations)} childcare facilities as destinations")
    
    return origins, destinations

# Cell 3: Calculate distances
def calculate_distances(origins, destinations):
    """Calculate distance matrix between planning area centroids and childcare"""
    print("Calculating distance matrix...")
    
    distances = np.zeros((len(origins), len(destinations)))
    
    for i, origin_centroid in enumerate(origins['centroid']):
        for j, destination_point in enumerate(destinations.geometry):
            # Distance in meters (assuming Singapore projected coordinates)
            distances[i, j] = origin_centroid.distance(destination_point)
    
    # Convert to kilometers
    distances = distances / 1000
    
    print(f"Distance matrix shape: {distances.shape}")
    print(f"Distance range: {distances.min():.2f} - {distances.max():.2f} km")
    
    return distances

# Cell 4: Hansen accessibility calculation
def hansen_accessibility(demand, capacity, distances, power=2):
    """Calculate Hansen accessibility"""
    accessibility = np.zeros(len(demand))
    
    for i in range(len(demand)):
        accessibility[i] = np.sum(capacity / (distances[i, :] ** power + 0.001))
    
    return accessibility

# Cell 5: Plot accessibility map
def plot_planning_area_accessibility(planning_areas, accessibility_values, childcare, title):
    """Plot accessibility map using planning areas"""
    fig, ax = plt.subplots(figsize=(15, 12))
    
    # Add accessibility values to planning areas
    planning_areas_plot = planning_areas.copy()
    planning_areas_plot['accessibility'] = accessibility_values
    
    # Plot planning areas with accessibility colors
    planning_areas_plot.plot(
        column='accessibility',
        cmap='YlOrRd',
        legend=True,
        ax=ax,
        edgecolor='black',
        linewidth=0.5,
        legend_kwds={'label': 'Accessibility Score', 'shrink': 0.8}
    )
    
    # Plot childcare facilities as points
    childcare.plot(
        ax=ax,
        color='blue',
        markersize=20,
        alpha=0.7,
        marker='o'
    )
    
    # Styling
    ax.set_title(title, fontsize=18, fontweight='bold', pad=20)
    ax.set_xlabel('Longitude' if planning_areas.crs.to_string() == 'EPSG:4326' else 'Easting (m)')
    ax.set_ylabel('Latitude' if planning_areas.crs.to_string() == 'EPSG:4326' else 'Northing (m)')
    ax.grid(True, alpha=0.3)
    
    # Remove axis ticks for cleaner look
    ax.tick_params(labelsize=10)
    
    plt.tight_layout()
    plt.show()
    
    return fig, ax

# Cell 6: Summary statistics
def print_accessibility_stats(planning_areas, accessibility_values, area_name_col=None):
    """Print accessibility statistics by planning area"""
    
    # Try to find area name column
    possible_name_cols = ['name', 'NAME', 'area_name', 'AREA_NAME', 'planning_area', 'PLANNING_AREA']
    name_col = None
    
    for col in possible_name_cols:
        if col in planning_areas.columns:
            name_col = col
            break
    
    if name_col:
        print(f"\n=== Accessibility Statistics by Planning Area ===")
        results = pd.DataFrame({
            'Planning_Area': planning_areas[name_col],
            'Accessibility': accessibility_values
        }).sort_values('Accessibility', ascending=False)
        
        print(f"Top 5 Most Accessible Planning Areas:")
        print(results.head())
        
        print(f"\nBottom 5 Least Accessible Planning Areas:")
        print(results.tail())
        
    print(f"\n=== Overall Statistics ===")
    print(f"Mean accessibility: {accessibility_values.mean():.2f}")
    print(f"Std accessibility: {accessibility_values.std():.2f}")
    print(f"Min accessibility: {accessibility_values.min():.2f}")
    print(f"Max accessibility: {accessibility_values.max():.2f}")

# Cell 7: Run complete analysis
def run_planning_area_analysis():
    """Run the complete planning area accessibility analysis"""
    
    print("=== Singapore Planning Area Childcare Accessibility Analysis ===\n")
    
    # Step 1: Load data
    childcare, planning_area = load_singapore_data()
    
    # Step 2: Prepare data
    origins, destinations = prepare_data_for_accessibility(childcare, planning_area)
    
    # Step 3: Calculate distances
    distances = calculate_distances(origins, destinations)
    
    # Step 4: Calculate Hansen accessibility
    print("\nCalculating Hansen accessibility...")
    accessibility = hansen_accessibility(
        origins['demand'].values,
        destinations['capacity'].values, 
        distances
    )
    
    # Step 5: Create visualization
    plot_planning_area_accessibility(
        planning_area, 
        accessibility, 
        childcare,
        'Childcare Accessibility by Planning Area (Hansen Method)'
    )
    
    # Step 6: Print statistics
    print_accessibility_stats(planning_area, accessibility)
    
    # Return data for further analysis
    return planning_area, childcare, accessibility, distances

# Cell 8: Alternative simple visualization
def simple_accessibility_plot(planning_areas, accessibility_values):
    """Simple bar chart of accessibility by planning area"""
    
    # Find name column
    name_col = None
    possible_name_cols = ['name', 'NAME', 'area_name', 'AREA_NAME', 'planning_area', 'PLANNING_AREA']
    for col in possible_name_cols:
        if col in planning_areas.columns:
            name_col = col
            break
    
    if name_col:
        plt.figure(figsize=(15, 8))
        
        df = pd.DataFrame({
            'Area': planning_areas[name_col],
            'Accessibility': accessibility_values
        }).sort_values('Accessibility', ascending=True)
        
        plt.barh(range(len(df)), df['Accessibility'], color='skyblue')
        plt.yticks(range(len(df)), df['Area'])
        plt.xlabel('Accessibility Score')
        plt.title('Childcare Accessibility by Planning Area')
        plt.grid(axis='x', alpha=0.3)
        plt.tight_layout()
        plt.show()
    else:
        print("Could not find area name column for bar chart")

print("=== Ready to run! ===")
print("Execute: planning_area, childcare, accessibility, distances = run_planning_area_analysis()")
print("Or run step by step using the individual functions above")