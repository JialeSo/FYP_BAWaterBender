export const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";
export const MAP_DEFAULT_CENTER = [103.8198, 1.3521];
export const MAP_DEFAULT_ZOOM = 11;
export const PAGE_SIZE = 40;
export const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

// Flood type configurations with weights
export const FLOOD_TYPE_PRESETS = {
  all: {
    name: "All Flood Types",
    description: "Include all flood event types",
    types: {
      flash_flood: true,
      flash_flood_risk: true,
      ponding: true,
      drainage_issue: true,
    },
    weights: {
      flash_flood: 2.5,
      flash_flood_risk: 1.5,
      ponding: 1.0,
      drainage_issue: 1.0,
    },
  },
  critical: {
    name: "Critical Events Only",
    description: "Focus on flash floods and high-risk areas",
    types: {
      flash_flood: true,
      flash_flood_risk: true,
      ponding: false,
      drainage_issue: false,
    },
    weights: {
      flash_flood: 3.0,
      flash_flood_risk: 2.0,
      ponding: 0.5,
      drainage_issue: 0.5,
    },
  },
  balanced: {
    name: "Equal Weights",
    description: "All flood types weighted equally",
    types: {
      flash_flood: true,
      flash_flood_risk: true,
      ponding: true,
      drainage_issue: true,
    },
    weights: {
      flash_flood: 1.0,
      flash_flood_risk: 1.0,
      ponding: 1.0,
      drainage_issue: 1.0,
    },
  },
};

// Date range presets
export const DATE_RANGE_PRESETS = {
  lastMonth: {
    name: "Last Month",
    getDates: () => {
      const now = new Date();
      const end = new Date(now);
      const start = new Date(now.setMonth(now.getMonth() - 1));
      return {
        from: start.toISOString().split("T")[0],
        to: end.toISOString().split("T")[0],
      };
    },
  },
  last3Months: {
    name: "Last 3 Months",
    getDates: () => {
      const now = new Date();
      const end = new Date(now);
      const start = new Date(now.setMonth(now.getMonth() - 3));
      return {
        from: start.toISOString().split("T")[0],
        to: end.toISOString().split("T")[0],
      };
    },
  },
  lastYear: {
    name: "Last Year",
    getDates: () => {
      const now = new Date();
      const end = new Date(now);
      const start = new Date(now.setFullYear(now.getFullYear() - 1));
      return {
        from: start.toISOString().split("T")[0],
        to: end.toISOString().split("T")[0],
      };
    },
  },
  allTime: {
    name: "All Time",
    getDates: () => ({ from: "", to: "" }),
  },
};

// Severity levels
export const SEVERITY_LEVELS = {
  low: { name: "Low", color: "#fbbf24", value: 1 },
  medium: { name: "Medium", color: "#f97316", value: 2 },
  high: { name: "High", color: "#ef4444", value: 3 },
  critical: { name: "Critical", color: "#991b1b", value: 4 },
};

// Helper functions
export const nznum = (v) => (Number.isFinite(+v) ? +v : 0);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const strip_count_suffix = (s) => String(s).replace(/\s*\(\s*\d[\d,]*\s*\)\s*$/, "").trim();

export const to_title_case = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (!word) return "";
      const upper = word.toUpperCase();
      if (word === upper && /^[A-Z0-9]+$/.test(word)) return upper;
      const lower = word.toLowerCase();
      if (lower.length <= 2) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
};

export function format_number(val, digits = 1) {
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function format_cell(value, column) {
  if (column?.format) {
    const out = column.format(value);
    if (out !== null && out !== undefined) return out;
  }
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function format_date(dateStr) {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export const get_flood_type = (props = {}) =>
  props.flood_type ?? props.event ?? props.type ?? props.category ?? "unknown";

export const get_planning_area = (props = {}) =>
  props.origin_planning_area ?? props.planning_area ?? props.PLN_AREA_N ?? props.pa_name ?? "unknown";

export const get_subzone = (props = {}) =>
  props.origin_subzone ?? props.subzone ?? props.SUBZONE_N ?? "unknown";

export const get_location = (props = {}) =>
  props.location ?? props.address ?? props.origin_road ?? props.start_street_name ?? "—";
