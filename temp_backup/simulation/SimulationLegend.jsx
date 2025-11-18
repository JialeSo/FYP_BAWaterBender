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
    <div className="absolute bottom-4 right-4 z-10 rounded-lg shadow-lg p-3 border" style={{ backgroundColor: '#161b22', borderColor: '#30363d' }}>
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold mb-1 text-foreground">Road Status</div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#22c55e' }}></div>
          <span className="text-xs">Unaffected</span>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#fbbf24' }}></div>
          <span className="text-xs">Affected</span>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#ff6b00' }}></div>
          <span className="text-xs">Blocked (Flooded)</span>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#ef4444' }}></div>
          <span className="text-xs">Unreachable</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Legend for Delta Time metric
 */
export function DeltaTimeLegend({ maxDeltaTime }) {
  if (!maxDeltaTime || !Number.isFinite(maxDeltaTime) || maxDeltaTime <= 0) {
    // Fallback to percentage labels if no data
    return (
      <>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: "#22c55e" }}></div>
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
      </>
    );
  }

  const q1 = maxDeltaTime * 0.25;
  const q2 = maxDeltaTime * 0.5;
  const q3 = maxDeltaTime * 0.75;

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#22c55e" }}></div>
        <span className="text-xs">Low (0-{fmtTime(q1)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fde047" }}></div>
        <span className="text-xs">Medium ({fmtTime(q1)}-{fmtTime(q2)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fb923c" }}></div>
        <span className="text-xs">High ({fmtTime(q2)}-{fmtTime(q3)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#ef4444" }}></div>
        <span className="text-xs">Very High ({fmtTime(q3)}-{fmtTime(maxDeltaTime)})</span>
      </div>
    </>
  );
}

/**
 * Legend for Unreachable metric
 */
export function UnreachableLegend({ maxUnreachable }) {
  if (!maxUnreachable || !Number.isFinite(maxUnreachable) || maxUnreachable <= 0) {
    // Fallback to default ranges if no data
    return (
      <>
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
      </>
    );
  }

  const q1 = Math.ceil(maxUnreachable * 0.25);
  const q2 = Math.ceil(maxUnreachable * 0.5);
  const q3 = Math.ceil(maxUnreachable * 0.75);

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#86efac" }}></div>
        <span className="text-xs">0 unreachable</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fde047" }}></div>
        <span className="text-xs">1-{q1} unreachable</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fb923c" }}></div>
        <span className="text-xs">{q1 + 1}-{q2} unreachable</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#ef4444" }}></div>
        <span className="text-xs">&gt;{q2} unreachable</span>
      </div>
    </>
  );
}

/**
 * Legend for Baseline/Flooded Time metrics
 */
export function TimeLegend({ maxTime }) {
  if (!maxTime || !Number.isFinite(maxTime) || maxTime <= 0) {
    // Fallback to percentage labels if no data
    return (
      <>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: "#22c55e" }}></div>
          <span className="text-xs">Low time (0-25%)</span>
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
      </>
    );
  }

  const q1 = maxTime * 0.25;
  const q2 = maxTime * 0.5;
  const q3 = maxTime * 0.75;

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#22c55e" }}></div>
        <span className="text-xs">Low (0-{fmtTime(q1)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fde047" }}></div>
        <span className="text-xs">Medium ({fmtTime(q1)}-{fmtTime(q2)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fb923c" }}></div>
        <span className="text-xs">High ({fmtTime(q2)}-{fmtTime(q3)})</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#ef4444" }}></div>
        <span className="text-xs">Very High ({fmtTime(q3)}-{fmtTime(maxTime)})</span>
      </div>
    </>
  );
}

/**
 * Legend for Travel Time Target metric
 */
export function TravelTimeLegend({ travelTime }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: "#22c55e" }}></div>
        <span className="text-xs">Within Target ({fmtTime(travelTime)})</span>
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
    </>
  );
}

/**
 * Main Legend Component
 */
export function SimulationLegend({ selectedMetric, travelTime, selectedPA, paDeltas = [] }) {
  // Show road status legend when PA is selected
  if (selectedPA) {
    return <RoadStatusLegend />;
  }

  // Calculate max values from paDeltas
  let maxDeltaTime = 0;
  let maxUnreachable = 0;
  let maxBaselineTime = 0;
  let maxFloodedTime = 0;

  for (const pa of paDeltas) {
    if (Number.isFinite(pa.delta_max_s) && pa.delta_max_s > maxDeltaTime) {
      maxDeltaTime = pa.delta_max_s;
    }
    if (Number.isFinite(pa.flood_unreachable) && pa.flood_unreachable > maxUnreachable) {
      maxUnreachable = pa.flood_unreachable;
    }
    if (Number.isFinite(pa.base_max_s) && pa.base_max_s > maxBaselineTime) {
      maxBaselineTime = pa.base_max_s;
    }
    if (Number.isFinite(pa.flood_max_s) && pa.flood_max_s > maxFloodedTime) {
      maxFloodedTime = pa.flood_max_s;
    }
  }

  // Show appropriate legend based on metric
  return (
    <div className="absolute bottom-4 right-4 z-10 rounded-lg shadow-lg p-3 min-w-[200px] border" style={{ backgroundColor: '#161b22', borderColor: '#30363d' }}>
      <div className="flex flex-col gap-2 text-foreground">
        {selectedMetric === "delta_time" && <DeltaTimeLegend maxDeltaTime={maxDeltaTime} />}
        {selectedMetric === "unreachable" && <UnreachableLegend maxUnreachable={maxUnreachable} />}
        {selectedMetric === "baseline_time" && <TimeLegend maxTime={maxBaselineTime} />}
        {selectedMetric === "flooded_time" && <TimeLegend maxTime={maxFloodedTime} />}
        {selectedMetric === "travel_time" && <TravelTimeLegend travelTime={travelTime} />}

        {/* Separator and Blocked Roads indicator */}
        <div style={{ width: '100%', height: '1px', backgroundColor: '#d1d5db', margin: '4px 0' }}></div>
        <div className="flex items-center gap-2">
          <div style={{ width: '20px', height: '3px', backgroundColor: '#ef4444', opacity: 0.6 }}></div>
          <span className="text-xs font-medium">Flooded Roads</span>
        </div>
      </div>
    </div>
  );
}

export default SimulationLegend;
