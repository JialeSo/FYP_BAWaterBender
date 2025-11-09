# Simulation Component Refactoring Documentation

## Overview

This document describes the comprehensive refactoring of the Simulation.jsx component, breaking it down into modular, reusable components and utilities.

## Architecture

### New Structure

```
frontend/src/
├── lib/simulation/
│   ├── graphUtils.js          # Graph construction and manipulation
│   ├── dijkstra.js             # Dijkstra algorithm and shortest path calculations
│   ├── metrics.js              # Metrics calculation and formatting utilities
│   └── index.js                # Barrel export
│
├── components/pagecomponents/simulation/
│   ├── SimulationMapContainer.jsx      # Main map component with all interactions
│   ├── RoadTooltip.jsx                 # Enhanced road tooltip with all metrics
│   ├── PlanningAreaTooltip.jsx         # Planning area hover tooltip
│   ├── AmenityTooltip.jsx              # Amenity marker tooltip
│   ├── SimulationLegend.jsx            # Legend component (all metrics)
│   ├── MetricSelector.jsx              # Metric selection UI
│   └── index.js                        # Barrel export
│
└── hooks/
    └── useSimulationComputation.js     # Computation logic hook
```

## New Features Implemented

### A. Modular Components

#### 1. SimulationMapContainer
- **Location**: `frontend/src/components/pagecomponents/simulation/SimulationMapContainer.jsx`
- **Features**:
  - ✅ Choropleth visualization with multiple metrics
  - ✅ Planning area click behavior with zoom and filtering
  - ✅ Road network visualization with dynamic line widths
  - ✅ Amenity marker layer (visible in high-level view, dimmed when PA selected)
  - ✅ Enhanced tooltips for all layers
  - ✅ Click-outside-to-reset functionality
  - ✅ Node-level visualization (affected/unreachable)

#### 2. Tooltip Components
- **RoadTooltip**: Shows road name, RN_ID, status, base/flooded travel times, delta, and nearest amenity changes
- **PlanningAreaTooltip**: Shows comprehensive PA metrics including affected nodes, unreachable nodes, percentage changes
- **AmenityTooltip**: Shows amenity information with category badges

#### 3. Legend and Controls
- **SimulationLegend**: Dynamic legend that changes based on selected metric and view state
- **MetricSelector**: UI for switching between visualization metrics

### B. Enhanced Interactivity

#### 1. Planning Area Click Behavior
```javascript
// When clicking a planning area:
- Filters out all other planning areas and roads not within it
- Focuses the map on that area (zoom + center)
- Hides the global metric/choropleth legend panel
- Shows detailed road network with color-coded status

// Clicking outside the area:
- Resets the map to global view (show all planning areas + flooded roads)
- Re-shows the global metric/choropleth view
```

#### 2. Road Hover Improvements
Each road tooltip shows:
- Road Name
- RN_ID
- Status (Unaffected / Affected / Unreachable / Blocked)
- Base Travel Time (min + seconds)
- Flooded Travel Time (min + seconds)
- Optional: Nearest Amenity (Before vs After Flood) with "Changed" indicator

#### 3. Amenity Marker Layer
- Shows all amenities as markers in high-level view
- Hover shows: name, category, type, planning area/subzone
- Dimmed (opacity 0.5) when zoomed into a planning area
- Fully visible in global view

#### 4. Choropleth Logic Enhancements
**Metrics Available**:
- **Delta Time**: Change in travel time (green → red scale)
- **Unreachable**: Number of unreachable intersections
- **Baseline Time**: Travel time before flood
- **Flooded Time**: Travel time after flood
- **Golden Time**: Comparison against target time

**New Metrics per Planning Area**:
- Min, Max, Avg travel time (baseline and flooded)
- % increase in max travel time
- % increase in average travel time
- % of intersections unreachable
- Count of affected intersections
- Count of unreachable intersections

### C. Node & Road-Level Visualization

#### New Metrics:
- `affected_nodes`: Number of intersections whose travel time increased (>0)
- `unreachable_nodes`: Intersections with no reachable amenity

#### Line Width Adjustment:
Road line thickness adjusts based on travel time delta severity:
- **Unaffected** (delta ≤ 0): 2px (thin)
- **Small delta** (0-60s): 2px
- **Medium delta** (60-180s): 3px
- **Large delta** (180-300s): 4px
- **Very large delta** (>300s): 5px
- **Unreachable/Blocked**: 5px (bold red)

## Utility Functions

### Graph Utilities (`lib/simulation/graphUtils.js`)

```javascript
import { buildGraph, dist2, snapAmenitiesToNodes, MinPQ } from '@/lib/simulation/graphUtils';

// Build graph from road feature collection
const graph = buildGraph(road_fc);
// Returns: { nodes: Map, adj: Map, edges: Array }

// Snap amenities to nearest graph nodes
const amenities = snapAmenitiesToNodes(amenity_fc, nodes, ['moh_hospitals'], excludedSet);

// Calculate squared distance
const distance = dist2([lng1, lat1], [lng2, lat2]);
```

### Dijkstra & Metrics (`lib/simulation/dijkstra.js`)

```javascript
import { multiSourceDijkstra, calculateNodeLevelChanges } from '@/lib/simulation/dijkstra';

// Multi-source shortest path
const { dist, visited } = multiSourceDijkstra(
  { nodes, adj },
  sourceNodeIds,
  onProgress,
  edgeFilter
);

// Calculate node-level changes
const changes = calculateNodeLevelChanges(baselineDist, floodedDist, nodes);
// Returns: { affectedNodesCount, unreachableNodesCount, affectedByPA, unreachableByPA }
```

### Metrics & Formatting (`lib/simulation/metrics.js`)

```javascript
import {
  fmtTime,
  fmtM,
  capitalizeWords,
  getColorForValue,
  getColorForGoldenTime,
  getColorForUnreachable,
  calculatePADeltas,
  downloadCSV
} from '@/lib/simulation/metrics';

// Format time
fmtTime(450); // "7.5m (450s)"
fmtM(450);    // "7.5m"

// Get choropleth color
const color = getColorForValue(delta, maxDelta, false);

// Calculate PA deltas
const paDeltas = calculatePADeltas(
  baselineStats,
  floodedStats,
  affectedByPA,
  unreachableByPA
);
```

## Usage Example

### Using SimulationMapContainer

```jsx
import { SimulationMapContainer } from '@/components/pagecomponents/simulation';
import { SimulationLegend } from '@/components/pagecomponents/simulation';
import { MetricSelector } from '@/components/pagecomponents/simulation';

function SimulationResults() {
  const [selectedMetric, setSelectedMetric] = useState('delta_time');
  const [selectedPA, setSelectedPA] = useState(null);
  const [goldenTime, setGoldenTime] = useState(480); // 8 minutes

  return (
    <Card className="relative h-[600px]">
      <CardContent className="p-0 relative h-full">
        {/* Map Container */}
        <SimulationMapContainer
          planning_fc_raw={planning_fc_raw}
          amenity_fc_enriched={amenity_fc_enriched}
          graph={graph}
          paDeltas={paDeltas}
          baselineNodeDist={baselineNodeDist}
          floodedNodeDist={floodedNodeDist}
          affectedRoads={affectedRoads}
          selectedMetric={selectedMetric}
          goldenTime={goldenTime}
          selectedAmenityType="moh_hospitals"
          excludedAmenities={excludedAmenities}
          onPlanningAreaSelect={setSelectedPA}
          selectedPA={selectedPA}
        />

        {/* Metric Selector */}
        <MetricSelector
          selectedMetric={selectedMetric}
          onMetricChange={setSelectedMetric}
          goldenTime={goldenTime}
        />

        {/* Legend */}
        <SimulationLegend
          selectedMetric={selectedMetric}
          goldenTime={goldenTime}
          selectedPA={selectedPA}
        />
      </CardContent>
    </Card>
  );
}
```

## Integration with Existing Code

To integrate these components into the existing `simulation.jsx`:

1. **Import new utilities** (lines 1-20):
```javascript
import { buildGraph, dist2, snapAmenitiesToNodes } from '@/lib/simulation/graphUtils';
import { multiSourceDijkstra } from '@/lib/simulation/dijkstra';
import { fmtTime, fmtM, downloadCSV } from '@/lib/simulation/metrics';
import { SimulationMapContainer, SimulationLegend, MetricSelector } from '@/components/pagecomponents/simulation';
```

2. **Remove duplicate utility functions**:
   - Remove `buildGraph` function (use imported version)
   - Remove `snapAmenitiesToNodes` function
   - Remove `multiSourceDijkstra` function
   - Remove `MinPQ` class
   - Remove `fmtTime`, `fmtM` functions
   - Remove `getColorForValue` function
   - Keep `computePerPAStats` temporarily for compatibility

3. **Replace map rendering in Step 4**:
   - Replace the entire result map initialization and interaction logic
   - Use `SimulationMapContainer` instead
   - Add `MetricSelector` and `SimulationLegend`

## Benefits

1. **Modularity**: Each component has a single responsibility
2. **Reusability**: Components can be reused in other parts of the application
3. **Maintainability**: Easier to update and debug individual components
4. **Testability**: Each utility and component can be tested independently
5. **Performance**: Optimized with useCallback and useMemo where appropriate
6. **Type Safety**: Clear prop interfaces and better documentation

## Color Schemes

### Delta Time (Travel Time Change)
- **Green** (#86efac): Low increase (0-25%)
- **Yellow** (#fde047): Medium increase (25-50%)
- **Orange** (#fb923c): High increase (50-75%)
- **Red** (#ef4444): Very high increase (75-100%)

### Unreachable Nodes
- **Green** (#86efac): 0 unreachable
- **Yellow** (#fde047): 1-5 unreachable
- **Orange** (#fb923c): 6-15 unreachable
- **Red** (#ef4444): >15 unreachable

### Baseline/Flooded Time
- **Green** (#86efac): Low time (0-25%)
- **Blue-400** (#60a5fa): Medium (25-50%)
- **Blue-500** (#3b82f6): High (50-75%)
- **Blue-700** (#1d4ed8): Very high (75-100%)

### Golden Time Target
- **Green** (#22c55e): Within target
- **Yellow** (#fbbf24): Slightly over (0-25%)
- **Orange** (#fb923c): Moderately over (25-50%)
- **Red** (#ef4444): Significantly over (>50%)

### Road Status
- **Green** (#22c55e): 🟢 Unaffected
- **Yellow** (#fbbf24): 🟡 Affected (travel time increased)
- **Red** (#ef4444): 🔴 Unreachable/Blocked

## Next Steps

1. Test each component individually
2. Integrate components into main Simulation.jsx
3. Remove duplicate code from original file
4. Add unit tests for utilities
5. Add integration tests for components
6. Document API endpoints if backend changes are needed

## Files Changed

### New Files Created:
- `frontend/src/lib/simulation/graphUtils.js`
- `frontend/src/lib/simulation/dijkstra.js`
- `frontend/src/lib/simulation/metrics.js`
- `frontend/src/lib/simulation/index.js`
- `frontend/src/components/pagecomponents/simulation/SimulationMapContainer.jsx`
- `frontend/src/components/pagecomponents/simulation/RoadTooltip.jsx`
- `frontend/src/components/pagecomponents/simulation/PlanningAreaTooltip.jsx`
- `frontend/src/components/pagecomponents/simulation/AmenityTooltip.jsx`
- `frontend/src/components/pagecomponents/simulation/SimulationLegend.jsx`
- `frontend/src/components/pagecomponents/simulation/MetricSelector.jsx`
- `frontend/src/components/pagecomponents/simulation/index.js`
- `frontend/src/hooks/useSimulationComputation.js`

### Files To Be Modified:
- `frontend/src/pages/simulation.jsx` (integration pending)

## Testing Checklist

- [ ] Choropleth displays correctly for all metrics
- [ ] Planning area click zooms and shows roads
- [ ] Click outside resets to global view
- [ ] Road tooltips show all required information
- [ ] Amenity markers display and have correct tooltips
- [ ] Legend updates based on metric and view state
- [ ] Line widths adjust based on severity
- [ ] Golden time metric works correctly
- [ ] Node-level metrics calculate correctly
- [ ] Affected/unreachable counts are accurate
- [ ] CSV export includes all new metrics
- [ ] Performance is acceptable with large datasets

## Migration Guide

For detailed migration instructions, see the integration steps above. The key changes are:

1. Import new utilities instead of using inline functions
2. Replace map rendering logic with `SimulationMapContainer`
3. Use new legend and metric selector components
4. Ensure data structures match expected formats
5. Test thoroughly before removing old code

---

**Last Updated**: 2025-11-09
**Author**: Claude Code Refactoring
**Status**: Components Created, Integration Pending
