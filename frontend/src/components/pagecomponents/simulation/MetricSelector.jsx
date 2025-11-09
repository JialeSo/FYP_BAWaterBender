// src/components/pagecomponents/simulation/MetricSelector.jsx
/**
 * Metric Selector Component
 * Allows users to switch between different choropleth visualization metrics
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function MetricSelector({ selectedMetric, onMetricChange, goldenTime }) {
  const metrics = [
    { value: "delta_time", label: "Travel Time Change" },
    { value: "unreachable", label: "Unreachable Nodes" },
    { value: "baseline_time", label: "Before Flood" },
    { value: "flooded_time", label: "After Flood" },
    { value: "golden_time", label: `Golden Time Target (${(goldenTime / 60).toFixed(1)}m)` },
  ];

  return (
    <Card className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3">
      <div className="text-xs font-semibold mb-2 text-gray-700 dark:text-gray-300">
        Visualization Metric
      </div>
      <div className="flex flex-col gap-1">
        {metrics.map(metric => (
          <Button
            key={metric.value}
            size="sm"
            variant={selectedMetric === metric.value ? "default" : "ghost"}
            className="justify-start text-xs h-8"
            onClick={() => onMetricChange(metric.value)}
          >
            {metric.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

export default MetricSelector;
