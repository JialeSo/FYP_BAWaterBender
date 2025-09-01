import requests
import json
import pathlib
import time
import re

# Where to save the combined GeoJSON
out_file = pathlib.Path("all_amenities.geojson")

# Clean title to be used in layer_type
def safe_layer_name(name):
    name = name.lower().strip().replace(" ", "_")
    name = re.sub(r"[^\w\-_]", "", name)
    return name

# The webmap ID from ArcGIS
webmap_id = "4f6350005bce4b02835430ba7b64a0ac"

# Helper for GET requests
def get(url, params=None):
    params = params or {}
    params["f"] = "pjson"
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    return r.json()

# Step 1: Load webmap data
item_data_url = f"https://www.arcgis.com/sharing/rest/content/items/{webmap_id}/data"
webmap = get(item_data_url)

# Step 2: Extract all operational layer URLs
layers = []
for layer in webmap.get("operationalLayers", []):
    if "url" in layer:
        layers.append({
            "title": safe_layer_name(layer.get("title", "layer")),
            "url": layer["url"].rstrip("/")
        })

print(f"✅ Found {len(layers)} layers")

# Helper: get max record count per layer
def get_max_record_count(layer_url):
    meta = get(layer_url)
    return meta.get("maxRecordCount", 1000)

# Helper: list sublayer indices
def list_sublayers(service_url):
    meta = get(service_url)
    if "layers" in meta:
        return [str(l["id"]) for l in meta["layers"]]
    elif service_url.rstrip("/").split("/")[-1].isdigit():
        return [service_url.rstrip("/").split("/")[-1]]
    return []

# Query and collect features with `layer_type` added
def fetch_features(layer_url, layer_type):
    print(f"    → Fetching from: {layer_url}")
    features = []
    max_count = get_max_record_count(layer_url)

    # Get total count
    count = get(layer_url + "/query", {
        "where": "1=1",
        "returnCountOnly": "true"
    }).get("count", 0)

    offset = 0
    while offset < count:
        print(f"      🌀 {offset} / {count}")
        params = {
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "resultOffset": offset,
            "resultRecordCount": max_count,
            "f": "geojson"
        }
        r = requests.get(layer_url + "/query", params=params, timeout=60)
        r.raise_for_status()
        data = r.json()
        feats = data.get("features", [])

        # Inject layer_type into properties
        for feat in feats:
            feat["properties"]["layer_type"] = layer_type

        features += feats
        if len(feats) < max_count:
            break
        offset += max_count
        time.sleep(0.2)

    return features

# Step 3: Loop and combine features
all_features = []

for layer in layers:
    print(f"\n🔍 {layer['title']}")
    if layer["url"].endswith(("FeatureServer", "MapServer")):
        sublayers = list_sublayers(layer["url"])
        for sub_id in sublayers:
            full_url = f"{layer['url']}/{sub_id}"
            feats = fetch_features(full_url, layer["title"])
            all_features.extend(feats)
    else:
        feats = fetch_features(layer["url"], layer["title"])
        all_features.extend(feats)

# Step 4: Write to one big GeoJSON file
print(f"\n📦 Total features collected: {len(all_features)}")
geojson = {
    "type": "FeatureCollection",
    "features": all_features
}
with open(out_file, "w", encoding="utf-8") as f:
    json.dump(geojson, f, ensure_ascii=False)
print(f"✅ Saved to {out_file.resolve()}")
