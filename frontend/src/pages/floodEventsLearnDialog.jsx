"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Info } from "lucide-react";

const MOCK_EXAMPLE = {
  name: "Example Flood Event #42",
  betweenness_norm: 0.75,
  closeness_norm: 0.65,
  amenity_count_inner: 12,
  amenity_count_outer: 8,
};

export function FloodEventsLearnDialog() {
  const [open, setOpen] = useState(false);

  // Mock calculation for example
  const betweennessScore = MOCK_EXAMPLE.betweenness_norm;
  const closenessScore = MOCK_EXAMPLE.closeness_norm;

  // Amenity impact calculation (simplified)
  const innerWeight = 1.0;
  const outerWeight = 0.5;
  const avgCategoryWeight = 2.5;
  const impactInner = MOCK_EXAMPLE.amenity_count_inner * avgCategoryWeight * innerWeight;
  const impactOuter = MOCK_EXAMPLE.amenity_count_outer * avgCategoryWeight * outerWeight;
  const totalImpact = impactInner + impactOuter;
  const amenityScore = 1 - Math.exp(-totalImpact / 10.0);

  // AR Impact with default weights
  const w_betweenness = 0.4;
  const w_closeness = 0.4;
  const w_amenity = 0.2;
  const arImpact = (w_betweenness * betweennessScore) + (w_closeness * closenessScore) + (w_amenity * amenityScore);

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
          <DialogTitle>How AR Impact Scoring Works</DialogTitle>
          <DialogDescription>
            Understanding betweenness, closeness, amenity impact, and how they combine into the AR Impact index
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

              <div className="rounded-lg border bg-muted/30 p-4">
                <h4 className="font-semibold mb-2">Amenity Impact</h4>
                <p className="text-sm text-muted-foreground">
                  Derived from the count of nearby amenities multiplied by their category weights. Amenities within the inner
                  catchment ring receive full weight, while outer amenities receive partial weight. Categories like healthcare
                  and emergency services typically have higher weights.
                </p>
                <div className="mt-2 text-xs text-muted-foreground italic">
                  Think of it as: "How many important facilities would be affected by a flood here?"
                </div>
              </div>

              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-4">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  AR Impact Index
                </h4>
                <p className="text-sm text-muted-foreground">
                  The <strong>Amenities & Road Impact (AR Impact)</strong> index blends road network importance (betweenness and closeness centrality)
                  with amenity exposure (impact count × weight). This creates a comprehensive score that reflects both the structural
                  importance of the affected road and the number of critical facilities exposed to flooding.
                </p>
              </div>
            </div>
          </div>

          {/* Formula Explanation */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">The AR Impact Formula</h3>

            <div className="rounded-lg border bg-card p-4">
              <div className="font-mono text-sm mb-4 p-3 bg-muted rounded">
                AR Impact = (w₁ × Betweenness) + (w₂ × Closeness) + (w₃ × Amenity Impact)
              </div>

              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">Where:</p>
                <ul className="space-y-2 ml-4 text-muted-foreground">
                  <li><strong>w₁, w₂, w₃</strong> = Configurable weights (default: 0.4, 0.4, 0.2)</li>
                  <li><strong>Betweenness</strong> = Normalized betweenness centrality (0-1)</li>
                  <li><strong>Closeness</strong> = Normalized closeness centrality (0-1)</li>
                  <li><strong>Amenity Impact</strong> = 1 - e^(-total_weighted_amenities / 10)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Example Calculation */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Example Calculation</h3>

            <div className="rounded-lg border bg-card p-4">
              <h4 className="font-semibold mb-3">Using {MOCK_EXAMPLE.name}</h4>

              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-semibold mb-2">Step 1: Road Centrality Values</div>
                  <div className="space-y-1 ml-4 font-mono text-xs">
                    <div>Betweenness = {betweennessScore.toFixed(3)}</div>
                    <div>Closeness = {closenessScore.toFixed(3)}</div>
                  </div>
                </div>

                <div>
                  <div className="font-semibold mb-2">Step 2: Calculate Amenity Impact</div>
                  <div className="ml-4 space-y-1 font-mono text-xs">
                    <div className="text-muted-foreground">Inner ring ({MOCK_EXAMPLE.amenity_count_inner} amenities):</div>
                    <div className="ml-2">{MOCK_EXAMPLE.amenity_count_inner} × {avgCategoryWeight} (avg weight) × {innerWeight} = {impactInner.toFixed(1)}</div>
                    <div className="text-muted-foreground mt-1">Outer ring ({MOCK_EXAMPLE.amenity_count_outer} amenities):</div>
                    <div className="ml-2">{MOCK_EXAMPLE.amenity_count_outer} × {avgCategoryWeight} (avg weight) × {outerWeight} = {impactOuter.toFixed(1)}</div>
                    <div className="pt-2 border-t mt-2">Total Impact = {totalImpact.toFixed(1)}</div>
                    <div>Amenity Score = 1 - e^(-{totalImpact.toFixed(1)} / 10) = <strong>{amenityScore.toFixed(3)}</strong></div>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <div className="font-semibold mb-2">Step 3: Calculate AR Impact</div>
                  <div className="font-mono text-xs ml-4 space-y-1">
                    <div>AR Impact = </div>
                    <div className="ml-4">
                      ({w_betweenness} × {betweennessScore.toFixed(3)}) +
                    </div>
                    <div className="ml-4">
                      ({w_closeness} × {closenessScore.toFixed(3)}) +
                    </div>
                    <div className="ml-4">
                      ({w_amenity} × {amenityScore.toFixed(3)})
                    </div>
                    <div className="ml-4 mt-1">
                      = {(w_betweenness * betweennessScore).toFixed(3)} + {(w_closeness * closenessScore).toFixed(3)} + {(w_amenity * amenityScore).toFixed(3)}
                    </div>
                    <div className="mt-2 pt-2 border-t font-semibold">
                      = <strong className="text-base">{arImpact.toFixed(3)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Weight Presets */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Weight Presets</h3>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="font-semibold text-sm mb-2">Centrality Focused</div>
                <div className="text-xs space-y-1 font-mono">
                  <div>Betweenness: 0.4</div>
                  <div>Closeness: 0.4</div>
                  <div>Amenity: 0.2</div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Prioritizes road network importance</p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="font-semibold text-sm mb-2">Balanced</div>
                <div className="text-xs space-y-1 font-mono">
                  <div>Betweenness: 0.5</div>
                  <div>Closeness: 0.5</div>
                  <div>Amenity: 0.0</div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Pure centrality analysis</p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="font-semibold text-sm mb-2">Amenity Focused</div>
                <div className="text-xs space-y-1 font-mono">
                  <div>Betweenness: 0.1</div>
                  <div>Closeness: 0.1</div>
                  <div>Amenity: 0.8</div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Emphasizes facility exposure</p>
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 p-4">
            <h4 className="font-semibold mb-2">💡 Tips for Using This Tool</h4>
            <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
              <li>Adjust catchment radii (inner/outer) to change the area of amenity impact</li>
              <li>Use presets as starting points and fine-tune weights based on your analysis goals</li>
              <li>Toggle amenity categories on/off to focus on specific facility types (e.g., only healthcare)</li>
              <li>Higher category weights mean those amenities contribute more to the impact score</li>
              <li>The AR Impact index helps prioritize flood events by combining road importance with facility exposure</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
