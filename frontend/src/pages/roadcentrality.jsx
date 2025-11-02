"use client";
import Centrality from "@/components/pagecomponents/roadcentrality/Centrality";

export default function RoadCentrality() {
  return (
    <div className="space-y-4 p-4 md:p-6 lg:p-8">
      <h1 className="text-2xl font-bold tracking-tight">Road Centrality</h1>
      <p className="text-sm text-muted-foreground">
        Use this space to explore road centrality analytics. Hover the map to inspect segments; use the
        table to sort and filter.
      </p>

      <Centrality />
    </div>
  );
}
