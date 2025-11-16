"use client";
import Centrality from "@/components/pagecomponents/roadcentrality/centrality";
import { LearnHowToUseDialog } from "@/components/pagecomponents/roadcentrality/learnHowToUseDialog";

export default function RoadCentrality() {
  return (
    <div className="space-y-4 p-4 md:p-6 lg:p-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Road Network Centrality</h1>
        <LearnHowToUseDialog />
        <p className="text-sm text-muted-foreground md:text-base">
          Analyse road importance using weighted components. Each section below is its own accordion.
          Use per-category toggles to include/exclude categories while setting weights.
        </p>
      </div>

      <Centrality />
    </div>
  );
}
