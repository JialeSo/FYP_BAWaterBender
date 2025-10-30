import proj4 from "proj4";

/** ---- SVY21 (EPSG:3414) → WGS84 ---- */
const EPSG3414 =
  "+proj=tmerc +lat_0=1.3666666666666667 +lon_0=103.83333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs";

const num = (v) => (typeof v === "string" ? Number(v) : v);

const isLonLat = (x, y) =>
  Number.isFinite(x) && Number.isFinite(y) && x >= -180 && x <= 180 && y >= -90 && y <= 90;

const isSVY21 = (x, y) =>
  Number.isFinite(x) && Number.isFinite(y) && x > 1000 && y > 1000 && (x > 10000 || y > 10000);

const toWgs84 = (pt) => {
  const x = num(pt[0]);
  const y = num(pt[1]);
  const [lon, lat] = proj4(EPSG3414, proj4.WGS84, [x, y]);
  return [lon, lat];
};

export const reprojectGeometryIfNeeded = (geometry) => {
  if (!geometry?.coordinates) return geometry;

  const convert = (coord) => {
    const x = num(coord[0]);
    const y = num(coord[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return coord;
    if (isLonLat(x, y)) return [x, y];
    if (isSVY21(x, y)) return toWgs84([x, y]);
    return [x, y];
  };

  const walk = (coords) =>
    typeof coords[0] === "number" || typeof coords[0] === "string"
      ? convert(coords)
      : coords.map(walk);

  return { ...geometry, coordinates: walk(geometry.coordinates) };
};

const toFeature = (row, idProp) => {
  if (!row) return null;

  if (row.type === "Feature" && row.geometry) {
    const g = reprojectGeometryIfNeeded(row.geometry);
    const feat = { ...row, geometry: g };
    if (idProp && row.properties?.[idProp] != null) feat.id = String(row.properties[idProp]);
    return feat;
  }

  if (row.geometry && row.properties) {
    const g = reprojectGeometryIfNeeded(row.geometry);
    const feat = { type: "Feature", geometry: g, properties: row.properties };
    if (idProp && feat.properties?.[idProp] != null) feat.id = String(feat.properties[idProp]);
    return feat;
  }

  // common BE shape: { id, pln_area_n, area_id, geom }
  if (row.geom?.type && row.geom?.coordinates) {
    const g = reprojectGeometryIfNeeded(row.geom);
    const { geom, ...propsRaw } = row;

    const props = {
      ...propsRaw,
      PLN_AREA_N: String(propsRaw.PLN_AREA_N ?? propsRaw.pln_area_n ?? "").trim(),
      PA_ID: String(propsRaw.PA_ID ?? propsRaw.area_id ?? propsRaw.id ?? "").trim(),
    };

    const feat = { type: "Feature", geometry: g, properties: props };
    const idFrom =
      (idProp && props[idProp] != null && String(props[idProp])) ||
      (props.PA_ID ? String(props.PA_ID) : null) ||
      (row.id != null ? String(row.id) : null);
    if (idFrom) feat.id = idFrom;
    return feat;
  }

  // fallback: point-ish
  const lon =
    row.longitude ?? row.lon ?? row.lng ?? row.LON ?? row.x ?? row.X ??
    (Array.isArray(row.coordinates) ? row.coordinates[0] : undefined);
  const lat =
    row.latitude ?? row.lat ?? row.LAT ?? row.y ?? row.Y ??
    (Array.isArray(row.coordinates) ? row.coordinates[1] : undefined);

  if (Number.isFinite(num(lon)) && Number.isFinite(num(lat))) {
    let coords = [num(lon), num(lat)];
    if (isSVY21(coords[0], coords[1])) coords = toWgs84(coords);
    const props = { ...row };
    ["longitude","lon","lng","LON","x","X","latitude","lat","LAT","y","Y","coordinates"].forEach((k)=>delete props[k]);
    const feat = { type: "Feature", geometry: { type: "Point", coordinates: coords }, properties: props };
    if (idProp && feat.properties?.[idProp] != null) feat.id = String(feat.properties[idProp]);
    return feat;
  }

  return null;
};

export const asFeatureCollection = (input, { idProp } = {}) => {
  if (!input) return { type: "FeatureCollection", features: [] };

  if (input.type === "FeatureCollection" && Array.isArray(input.features)) {
    return {
      type: "FeatureCollection",
      features: input.features
        .map((f) => (f?.type === "Feature" ? { ...f, geometry: reprojectGeometryIfNeeded(f.geometry) } : null))
        .filter(Boolean),
    };
  }

  if (input.geom?.type && input.geom?.coordinates) {
    const f = toFeature(input, idProp);
    return { type: "FeatureCollection", features: f ? [f] : [] };
  }

  const rows = Array.isArray(input) ? input : Array.isArray(input.data) ? input.data : null;
  if (rows) {
    return { type: "FeatureCollection", features: rows.map((r) => toFeature(r, idProp)).filter(Boolean) };
  }

  if (input.type === "Feature" || (input.geometry && input.properties)) {
    const f = toFeature(input, idProp);
    return { type: "FeatureCollection", features: f ? [f] : [] };
  }

  return { type: "FeatureCollection", features: [] };
};

export const computeBounds = (fc) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = ([x, y]) => {
    const nx = num(x), ny = num(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
    minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
  };
  const walk = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === "number" || typeof coords[0] === "string") add(coords);
    else coords.forEach(walk);
  };
  (fc?.features || []).forEach((f) => walk(f.geometry?.coordinates));
  if (minX === Infinity) return null;
  return [[minX, minY], [maxX, maxY]];
};
