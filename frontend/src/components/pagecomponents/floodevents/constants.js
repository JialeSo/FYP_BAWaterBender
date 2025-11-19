// Amenity weight presets for category-based impact calculation
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, "_");
export const AMENITY_WEIGHT_PRESETS = {
  default: {
    name: "Default",
    description: "Custom weighted priorities",
    weights: {
      [norm("Community spaces")]: 2.0,
      [norm("Education institutions")]: 2.5,
      [norm("Emergency services")]: 3.5,
      [norm("Essential services")]: 3.0,
      [norm("Government services")]: 2.5,
      [norm("Healthcare facilities")]: 4.0,
      [norm("Residential")]: 1.5,
      [norm("Retail services")]: 1.5,
      [norm("Tourism")]: 1.0,
      [norm("Transport services")]: 2.5,
    },
  },
  balanced: {
    name: "Balanced",
    description: "All categories weighted equally",
    weights: {
      [norm("Community spaces")]: 1.0,
      [norm("Education institutions")]: 1.0,
      [norm("Emergency services")]: 1.0,
      [norm("Essential services")]: 1.0,
      [norm("Government services")]: 1.0,
      [norm("Healthcare facilities")]: 1.0,
      [norm("Residential")]: 1.0,
      [norm("Retail services")]: 1.0,
      [norm("Tourism")]: 1.0,
      [norm("Transport services")]: 1.0,
    },
  },
  emergency: {
    name: "Emergency Focused",
    description: "Prioritize emergency and healthcare services",
    weights: {
      [norm("Community spaces")]: 1.0,
      [norm("Education institutions")]: 1.5,
      [norm("Emergency services")]: 5.0,
      [norm("Essential services")]: 3.5,
      [norm("Government services")]: 2.0,
      [norm("Healthcare facilities")]: 5.0,
      [norm("Residential")]: 1.0,
      [norm("Retail services")]: 1.0,
      [norm("Tourism")]: 0.5,
      [norm("Transport services")]: 3.0,
    },
  },
};

// AR Impact weight presets for road centrality calculation
export const AR_IMPACT_PRESETS = {
  centrality_focused: {
    name: "Centrality Focused",
    description: "Prioritizes road network importance",
    weights: { betweenness: 0.35, closeness: 0.35, amenity: 0.15, roads: 0.15 },
  },
  balanced: {
    name: "Balanced",
    description: "Equal weighting across all factors",
    weights: { betweenness: 0.25, closeness: 0.25, amenity: 0.25, roads: 0.25 },
  },
  amenity_focused: {
    name: "Amenity Focused",
    description: "Emphasizes facility exposure",
    weights: { betweenness: 0.15, closeness: 0.15, amenity: 0.5, roads: 0.2 },
  },
  roads_focused: {
    name: "Roads Focused",
    description: "Prioritizes affected road count",
    weights: { betweenness: 0.15, closeness: 0.15, amenity: 0.2, roads: 0.5 },
  },
};

// Default weight by category (for fallback)
export const default_weight_by_category = {
  community_spaces: 1,
  education_institutions: 3,
  emergency_services: 5,
  essential_services: 2,
  government_services: 3,
  healthcare_facilities: 4,
  others: 1,
  residential: 3,
  retail_services: 1,
  tourism: 1,
  transport_services: 3,
};

// Metric filter configuration for filtering flood events
export const METRIC_FILTER_CONFIG = [
  {
    key: "inner",
    label: "Amenity Inner Count",
    description: "Total amenities captured within the inner catchment radius.",
    step: 1,
  },
  {
    key: "total",
    label: "Total Amenity Count",
    description: "Combined amenities from both the inner and outer catchments.",
    step: 1,
  },
  {
    key: "centrality",
    label: "Road Centrality Index",
    description: "Blended centrality score based on configurable betweenness and closeness weights.",
    step: 0.01,
  },
  {
    key: "impactInner",
    label: "Impact (Inner)",
    description: "Weighted amenity impact contributed by the inner catchment.",
    step: 1,
  },
  {
    key: "impactOuter",
    label: "Impact (Outer)",
    description: "Weighted amenity impact contributed by the outer catchment.",
    step: 1,
  },
  {
    key: "impactTotal",
    label: "Impact (Total)",
    description: "Total weighted amenity impact used in the index calculation.",
    step: 1,
  },
];


// Ranking metrics for event ranking display
export const RANKING_METRICS = [
  { key: "ar_impact", label: "AR Impact", precision: 3 },
  { key: "impact_total", label: "Impact Total", precision: 2 },
  { key: "ring_total", label: "Total Amenities", precision: 0 },
  { key: "centrality", label: "Centrality", precision: 3 },
];

// Helper function to create initial metric filter state
export const createMetricFilterState = () => ({
  inner: { min: "", max: "" },
  total: { min: "", max: "" },
  centrality: { min: "", max: "" },
  impactInner: { min: "", max: "" },
  impactOuter: { min: "", max: "" },
  impactTotal: { min: "", max: "" },
});
