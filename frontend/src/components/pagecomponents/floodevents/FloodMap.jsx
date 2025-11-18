import { MapPin } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";

export default function FloodMap({
  // Selection state
  selected,
  selected_props,
  selected_stats,
  panel_tab,

  // Map refs (passed from parent)
  container_ref,

  // Other
  to_num,
}) {
  return (
    <div className="lg:col-span-2 relative rounded-3xl border border-border bg-card shadow-sm h-[36rem] overflow-hidden">
      {selected && selected_props && (
        <>
          {/* Legend */}
          <div className="flood-legend absolute left-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg">
            <div className="mb-2 font-medium">Legend</div>
            <div className="flex items-center gap-2 mb-1">
              <span className="legend-swatch" style={{background:"#22c55e"}} />
              <span>Origin marker & inner ring/roads</span>
            </div>
            {(() => {
              const end_lng = to_num(selected_props.end_lng);
              const end_lat = to_num(selected_props.end_lat);
              const hasRealEnd = !Number.isNaN(end_lng) && !Number.isNaN(end_lat) &&
                                 Math.abs(end_lng) > 0 && Math.abs(end_lat) > 0;

              if (hasRealEnd) {
                return (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="legend-swatch" style={{background:"#ef4444"}} />
                    <span>End location marker</span>
                  </div>
                );
              } else {
                const has_pred_a = !Number.isNaN(to_num(selected_props.end100_a_lng)) && !Number.isNaN(to_num(selected_props.end100_a_lat));
                const has_pred_b = !Number.isNaN(to_num(selected_props.end100_b_lng)) && !Number.isNaN(to_num(selected_props.end100_b_lat));
                if (has_pred_a || has_pred_b) {
                  return (
                    <div className="flex items-center gap-2 mb-1">
                      <span className="legend-swatch" style={{background:"#f59e0b"}} />
                      <span>Predicted end markers (A/B)</span>
                    </div>
                  );
                }
              }
              return null;
            })()}
            <div className="flex items-center gap-2 mb-1">
              <span className="legend-swatch" style={{background:"#0ea5e9"}} />
              <span>Outer ring & outer roads</span>
            </div>
          </div>

          {/* Count Bubble - positioned to the right */}
          <div className="absolute right-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg bg-background border-2 border-primary">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {panel_tab === "amenities" ? (selected_stats.counts?.total ?? 0) : (selected_stats.roads_counts?.total ?? 0)}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase font-medium mt-1">
                {panel_tab === "amenities" ? "Amenities" : "Roads"}
              </div>
              {/* Breakdown */}
              <div className="flex items-center justify-center gap-2 mt-2 pt-2 border-t border-primary/20">
                <div className="text-center">
                  <div className="text-xs font-bold text-blue-600">
                    {panel_tab === "amenities" ? (selected_stats.counts?.inner ?? 0) : (selected_stats.roads_counts?.inner ?? 0)}
                  </div>
                  <div className="text-[9px] text-muted-foreground">Inner</div>
                </div>
                <div className="text-muted-foreground">·</div>
                <div className="text-center">
                  <div className="text-xs font-bold text-gray-600">
                    {panel_tab === "amenities" ? (selected_stats.counts?.outer ?? 0) : (selected_stats.roads_counts?.outer ?? 0)}
                  </div>
                  <div className="text-[9px] text-muted-foreground">Outer</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Prompt to select a flood when nothing is selected */}
      {!selected && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center p-6 rounded-xl border-2 border-dashed border-border bg-card shadow-lg max-w-md">
            <MapPin className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Flood Event Selected</h3>
            <p className="text-sm text-muted-foreground">
              Select a flood event from the table below to visualize it on the map
            </p>
          </div>
        </div>
      )}

      <div ref={container_ref} className="h-full w-full min-h-[36rem]" />
    </div>
  );
}
