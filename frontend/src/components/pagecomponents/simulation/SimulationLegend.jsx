// src/components/pagecomponents/simulation/SimulationLegend.jsx
/**
 * Legend Component for Simulation Map
 * Shows appropriate legend based on selected metric and view state
 */

import { fmtTime } from "@/lib/simulation/metrics";

/**
 * Legend for Road Status (when PA is selected)
 */
export function RoadStatusLegend() {
  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3">
      <div className="flex items-center gap-6">
        <div className="text-xs font-semibold mr-2">Road Status:</div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#22c55e' }}></div>
          <span className="text-xs">🟢 Unaffected</span>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#fbbf24' }}></div>
          <span className="text-xs">🟡 Affected</span>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#ef4444' }}></div>
          <span className="text-xs">🔴 Unreachable/Blocked</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Legend for Delta Time metric
 */
export function DeltaTimeLegend() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#86efac" }}></div>
        <span className="text-xs">Low (0-25%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fde047" }}></div>
        <span className="text-xs">Medium (25-50%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fb923c" }}></div>
        <span className="text-xs">High (50-75%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#ef4444" }}></div>
        <span className="text-xs">Very High (75-100%)</span>
      </div>
    </div>
  );
}

/**
 * Legend for Unreachable metric
 */
export function UnreachableLegend() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#86efac" }}></div>
        <span className="text-xs">0 unreachable</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fde047" }}></div>
        <span className="text-xs">1-5 unreachable</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fb923c" }}></div>
        <span className="text-xs">6-15 unreachable</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#ef4444" }}></div>
        <span className="text-xs">&gt;15 unreachable</span>
      </div>
    </div>
  );
}

/**
 * Legend for Baseline/Flooded Time metrics
 */
export function TimeLegend() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#86efac" }}></div>
        <span className="text-xs">Low time (0-25%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#60a5fa" }}></div>
        <span className="text-xs">Medium (25-50%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#3b82f6" }}></div>
        <span className="text-xs">High (50-75%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#1d4ed8" }}></div>
        <span className="text-xs">Very High (75-100%)</span>
      </div>
    </div>
  );
}

/**
 * Legend for Golden Time metric
 */
export function GoldenTimeLegend({ goldenTime }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#22c55e" }}></div>
        <span className="text-xs">Within Target ({fmtTime(goldenTime)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fbbf24" }}></div>
        <span className="text-xs">Slightly Over (0-25%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fb923c" }}></div>
        <span className="text-xs">Moderately Over (25-50%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#ef4444" }}></div>
        <span className="text-xs">Significantly Over (&gt;50%)</span>
      </div>
    </div>
  );
}

/**
 * Main Legend Component
 */
export function SimulationLegend({ selectedMetric, goldenTime, selectedPA }) {
  // Show road status legend when PA is selected
  if (selectedPA) {
    return <RoadStatusLegend />;
  }

  // Show appropriate legend based on metric
  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3">
      <div className="flex items-center gap-6">
        {selectedMetric === "delta_time" && <DeltaTimeLegend />}
        {selectedMetric === "unreachable" && <UnreachableLegend />}
        {(selectedMetric === "baseline_time" || selectedMetric === "flooded_time") && <TimeLegend />}
        {selectedMetric === "golden_time" && <GoldenTimeLegend goldenTime={goldenTime} />}

        {/* Separator and Blocked Roads indicator */}
        <div style={{ width: '1px', height: '24px', backgroundColor: '#d1d5db' }}></div>
        <div className="flex items-center gap-2">
          <div style={{ width: '24px', height: '3px', backgroundColor: '#ef4444', opacity: 0.6 }}></div>
          <span className="text-xs font-medium">Flooded Roads</span>
        </div>
      </div>
    </div>
  );
}

export default SimulationLegend;
