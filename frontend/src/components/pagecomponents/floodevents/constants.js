// Amenity weight presets for category-based impact calculation
export const AMENITY_WEIGHT_PRESETS = {
  default: {
    name: "Default",
    description: "Custom weighted priorities",
    weights: {
      community_spaces: 1,
      education_institutions: 3.464,
      emergency_services: 5,
      essential_services: 2,
      government_services: 3.162,
      healthcare_facilities: 4,
      others: 1,
      residential: 3.162,
      retail_services: 1,
      tourism: 1,
      transport_services: 3.742,
    },
  },
  balanced: {
    name: "Balanced",
    description: "All categories weighted equally",
    weights: {
      community_spaces: 1,
      education_institutions: 1,
      emergency_services: 1,
      essential_services: 1,
      government_services: 1,
      healthcare_facilities: 1,
      others: 1,
      residential: 1,
      retail_services: 1,
      tourism: 1,
      transport_services: 1,
    },
  },
  emergency: {
    name: "Emergency Focused",
    description: "Prioritize emergency and healthcare services",
    weights: {
      community_spaces: 1,
      education_institutions: 2,
      emergency_services: 10,
      essential_services: 4,
      government_services: 2,
      healthcare_facilities: 8,
      others: 1,
      residential: 1,
      retail_services: 1,
      tourism: 1,
      transport_services: 4,
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
  education_institutions: 3.464,
  emergency_services: 5,
  essential_services: 2,
  government_services: 3.162,
  healthcare_facilities: 4,
  others: 1,
  residential: 3.162,
  retail_services: 1,
  tourism: 1,
  transport_services: 3.742,
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

// Metric summary rows for Learn dialog
export const METRIC_SUMMARY_ROWS = [
  {
    metric: "Roads Affected",
    meaning: "Total number of roads within the inner and outer distance rings from each flood location.",
    insight: "Higher values indicate more road infrastructure at risk. Roads in inner ring are weighted more heavily. Contributes to AR Impact via roads score.",
  },
  {
    metric: "Amenities Affected",
    meaning: "Total number of amenities (hospitals, schools, etc.) within the inner and outer distance rings from each flood location.",
    insight: "Higher values indicate more critical facilities at risk. Each amenity category has a different weight (e.g., emergency services weighted highest).",
  },
  {
    metric: "Betweenness Norm",
    meaning: "Normalized betweenness centrality of the affected road (0-1 scale). Measures how often the road lies on shortest paths between other roads.",
    insight: "Higher values indicate roads critical for network connectivity. Roads with high betweenness are key transit routes whose flooding disrupts many journeys.",
  },
  {
    metric: "Closeness Norm",
    meaning: "Normalized closeness centrality of the affected road (0-1 scale). Measures how central the road is to the entire network.",
    insight: "Higher values indicate roads with good access to all other roads. Flooding these roads affects reachability across the entire network.",
  },
  {
    metric: "AR Impact",
    meaning: "Amenity-Road Impact score combining 4 weighted components: betweenness, closeness, amenity exposure, and roads affected.",
    insight: "Final risk score (formula: AR = w_b × betweenness + w_c × closeness + w_a × amenity_score + w_r × roads_score). Use presets or adjust weights to prioritize different factors.",
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
