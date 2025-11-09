// src/components/pagecomponents/simulation/MetricSelector.jsx
/**
 * Metric Selector Component
 * Allows users to switch between different choropleth visualization metrics
 * and toggle map layers
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function MetricSelector({
  selectedMetric,
  onMetricChange,
  goldenTime,
  showAmenities = true,
  onToggleAmenities,
  showFloodedRoads = true,
  onToggleFloodedRoads,
  selectedPA = null,
}) {
  const metrics = [
    { value: "delta_time", label: "Travel Time Change" },
    { value: "unreachable", label: "Unreachable Nodes" },
    { value: "baseline_time", label: "Dry (No Flood)" },
    { value: "flooded_time", label: "With Flood" },
    { value: "golden_time", label: `Golden Time (${(goldenTime / 60).toFixed(1)}m)` },
  ];

  return (
    <Card className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 max-w-[240px]">
      {/* Visualization Metric */}
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Visualization Metric
      </div>
      <div className="flex flex-col gap-1 mb-3">
        {metrics.map(metric => (
          <Button
            key={metric.value}
            size="sm"
            variant={selectedMetric === metric.value ? "default" : "outline"}
            className="justify-start text-xs h-7 font-normal"
            onClick={() => onMetricChange(metric.value)}
          >
            {metric.label}
          </Button>
        ))}
      </div>

      {/* Only show layer toggles in global view (not in PA view) */}
      {!selectedPA && (
        <>
          <Separator className="my-3" />

          {/* Layer Toggles */}
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Map Layers
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="toggle-amenities"
                checked={showAmenities}
                onCheckedChange={onToggleAmenities}
              />
              <Label
                htmlFor="toggle-amenities"
                className="text-xs cursor-pointer font-normal"
              >
                Show Amenities
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="toggle-flooded-roads"
                checked={showFloodedRoads}
                onCheckedChange={onToggleFloodedRoads}
              />
              <Label
                htmlFor="toggle-flooded-roads"
                className="text-xs cursor-pointer font-normal"
              >
                Show Flooded Roads
              </Label>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

export default MetricSelector;
