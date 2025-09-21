import folium
import json

# Load your GeoJSON file or object
with open("road_network.geojson", "r") as f:
    geojson_data = json.load(f)

# Center map (e.g. Singapore)
m = folium.Map(location=[1.3521, 103.8198], zoom_start=13)

# Add GeoJSON layer
folium.GeoJson(geojson_data, name="Road Network").add_to(m)

# Add layer control and display
folium.LayerControl().add_to(m)
m.save("map.html")
print("✅ Map saved as map.html — open it in your browser.")
