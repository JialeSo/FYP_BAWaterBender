import requests
import xml.etree.ElementTree as ET
import json

# Step 1: Get download URL from dataset
dataset_id = "d_717cd51c67db03f2d9c7c18c89c32df1"
url = f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download"
response = requests.get(url)
download_json = response.json()

if download_json['code'] != 0:
    print(download_json['errMsg'])
    exit(1)

download_url = download_json['data']['url']
response = requests.get(download_url)

# Step 2: Parse KML content
kml_text = response.text
ns = {
    "kml": "http://www.opengis.net/kml/2.2"
}
root = ET.fromstring(kml_text)

# Step 3: Convert to GeoJSON
features = []

for placemark in root.findall(".//kml:Placemark", ns):
    # Extract attributes
    props = {}
    for simple_data in placemark.findall(".//kml:SimpleData", ns):
        name = simple_data.attrib['name']
        props[name] = simple_data.text

    # Extract coordinates (LineString only)
    coords_elem = placemark.find(".//kml:LineString/kml:coordinates", ns)
    if coords_elem is None:
        continue

    raw_coords = coords_elem.text.strip().split()
    line_coords = []
    for coord in raw_coords:
        lon, lat, *_ = map(float, coord.split(','))
        line_coords.append([lon, lat])

    feature = {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": line_coords
        },
        "properties": props
    }
    features.append(feature)

geojson = {
    "type": "FeatureCollection",
    "features": features
}

#%%
# Output GeoJSON
print(json.dumps(geojson, indent=2))

with open("road_network.geojson", "w") as f:
    json.dump(geojson, f, indent=2)

# %%
