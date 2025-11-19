import json
from pathlib import Path
import pandas as pd


def lower_csv(path: Path) -> bool:
    if not path.exists():
        return False
    df = pd.read_csv(path)
    if 'amenity_name' in df.columns:
        df['amenity_name'] = df['amenity_name'].astype(str).str.strip().str.lower()
        df.to_csv(path, index=False)
        print(f"✓ Lowercased amenity_name in CSV: {path}")
        return True
    return False


def lower_geojson(path: Path) -> bool:
    if not path.exists():
        return False
    with path.open('r', encoding='utf-8') as f:
        data = json.load(f)
    changed = False
    for feat in data.get('features', []):
        props = feat.get('properties') or {}
        if 'amenity_name' in props and isinstance(props['amenity_name'], str):
            new_val = props['amenity_name'].strip().lower()
            if new_val != props['amenity_name']:
                props['amenity_name'] = new_val
                changed = True
    if changed:
        with path.open('w', encoding='utf-8') as f:
            json.dump(data, f)
        print(f"✓ Lowercased amenity_name in GeoJSON: {path}")
    else:
        print(f"No amenity_name changes needed for: {path}")
    return changed


if __name__ == "__main__":
    base = Path(__file__).resolve().parents[1]
    paths_csv = [
        base / 'data' / 'amenities_3layers.csv',
        base / 'data' / 'amenities' / 'amenities_3layers.csv',
    ]
    paths_geojson = [
        base / 'data' / 'amenities_3layers.geojson',
        base / 'data' / 'amenities' / 'amenities_3layers.geojson',
        Path(__file__).resolve().parents[3] / 'frontend' / 'public' / 'map' / 'amenities_3layers.geojson',
    ]

    for p in paths_csv:
        lower_csv(p)
    for p in paths_geojson:
        lower_geojson(p)

