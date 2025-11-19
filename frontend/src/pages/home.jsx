import { useEffect, useRef } from "react"
import { motion } from "framer-motion"
import { Link } from "react-router-dom"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Droplets, MapPin, Route, Timer, Layers, ArrowRight } from "lucide-react"

/* ============ mapbox backgrounds ============ */

function baseStaticMap(container, center, zoom) {
  mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim()
  if (typeof mapboxgl.setTelemetryEnabled === "function") {
    mapboxgl.setTelemetryEnabled(false)
  }

  return new mapboxgl.Map({
    container,
    style: "mapbox://styles/mapbox/dark-v11",
    center,
    zoom,
    interactive: false,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
  })
}

function HistoricalMapboxBackground({ className = "" }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const map = baseStaticMap(ref.current, [103.8198, 1.3521], 10.4)
    return () => map.remove()
  }, [])

  return <div ref={ref} className={className} />
}

function EventMapboxBackground({ className = "" }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const map = baseStaticMap(ref.current, [103.835, 1.433], 13)
    return () => map.remove()
  }, [])

  return <div ref={ref} className={className} />
}

function RoadMapboxBackground({ className = "" }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const map = baseStaticMap(ref.current, [103.83, 1.34], 11.2)
    return () => map.remove()
  }, [])

  return <div ref={ref} className={className} />
}

function SimulationMapboxBackground({ className = "" }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    const map = baseStaticMap(ref.current, [103.86, 1.3], 12)
    return () => map.remove()
  }, [])

  return <div ref={ref} className={className} />
}

/* ================= main page ================= */

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex max-w-7xl flex-col gap-16 px-4 py-10 lg:py-16">
        <HeroSection />
        <HistoricalSection />
        <EventsSection />
        <CentralitySection />
        <SimulationSection />
        <ClosingSection />
      </main>
    </div>
  )
}

/* ================= hero ================= */

function HeroSection() {
  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <section className="flex flex-col items-center gap-8 text-center">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex max-w-3xl flex-col items-center gap-5"
      >
        <Badge className="border-primary/30 bg-primary/10 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          BA - Waterbender · Singapore Flood Explorer
        </Badge>

        <h1 className="font-[montserrat] text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
          Visualising flood events in Singapore with the roads and amenities that feel them.
        </h1>

        <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
          Waterbender brings historical floods, planning areas, roads, and amenities into one set of
          dashboards. Move from a city-wide view to a single road segment or simulated flood, and see how
          water reshapes everyday movement.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Droplets className="h-3.5 w-3.5" />
            Over 10 years of flood data
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="inline-flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5" />
            More than forty-five thousand road segments
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            Tens of thousands of mapped amenities
          </span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="flex w-full max-w-4xl flex-col gap-4"
      >
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          What you can explore
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <HeroExploreCard
            icon={Layers}
            title="Planning areas"
            description="Where floods cluster across Singapore’s planning areas."
            onClick={() => scrollToSection("historical-section")}
          />
          <HeroExploreCard
            icon={Droplets}
            title="Flood events"
            description="What sits around a single flood and how big its footprint is."
            onClick={() => scrollToSection("events-section")}
          />
          <HeroExploreCard
            icon={Route}
            title="Road network"
            description="Which roads matter most when floods and amenities overlap."
            onClick={() => scrollToSection("centrality-section")}
          />
          <HeroExploreCard
            icon={Timer}
            title="Simulation"
            description="How travel time changes when new floods are dropped on the map."
            onClick={() => scrollToSection("simulation-section")}
          />
        </div>
      </motion.div>
    </section>
  )
}

function HeroExploreCard({ icon: Icon, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-2xl border border-border bg-card/90 px-4 py-4 text-left text-sm shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em]">
          {title}
        </p>
        <p className="text-[12px] text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}

/* ================= visuals ================= */

function HistoricalVisual() {
  return (
    <Card className="border-border bg-card shadow-lg p-0">
      {/* p-0 so no inherited py-6 */}
      <CardContent className="h-64 p-0 md:h-72">
        <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-card">
          <HistoricalMapboxBackground className="h-full w-full" />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/65 via-black/20 to-transparent" />

          <div className="absolute left-4 top-4 rounded-full bg-slate-950/85 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200">
            Planning areas overview
          </div>

          {/* highlight bubble over Yishun-ish */}
          <div className="pointer-events-none absolute left-[63%] top-[19%] flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-sky-400/70 bg-sky-400/10 shadow-[0_0_24px_rgba(56,189,248,0.25)]" />

          {/* popup card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute left-4 bottom-4 w-72 rounded-2xl bg-slate-950/95 p-3 text-[10px] text-slate-50 shadow-xl"
          >
            <p className="text-xs font-semibold">
              Planning Area: <span className="font-bold">Yishun</span>
            </p>

            <div className="mt-2 space-y-0.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Planning area — numbers
              </p>
              <p>
                Area: <span className="font-semibold">21.01 km²</span>
              </p>
              <p>
                Population: <span className="font-semibold">228,210</span>
              </p>
              <p>
                No. of floods: <span className="font-semibold">13</span> · Rank{" "}
                <span className="font-semibold">#9</span> / 55
              </p>
              <p>
                No. of amenities: <span className="font-semibold">911</span> · Rank{" "}
                <span className="font-semibold">#21</span> / 55
              </p>
            </div>

            <div className="mt-2 space-y-0.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Planning area — statistics
              </p>
              <p>
                Flood density: <span className="font-semibold">0.62 / km²</span> · Rank{" "}
                <span className="font-semibold">#22</span>
              </p>
              <p>
                Amenities density: <span className="font-semibold">43.36 / km²</span> · Rank{" "}
                <span className="font-semibold">#35</span>
              </p>
            </div>

            <p className="mt-2 text-[9px] text-slate-300">
              Over 10 years of flood records are mapped and ranked for every planning area.
            </p>
          </motion.div>
        </div>
      </CardContent>
    </Card>
  )
}

function EventVisual() {
  return (
    <Card className="border-border bg-card shadow-lg p-0">
      <CardContent className="h-64 p-0 md:h-72">
        <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-card">
          <EventMapboxBackground className="h-full w-full" />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/70 via-black/30 to-transparent" />

          {/* distance rings */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-full border-2 border-emerald-400/80 bg-emerald-400/10" />
            <div className="absolute h-64 w-64 rounded-full border-2 border-sky-400/70 bg-sky-400/5" />
          </div>

          {/* origin + end */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-950 bg-emerald-400 shadow-lg">
              <Droplets className="h-3.5 w-3.5 text-slate-950" />
            </div>
          </div>
          <div className="pointer-events-none absolute left-[58%] top-[46%]">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-950 bg-rose-400 shadow">
              <span className="text-[10px] font-semibold text-slate-950">End</span>
            </div>
          </div>

          {/* pretend amenities */}
          <div className="pointer-events-none absolute">
            <span className="absolute left-[44%] top-[40%] h-2 w-2 rounded-full bg-amber-300 shadow" />
            <span className="absolute left-[50%] top-[57%] h-2 w-2 rounded-full bg-amber-300 shadow" />
            <span className="absolute left-[54%] top-[52%] h-2 w-2 rounded-full bg-amber-300 shadow" />
            <span className="absolute left-[47%] top-[45%] h-2 w-2 rounded-full bg-amber-300 shadow" />
          </div>

          <div className="absolute left-4 top-4 rounded-full bg-slate-950/85 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200">
            Flood event footprint
          </div>

          <div className="absolute right-4 top-10 w-56 rounded-2xl bg-slate-950/95 p-3 text-[10px] text-slate-50 shadow-xl backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="uppercase tracking-[0.16em] text-slate-400">
                Event summary
              </span>
              <Badge className="bg-slate-800 text-[9px]">Sample view</Badge>
            </div>
            <div className="space-y-1">
              <p>Origin · Near residential and MRT access.</p>
              <p>Inner ring · 0–250 m · denser amenities and local roads.</p>
              <p>Outer ring · 250–500 m · more collector and arterial roads.</p>
              <p>Over 10 years of flood records feed into how these rings are summarised.</p>
            </div>
          </div>

          <div className="absolute bottom-4 left-4 rounded-xl bg-slate-950/90 px-3 py-2 text-[10px] text-slate-200 shadow">
            <div className="mb-1 font-semibold">Legend</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Origin marker and inner ring</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-400" />
                <span>End or predicted end</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-300" />
                <span>Amenities inside the bands</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RoadVisual() {
  return (
    <Card className="border-border bg-card shadow-lg p-0">
      <CardContent className="h-64 p-0 md:h-72">
        <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-card">
          <RoadMapboxBackground className="h-full w-full" />

          {/* dark + blue tint so lines pop */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/70 via-black/40 to-blue-900/40" />

          {/* stylised road overlay */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <svg viewBox="0 0 400 220" className="h-[90%] w-[90%] opacity-90">
              <defs>
                <linearGradient id="roadImportance" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4b5563" />
                  <stop offset="40%" stopColor="#2563eb" />
                  <stop offset="100%" stopColor="#38bdf8" />
                </linearGradient>
              </defs>

              {/* base network */}
              <g stroke="#374151" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.8">
                <path d="M40 150 L360 150" />
                <path d="M60 180 L340 90" />
                <path d="M80 90 L320 180" />
                <path d="M140 60 L160 200" />
                <path d="M220 60 L240 200" />
              </g>

              {/* highlighted important routes */}
              <g stroke="url(#roadImportance)" strokeLinecap="round">
                <path d="M70 150 L260 150" strokeWidth="4.5" />
                <path d="M200 80 L230 190" strokeWidth="4" />
                <path d="M120 160 L310 100" strokeWidth="3.5" />
              </g>

              {/* nodes */}
              <g fill="#e5e7eb">
                <circle cx="70" cy="150" r="2" />
                <circle cx="260" cy="150" r="2" />
                <circle cx="200" cy="80" r="2" />
                <circle cx="230" cy="190" r="2" />
                <circle cx="120" cy="160" r="2" />
                <circle cx="310" cy="100" r="2" />
              </g>
            </svg>
          </div>

          <div className="absolute left-4 top-4 rounded-full bg-slate-950/85 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200">
            Road importance
          </div>

          <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 text-[10px] text-slate-200 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                Importance scale
              </p>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 w-20 rounded-full bg-gradient-to-r from-slate-600 via-blue-600 to-sky-400" />
                <span>Lower to higher</span>
              </div>
            </div>
            <div className="space-y-0.5 text-slate-300">
              <p>Segments scored by combined betweenness and closeness.</p>
              <p>Amenity and flood counts layered for each road segment.</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SimulationVisual() {
  return (
    <Card className="border-border bg-card shadow-lg p-0">
      <CardContent className="h-64 p-0 md:h-72 ">
        <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-card">
          <SimulationMapboxBackground className="h-full w-full" />

          {/* red/purple tint overlay */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/75 via-slate-900/40 to-rose-900/50" />

          {/* simple A→B route overlay */}
          <div className="pointer-events-none absolute inset-0">
            <svg viewBox="0 0 400 220" className="h-full w-full opacity-85">
              {/* dry route */}
              <path
                d="M80 170 C140 150, 220 140, 320 120"
                stroke="#22c55e"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="4 3"
                fill="none"
              />
              {/* flooded route (longer) */}
              <path
                d="M80 170 C120 120, 200 110, 280 130 C320 140, 340 150, 360 160"
                stroke="#fb7185"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>

            {/* origin / destination markers */}
            <div className="absolute left-[18%] top-[72%] -translate-x-1/2 -translate-y-1/2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/80 text-xs font-semibold text-slate-950 shadow-lg">
                A
              </div>
            </div>
            <div className="absolute right-[6%] top-[52%] translate-x-1/2 -translate-y-1/2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/80 text-xs font-semibold text-slate-950 shadow-lg">
                B
              </div>
            </div>
          </div>

          {/* header */}
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-slate-950/85 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200">
            <span>Travel time simulation</span>
            <Timer className="h-3.5 w-3.5 text-rose-300" />
          </div>

          {/* summary card on right */}
          <div className="absolute right-4 top-10 w-60 rounded-2xl bg-slate-950/95 p-3 text-[10px] text-slate-50 shadow-xl backdrop-blur-sm">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              A → B comparison
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg bg-slate-900/80 p-2">
                <p className="font-semibold text-slate-200">Dry conditions</p>
                <p className="mt-1 text-sm font-semibold">18 mins</p>
                <p className="text-slate-300">Usable roads · 32</p>
              </div>
              <div className="rounded-lg bg-rose-950/80 p-2">
                <p className="font-semibold text-rose-200">With simulated flood</p>
                <p className="mt-1 text-sm font-semibold">27 mins</p>
                <p className="text-slate-200">Usable roads · 19 · some blocked</p>
              </div>
            </div>

            {/* tiny bars */}
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-16 text-slate-300">Dry</span>
                <div className="h-2 flex-1 rounded-full bg-slate-800">
                  <div className="h-2 w-2/3 rounded-full bg-emerald-400" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 text-slate-300">With flood</span>
                <div className="h-2 flex-1 rounded-full bg-slate-800">
                  <div className="h-2 w-[90%] rounded-full bg-rose-400" />
                </div>
              </div>
            </div>

            <p className="mt-2 text-[9px] text-slate-300">
              Simulated floods close selected roads and recalculate travel times on the same network.
            </p>
          </div>

          {/* legend bottom-left */}
          <div className="absolute bottom-4 left-4 rounded-xl bg-slate-950/90 px-3 py-2 text-[10px] text-slate-200 shadow">
            <div className="mb-1 font-semibold">Legend</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-4 rounded-full bg-emerald-400" />
                <span>Dry route</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-4 rounded-full bg-rose-400" />
                <span>With simulated flood</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ================= sections ================= */

function HistoricalSection() {
  return (
    <section id="historical-section" className="grid items-center gap-10 lg:grid-cols-2">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <HistoricalVisual />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="space-y-4"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          Historical flood map
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          See how floods are distributed across Singapore’s planning areas.
        </h2>
        <p className="text-sm text-muted-foreground">
          This dashboard is the entry point into the dataset. It shows floods mapped onto Singapore’s planning
          areas using a choropleth and count markers, so clusters stand out at a glance.
        </p>
        <p className="text-sm text-muted-foreground">
          Clicking a planning area opens a popup that summarises size, population, flood count, amenity count
          and density statistics. Each planning area behaves like a profile card that you can compare against
          the rest of the island.
        </p>
        <Button asChild variant="link" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/historicalFloodMap">
            Open Historical Flood Map
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>
    </section>
  )
}

function EventsSection() {
  return (
    <section id="events-section" className="grid items-center gap-10 lg:grid-cols-2">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="order-2 space-y-4 lg:order-1"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          Flood events analysis
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          Zoom into a single flood and see the amenities and roads around it.
        </h2>
        <p className="text-sm text-muted-foreground">
          From the planning area view, you can jump into any event to see its local footprint. Distance bands
          highlight which roads and amenities sit close to the origin and which are further out.
        </p>
        <p className="text-sm text-muted-foreground">
          The side panel behaves like an impact card: AR impact band, amenity counts, road counts and full
          event details such as date, location and main road.
        </p>
        <Button asChild variant="link" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/floodEvents">
            Open Flood Events Dashboard
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="order-1 lg:order-2"
      >
        <EventVisual />
      </motion.div>
    </section>
  )
}

function CentralitySection() {
  return (
    <section id="centrality-section" className="grid items-center gap-10 lg:grid-cols-2">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <RoadVisual />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="space-y-4"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          Road network centrality
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          Read the road network as a ranked list of segments, not just lines on a map.
        </h2>
        <p className="text-sm text-muted-foreground">
          This dashboard shifts the focus from areas and events to the roads that carry people through them.
          Each line segment is coloured by a combined importance metric built from betweenness and closeness
          centrality, with options to layer in flood and amenity information.
        </p>
        <p className="text-sm text-muted-foreground">
          The popup and table give a dossier for every road: planning area, importance score, maintenance
          category, flood count and amenity count.
        </p>
        <Button asChild variant="link" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/roadCentrality">
            Open Road Centrality Dashboard
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>
    </section>
  )
}

function SimulationSection() {
  return (
    <section id="simulation-section" className="grid items-center gap-10 lg:grid-cols-2">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-4"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          Travel time simulation
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          Drop new floods onto the map and see how travel times shift.
        </h2>
        <p className="text-sm text-muted-foreground">
          The simulation dashboard lets you turn hypothetical floods into measurable changes in travel time.
          You choose where a flood occurs and which planning areas and roads to analyse, and the results show
          change bands from low to very high.
        </p>
        <p className="text-sm text-muted-foreground">
          A results table summarises planning areas and roads: average dry time versus flooded time, how many
          roads remain usable, and where routes become blocked or unreachable.
        </p>
        <Button asChild variant="link" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/simulation">
            Open Simulation Dashboard
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
      >
        <SimulationVisual />
      </motion.div>
    </section>
  )
}

/* ================= closing ================= */

function ClosingSection() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl border border-border bg-gradient-to-br from-card/80 to-primary/5 p-6 shadow-lg transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 md:p-8"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <h3 className="font-[montserrat] text-xl font-bold">
            Built as a final-year project to make flood analysis more approachable.
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Waterbender was created by students from Singapore Management University as a way to connect
            flood records with the roads and amenities people use every day.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <Button
            size="sm"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Back to top
          </Button>
          <span className="text-xs text-muted-foreground">
            Data and dashboards for learning, not official advisories.
          </span>
        </div>
      </div>
    </motion.section>
  )
}
