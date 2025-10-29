import SimulationMap from "@/components/pagecomponents/simulation/SimulationMap";

export default function Simulation() {
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-8 py-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Simulation Playground</h1>
        <p className="text-base text-muted-foreground">
          Explore a fresh Mapbox canvas where future flood simulations and scenario overlays will live.
        </p>
      </section>

      <section className="min-h-[28rem] flex-1 overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <SimulationMap />
      </section>
    </div>
  );
}
