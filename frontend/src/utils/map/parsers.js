// robust CSV -> array of objects (supports quotes, escaped quotes)
export function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { if (row.length && !(row.length === 1 && row[0].trim() === "")) rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        const peek = text[i + 1];
        if (peek === "\"") { field += "\""; i++; }
        else { inQuotes = false; }
      } else field += ch;
      continue;
    }
    if (ch === "\"") inQuotes = true;
    else if (ch === ",") pushField();
    else if (ch === "\r") {}
    else if (ch === "\n") { pushField(); pushRow(); }
    else field += ch;
  }
  if (field.length > 0) { pushField(); pushRow(); }
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || r.length === 0) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = r[j] ?? "";
    out.push(obj);
  }
  return out;
}

// amenity CSV rows -> GeoJSON points
export function amenitiesCsvToGeoJSON(rows) {
  const features = [];
  for (const r of rows) {
    const lon = Number(r.lon ?? r.LON ?? r.longitude ?? r.LONGITUDE);
    const lat = Number(r.lat ?? r.LAT ?? r.latitude ?? r.LATITUDE);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const properties = { ...r };
    ["amenity_priority","amenity_weight","importance_score","flood_count"].forEach((k) => {
      if (properties[k] != null && properties[k] !== "") {
        const num = Number(properties[k]); if (Number.isFinite(num)) properties[k] = num;
      }
    });
    if (properties.amenity_category) properties.amenity_category = String(properties.amenity_category).trim();
    if (properties.amenity_type) properties.amenity_type = String(properties.amenity_type).trim();
    if (properties.planning_area) properties.planning_area = String(properties.planning_area).trim();
    if (properties.subzone) properties.subzone = String(properties.subzone).trim();

    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });
  }
  return { type: "FeatureCollection", features };
}

// floodsv2.csv rows -> GeoJSON points (uses start_lat/lng + curated props)
export function floodsCsvToGeoJSON(rows) {
  const features = [];
  for (const r of rows) {
    const lat = Number(r.start_lat);
    const lng = Number(r.start_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const properties = {
      id: r.id ?? "",
      text: r.text ?? "",
      event_date: r.event_date ?? "",
      location: r.location ?? r.cleaned_location ?? "",
      event: r.event ?? "",
      planning_area: (r.start_planning_area ?? "").toString().trim(),
      subzone: (r.start_subzone ?? "").toString().trim(),
      start_planning_area: r.start_planning_area ?? "",
      start_subzone: r.start_subzone ?? "",
      end_planning_area: r.end_planning_area ?? "",
      end_subzone: r.end_subzone ?? "",
      start_street_name: r.start_street_name ?? "",
      end_street_name: r.end_street_name ?? "",
      start_postal_code: r.start_postal_code ?? "",
      end_postal_code: r.end_postal_code ?? "",
      parent_road: r.parent_road ?? "",
    };

    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties });
  }
  return { type: "FeatureCollection", features };
}
