"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Info } from "lucide-react";
import { MOCK_EXAMPLE, to_title_case } from "./shared";

export function LearnHowToUseDialog() {
  const [open, setOpen] = useState(false);

  const computeMockScore = (config) => {
    const { amenityWeights, floodWeights, amenityEnabled, floodEnabled, componentWeights, componentToggles } = config;

    // Amenity calculation
    let amenityWeighted = 0;
    for (const { category, count } of MOCK_EXAMPLE.amenities) {
      const enabled = amenityEnabled[category] ?? true;
      const weight = amenityWeights[category] ?? 1.0;
      if (enabled) amenityWeighted += count * weight;
    }
    const amenityScore = Math.min(100, 20 * Math.log10(1 + amenityWeighted));

    // Flood calculation
    let floodWeighted = 0;
    for (const { type, count } of MOCK_EXAMPLE.floods) {
      const enabled = floodEnabled[type] ?? true;
      const weight = floodWeights[type] ?? 1.0;
      if (enabled) floodWeighted += count * weight;
    }
    const floodScore = Math.min(100, 25 * Math.log10(1 + floodWeighted));

    // Final importance
    const betNorm = (componentToggles.betweenness ?? true) ? MOCK_EXAMPLE.betweenness_norm * 100 : 0;
    const cloNorm = (componentToggles.closeness ?? true) ? MOCK_EXAMPLE.closeness_norm * 100 : 0;
    const amenComp = (componentToggles.amenity ?? true) ? amenityScore : 0;
    const floodComp = (componentToggles.flood ?? true) ? floodScore : 0;

    const importance =
      (componentWeights.betweenness ?? 0.4) * betNorm +
      (componentWeights.closeness ?? 0.3) * cloNorm +
      (componentWeights.amenity ?? 0.2) * amenComp +
      (componentWeights.flood ?? 0.1) * floodComp;

    return {
      betNorm,
      cloNorm,
      amenityScore,
      floodScore,
      amenityWeighted,
      floodWeighted,
      importance,
    };
  };

  const defaultConfig = {
    amenityWeights: { hospital: 1.0, school: 1.0, park: 1.0 },
    floodWeights: { ponding: 1.0, drain_overflow: 1.0 },
    amenityEnabled: { hospital: true, school: true, park: true },
    floodEnabled: { ponding: true, drain_overflow: true },
    componentWeights: { betweenness: 0.4, closeness: 0.3, amenity: 0.2, flood: 0.1 },
    componentToggles: { betweenness: true, closeness: true, amenity: true, flood: true },
  };

  const mockResult = computeMockScore(defaultConfig);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="h-4 w-4" />
          Learn How to Use
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How Road Importance Scoring Works</DialogTitle>
          <DialogDescription>
            Understanding betweenness, closeness, and how toggles and weights affect the final score
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Core Concepts */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Core Concepts</h3>

            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold mb-2">Betweenness Centrality</h4>
                <p className="text-sm text-muted-foreground">
                  Measures how often a road segment lies on the shortest path between other road segments in the network.
                  High betweenness means the road is a critical connector—blocking it would force many trips to take longer routes.
                </p>
                <div className="mt-2 text-xs text-muted-foreground italic">
                  Think of it as: "How much would traffic suffer if this road was closed?"
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold mb-2">Closeness Centrality</h4>
                <p className="text-sm text-muted-foreground">
                  Measures how quickly a road can reach all other roads in the network. Roads with high closeness are
                  centrally located and provide fast access to the entire city.
                </p>
                <div className="mt-2 text-xs text-muted-foreground italic">
                  Think of it as: "How convenient is this road for getting anywhere in the city?"
                </div>
              </div>

              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-4">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Important Note: Precomputed Metrics
                </h4>
                <p className="text-sm text-muted-foreground">
                  Betweenness and closeness are <strong>precomputed</strong> for the entire network. Road filters
                  (planning area, subzone, road type) hide roads from the map and table but do <strong>not</strong> recalculate
                  these centrality metrics. They reflect the full network structure.
                </p>
              </div>
            </div>
          </div>

          {/* How Scoring Works */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">How the Score is Calculated</h3>

            <div className="rounded-lg border bg-card p-4">
              <h4 className="font-semibold mb-3">Using Mock Example: {MOCK_EXAMPLE.name}</h4>

              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-semibold mb-2">Step 1: Calculate Component Scores (0-100 scale)</div>
                  <div className="space-y-2 ml-4">
                    <div className="font-mono text-xs">
                      <div>Betweenness: {MOCK_EXAMPLE.betweenness_norm} × 100 = {mockResult.betNorm.toFixed(2)}</div>
                      <div>Closeness: {MOCK_EXAMPLE.closeness_norm} × 100 = {mockResult.cloNorm.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-semibold mb-2">Step 2a: Calculate Amenity Score</div>
                  <div className="ml-4 space-y-1">
                    <div className="text-xs text-muted-foreground mb-1">Amenities on this road:</div>
                    {MOCK_EXAMPLE.amenities.map(({ category, count }) => (
                      <div key={category} className="font-mono text-xs ml-2">
                        {count} × {to_title_case(category)} (weight: {defaultConfig.amenityWeights[category]}) = {(count * defaultConfig.amenityWeights[category]).toFixed(1)}
                      </div>
                    ))}
                    <div className="font-mono text-xs ml-2 pt-1 border-t">
                      Total weighted = {mockResult.amenityWeighted.toFixed(1)}
                    </div>
                    <div className="font-mono text-xs ml-2">
                      Amenity Score = min(100, 20 × log₁₀(1 + {mockResult.amenityWeighted.toFixed(1)})) = <strong>{mockResult.amenityScore.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-semibold mb-2">Step 2b: Calculate Flood Score</div>
                  <div className="ml-4 space-y-1">
                    <div className="text-xs text-muted-foreground mb-1">Flood events on this road:</div>
                    {MOCK_EXAMPLE.floods.map(({ type, count }) => (
                      <div key={type} className="font-mono text-xs ml-2">
                        {count} × {to_title_case(type)} (weight: {defaultConfig.floodWeights[type]}) = {(count * defaultConfig.floodWeights[type]).toFixed(1)}
                      </div>
                    ))}
                    <div className="font-mono text-xs ml-2 pt-1 border-t">
                      Total weighted = {mockResult.floodWeighted.toFixed(1)}
                    </div>
                    <div className="font-mono text-xs ml-2">
                      Flood Score = min(100, 25 × log₁₀(1 + {mockResult.floodWeighted.toFixed(1)})) = <strong>{mockResult.floodScore.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <div className="font-semibold mb-2">Step 3: Combine with Component Weights</div>
                  <div className="font-mono text-xs ml-4 space-y-1">
                    <div>Importance = </div>
                    <div className="ml-4">
                      {defaultConfig.componentWeights.betweenness.toFixed(2)} × {mockResult.betNorm.toFixed(2)} (Betweenness) +
                    </div>
                    <div className="ml-4">
                      {defaultConfig.componentWeights.closeness.toFixed(2)} × {mockResult.cloNorm.toFixed(2)} (Closeness) +
                    </div>
                    <div className="ml-4">
                      {defaultConfig.componentWeights.amenity.toFixed(2)} × {mockResult.amenityScore.toFixed(2)} (Amenity) +
                    </div>
                    <div className="ml-4">
                      {defaultConfig.componentWeights.flood.toFixed(2)} × {mockResult.floodScore.toFixed(2)} (Flood)
                    </div>
                    <div className="mt-2 pt-2 border-t font-semibold">
                      = <strong className="text-base">{mockResult.importance.toFixed(2)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* How Toggles and Weights Work */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">How Toggles and Weights Work</h3>

            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold mb-2">Component Toggles</h4>
                <p className="text-muted-foreground mb-2">
                  When you toggle a component OFF, it contributes 0 to the final score regardless of its weight.
                </p>
                <div className="font-mono text-xs bg-background rounded p-2">
                  If Amenity is OFF: 0.2 × {mockResult.amenityScore.toFixed(2)} = 0.00
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold mb-2">Component Weights</h4>
                <p className="text-muted-foreground mb-2">
                  Component weights (0.0 to 1.0) determine how much each factor contributes to the final importance score.
                  Higher weight = more influence.
                </p>
                <div className="font-mono text-xs bg-background rounded p-2">
                  If Betweenness weight = 0.8: 0.8 × {mockResult.betNorm.toFixed(2)} = {(0.8 * mockResult.betNorm).toFixed(2)}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold mb-2">Category Toggles & Multipliers</h4>
                <p className="text-muted-foreground mb-2">
                  Within Amenity and Flood components, each category/type has its own toggle and multiplier (1-10).
                  When toggled OFF, that category contributes 0 to the component score.
                </p>
                <div className="font-mono text-xs bg-background rounded p-2">
                  2 hospitals × weight 2.5 × ON = 5.0<br />
                  3 schools × weight 1.0 × OFF = 0.0
                </div>
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 p-4">
            <h4 className="font-semibold mb-2">💡 Tips for Using This Tool</h4>
            <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
              <li>Use presets (Balanced, Amenity + Flood Focused, Centrality Focused) as starting points</li>
              <li>Toggle off components you don't care about to simplify the score</li>
              <li>Adjust category multipliers to prioritize specific amenities (e.g., hospitals) or flood types</li>
              <li>Remember: filters hide roads but don't change betweenness/closeness calculations</li>
              <li>Export results to CSV for further analysis in spreadsheet software</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
