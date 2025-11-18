import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { NumberInput } from "@/components/numberInput";
import { AMENITY_WEIGHT_PRESETS, AR_IMPACT_PRESETS, default_weight_by_category } from "./constants";
import { to_title_case, clamp } from "./utils";

export default function FloodConfigurationPanel({
  // Category weights (pending and applied)
  pendingCatWeights,
  setPendingCatWeights,
  pendingCatEnabled,
  setPendingCatEnabled,
  cat_weights,
  cat_enabled,

  // Distance bands (pending and applied)
  r_inner,
  set_r_inner,
  r_outer,
  set_r_outer,
  pendingInnerMult,
  setPendingInnerMult,
  pendingOuterMult,
  setPendingOuterMult,
  pendingInnerEnabled,
  setPendingInnerEnabled,
  pendingOuterEnabled,
  setPendingOuterEnabled,
  inner_mult,
  outer_mult,
  inner_enabled,
  outer_enabled,

  // AR Impact weights (pending and applied)
  pendingWBetweenness,
  setPendingWBetweenness,
  pendingWCloseness,
  setPendingWCloseness,
  pendingWAmenity,
  setPendingWAmenity,
  pendingWRoads,
  setPendingWRoads,
  w_betweenness,
  w_closeness,
  w_amenity,
  w_roads,

  // Functions
  applyConfigChanges,
  resetConfigChanges,
  applyAmenityPreset,
  applyARImpactPreset,
  isAmenityWeightPresetActive,
  isARImpactPresetActive,

  // Data
  categories,
  hasUnappliedConfigChanges,
}) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem
        value="flood-config"
        className={`overflow-hidden rounded-xl border shadow-sm ${
          hasUnappliedConfigChanges
            ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-300 dark:border-orange-700'
            : 'bg-card'
        }`}
      >
        <AccordionTrigger className="px-6 py-4 text-lg font-bold">
          <div className="flex items-center gap-2 w-full">
            <span>Flood Events Configuration</span>
            {hasUnappliedConfigChanges && (
              <span className="px-2 py-1 rounded-md text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/40 border border-orange-300 dark:border-orange-700">
                • Unapplied Changes
              </span>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6 pt-4">
          {/* Nested accordions for each subsection */}
          <Accordion type="multiple" className="space-y-4">

            {/* Amenity Categories & Weights */}
            <AccordionItem value="amenities" className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <AccordionTrigger className="px-6 py-4 text-base font-semibold">
                Amenity Categories & Weights
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
                <Card className="border bg-background/80 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Per-Category Toggles & Weights</CardTitle>
                    <CardDescription>
                      Enable/disable categories and set their weights (1-10). Disabled categories contribute 0 to the impact calculation.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Amenity Weight Presets */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Weight Presets</Label>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {Object.entries(AMENITY_WEIGHT_PRESETS).map(([key, preset]) => {
                          const isActive = isAmenityWeightPresetActive(key);
                          return (
                            <button
                              key={key}
                              onClick={() => applyAmenityPreset(key)}
                              className={`rounded-lg p-3 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                                isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-muted/30'
                              }`}
                            >
                              <div className="font-semibold text-sm mb-1">{preset.name}</div>
                              <div className="text-xs text-muted-foreground">{preset.description}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Category grid */}
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      {(categories.length ? categories.map((c) => c.amenity_category) : Object.keys(default_weight_by_category)).map((name) => {
                        const enabled = pendingCatEnabled[name] ?? true;
                        const weight = pendingCatWeights[name] ?? 1;
                        return (
                          <div key={name} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{to_title_case(name)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Switch
                                  id={`amenity-${name}`}
                                  checked={enabled}
                                  onCheckedChange={(checked) =>
                                    setPendingCatEnabled((prev) => ({ ...prev, [name]: !!checked }))
                                  }
                                />
                                <Label htmlFor={`amenity-${name}`} className="text-xs cursor-pointer">
                                  enable
                                </Label>
                              </div>
                              <NumberInput
                                key={`${name}-${weight}`}
                                value={weight}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    setPendingCatWeights((prev) => ({ ...prev, [name]: numVal }));
                                  }
                                }}
                                min={1}
                                max={10}
                                stepper={1}
                                decimalScale={3}
                                fixedDecimalScale={false}
                                disabled={!enabled}
                                hideSteppers={true}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>

            {/* Distance Rings & Band Weights */}
            <AccordionItem value="rings" className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <AccordionTrigger className="px-6 py-4 text-base font-semibold">
                Distance Rings & Band Weights
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
                <Card className="border bg-background/80 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Band Toggles & Weights</CardTitle>
                    <CardDescription>
                      Enable/disable distance bands and set their weight multipliers (1-10). Disabled bands contribute 0 to the calculation.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Inner Band */}
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">Inner Band</span>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="inner-radius" className="text-xs">Radius (meters)</Label>
                          <NumberInput
                            id="inner-radius"
                            value={r_inner}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                const next = clamp(numVal, 0, 5000);
                                set_r_inner(next);
                                if (next > r_outer) set_r_outer(next);
                              }
                            }}
                            min={0}
                            max={5000}
                            stepper={10}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            hideSteppers={true}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Switch
                              id="inner-band-toggle"
                              checked={pendingInnerEnabled}
                              onCheckedChange={setPendingInnerEnabled}
                            />
                            <Label htmlFor="inner-band-toggle" className="text-xs cursor-pointer">
                              enable
                            </Label>
                          </div>
                          <NumberInput
                            value={pendingInnerMult}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                setPendingInnerMult(numVal);
                              }
                            }}
                            min={1}
                            max={10}
                            stepper={1}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            disabled={!pendingInnerEnabled}
                            hideSteppers={true}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          Inner Band: {r_inner} m — Weight: {pendingInnerEnabled ? pendingInnerMult : 0}
                        </div>
                      </div>

                      {/* Outer Band */}
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">Outer Band</span>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="outer-radius" className="text-xs">Radius (meters)</Label>
                          <NumberInput
                            id="outer-radius"
                            value={r_outer}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                const next = clamp(numVal, 0, 10000);
                                set_r_outer(next);
                                if (next < r_inner) set_r_inner(next);
                              }
                            }}
                            min={0}
                            max={10000}
                            stepper={10}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            hideSteppers={true}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Switch
                              id="outer-band-toggle"
                              checked={pendingOuterEnabled}
                              onCheckedChange={setPendingOuterEnabled}
                            />
                            <Label htmlFor="outer-band-toggle" className="text-xs cursor-pointer">
                              enable
                            </Label>
                          </div>
                          <NumberInput
                            value={pendingOuterMult}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                setPendingOuterMult(numVal);
                              }
                            }}
                            min={1}
                            max={10}
                            stepper={1}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            disabled={!pendingOuterEnabled}
                            hideSteppers={true}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          Outer Band: {r_outer} m — Weight: {pendingOuterEnabled ? pendingOuterMult : 0}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>

            {/* Amenity Road Impact Configuration */}
            <AccordionItem value="ar-impact" className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <AccordionTrigger className="px-6 py-4 text-base font-semibold">
                Amenity Road Impact Weights
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
                <Card className="border bg-background/80 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Amenity Road Weight Presets</CardTitle>
                    <CardDescription>
                      Quick configurations for common scenarios. Fine-tune sliders after applying a preset.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                      {Object.entries(AR_IMPACT_PRESETS).map(([key, preset]) => {
                        const isActive = isARImpactPresetActive(key);
                        return (
                          <button
                            key={key}
                            onClick={() => applyARImpactPreset(key)}
                            className={`rounded-lg p-4 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                              isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-muted/30'
                            }`}
                          >
                            <div className="font-semibold text-sm mb-1">{preset.name}</div>
                            <div className="text-xs text-muted-foreground">{preset.description}</div>
                            <div className="mt-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
                              <div>B:{preset.weights.betweenness} C:{preset.weights.closeness}</div>
                              <div>A:{preset.weights.amenity} R:{preset.weights.roads}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border bg-background/80 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Adjust Component Weights</CardTitle>
                    <CardDescription>
                      Control how betweenness, closeness, and amenity impact combine into the AR Impact score.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm">Betweenness Weight</Label>
                          <NumberInput
                            value={pendingWBetweenness * 100}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                setPendingWBetweenness(clamp(numVal / 100, 0, 1));
                              }
                            }}
                            min={0}
                            max={100}
                            stepper={5}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            hideSteppers={true}
                            className="w-16"
                          />
                        </div>
                        <Slider
                          value={[pendingWBetweenness * 100]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={(value) => setPendingWBetweenness(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                        />
                        <p className="text-xs text-muted-foreground">
                          How often the affected road lies on shortest paths between other roads.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm">Closeness Weight</Label>
                          <NumberInput
                            value={pendingWCloseness * 100}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                setPendingWCloseness(clamp(numVal / 100, 0, 1));
                              }
                            }}
                            min={0}
                            max={100}
                            stepper={5}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            hideSteppers={true}
                            className="w-16"
                          />
                        </div>
                        <Slider
                          value={[pendingWCloseness * 100]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={(value) => setPendingWCloseness(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                        />
                        <p className="text-xs text-muted-foreground">
                          How quickly the affected road can reach all other roads in the network.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm">Amenity Weight</Label>
                          <NumberInput
                            value={pendingWAmenity * 100}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                setPendingWAmenity(clamp(numVal / 100, 0, 1));
                              }
                            }}
                            min={0}
                            max={100}
                            stepper={5}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            hideSteppers={true}
                            className="w-16"
                          />
                        </div>
                        <Slider
                          value={[pendingWAmenity * 100]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={(value) => setPendingWAmenity(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Density and type of amenities affected, weighted by category multipliers and ring weights.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-sm">Roads Weight</Label>
                          <NumberInput
                            value={pendingWRoads * 100}
                            onValueChange={(numVal) => {
                              if (numVal !== undefined) {
                                setPendingWRoads(clamp(numVal / 100, 0, 1));
                              }
                            }}
                            min={0}
                            max={100}
                            stepper={5}
                            decimalScale={0}
                            fixedDecimalScale={false}
                            hideSteppers={true}
                            className="w-16"
                          />
                        </div>
                        <Slider
                          value={[pendingWRoads * 100]}
                          min={0}
                          max={100}
                          step={5}
                          onValueChange={(value) => setPendingWRoads(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Number of roads affected within distance rings, weighted by band multipliers.
                        </p>
                      </div>
                    </div>

                    {/* Dynamic Formula Display - Shows pending values */}
                    <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
                      <div className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
                        Pending Formula
                      </div>
                      <p className="font-mono text-xs mb-2">
                        AR Impact = ({pendingWBetweenness.toFixed(2)} × Betweenness) + ({pendingWCloseness.toFixed(2)} × Closeness) + ({pendingWAmenity.toFixed(2)} × Amenity Score) + ({pendingWRoads.toFixed(2)} × Roads Score)
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        <li>
                          Betweenness and Closeness are normalized centrality values (0-1) for the affected road.
                        </li>
                        <li>
                          Amenity Score = 1 - exp(-impact_amenity / 10), where impact_amenity = {inner_enabled ? inner_mult : 0} × Σ(inner amenities × category weight) + {outer_enabled ? outer_mult : 0} × Σ(outer amenities × category weight).
                        </li>
                        <li>
                          Roads Score = 1 - exp(-impact_roads / 10), where impact_roads = {inner_enabled ? inner_mult : 0} × (inner roads count) + {outer_enabled ? outer_mult : 0} × (outer roads count).
                        </li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Apply Changes and Reset Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={resetConfigChanges}
              disabled={!hasUnappliedConfigChanges}
              className="text-sm"
            >
              Reset
            </Button>
            <Button
              onClick={applyConfigChanges}
              disabled={!hasUnappliedConfigChanges}
              className="text-sm bg-primary hover:bg-primary/90"
            >
              Apply Changes
            </Button>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
