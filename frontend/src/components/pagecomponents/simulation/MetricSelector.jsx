// src/components/pagecomponents/simulation/MetricSelector.jsx
/**
 * Metric Selector Component
 * Allows users to switch between different choropleth visualization metrics
 * and toggle map layers
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function MetricSelector({
  selectedMetric,
  onMetricChange,
  travelTime,
  showAmenities = true,
  onToggleAmenities,
  selectedPA = null,
}) {
  const metrics = [
    { value: "delta_time", label: "Travel Time Change" },
    { value: "unreachable", label: "Unreachable Nodes" },
    { value: "baseline_time", label: "Dry Scenario" },
    { value: "flooded_time", label: "Flood Scenario" },
    { value: "travel_time", label: `Travel Time Target (${(travelTime / 60).toFixed(1)}m)` },
  ];

  const selectedMetricLabel = metrics.find(m => m.value === selectedMetric)?.label || "Select Metric";

  return (
    <Card className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 max-w-[240px]">
      {/* Visualization Metric Dropdown */}
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        Visualization Metric
      </div>
      <Select value={selectedMetric} onValueChange={onMetricChange}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder="Select metric">{selectedMetricLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {metrics.map(metric => (
            <SelectItem key={metric.value} value={metric.value} className="text-xs">
              {metric.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Only show layer toggles in global view (not in PA view) */}
      {!selectedPA && (
        <>
          <Separator className="my-2" />

          {/* Layer Toggles */}
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Map Layers
          </div>
          <div className="space-y-1.5">
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
          </div>
        </>
      )}
    </Card>
  );
}

export default MetricSelector;
