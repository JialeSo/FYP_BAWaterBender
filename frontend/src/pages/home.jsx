import { useEffect, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

import { Link } from "react-router-dom"
import { motion } from "framer-motion"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Droplets, MapPin, Route, Timer, Layers, ArrowRight } from "lucide-react"

/* ================= mapbox hero ================= */

function MapboxHeroMap({ className = "" }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ""
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [103.8198, 1.3521],
      zoom: 10.7,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      interactive: false,
    })
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
  return (
    <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      {/* left: text */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-6"
      >
        <Badge className="bg-primary/10 text-primary border-primary/30">
          Waterbender · Singapore Flood Explorer
        </Badge>

        <h1 className="font-[montserrat] text-3xl font-extrabold leading-tight tracking-tight md:text-4xl">
          visualising flood events in singapore with the roads and amenities that feel them.
        </h1>

        <p className="max-w-xl text-sm text-muted-foreground md:text-base">
          waterbender brings historical floods, planning areas, roads, and amenities into one set of dashboards.
          move from a city-wide view to a single road segment or simulated flood, and see how water reshapes
          everyday movement.
        </p>

        <div className="space-y-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            what you can explore
          </p>
          <div className="grid gap-2 text-sm">
            <HeroChip
              icon={Layers}
              label="planning area"
              text="where floods cluster across singapore’s planning areas."
            />
            <HeroChip
              icon={Droplets}
              label="event"
              text="what sits around a single flood and how big its footprint is."
            />
            <HeroChip
              icon={Route}
              label="road network"
              text="which roads matter most when floods and amenities overlap."
            />
            <HeroChip
              icon={Timer}
              label="simulation"
              text="how travel time changes when new floods are dropped on the map."
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button asChild size="lg">
            <Link to="/historicalFloodMap">
              explore floods by planning area
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/simulation">open simulation</Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Droplets className="h-3.5 w-3.5" />
            615 recorded events
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="inline-flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5" />
            more than forty-five thousand road segments
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            tens of thousands of mapped amenities
          </span>
        </div>
      </motion.div>

      {/* right: hero visual */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.05 }}
        className="group"
      >
        <Card className="relative border-border bg-gradient-to-br from-card/90 to-primary/5 shadow-xl transition-all duration-300 hover:shadow-2xl hover:shadow-primary/10">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-sm font-semibold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
                singapore flood overview
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                planning areas · events · amenities · roads
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em] animate-pulse">
              interactive in app
            </Badge>
          </CardHeader>
          <CardContent className="overflow-hidden rounded-2xl border border-border bg-background/40 p-0">
            <div className="relative h-72 md:h-80">
              <MapboxHeroMap className="h-full w-full transition-transform duration-700 group-hover:scale-105" />

              {/* simple overlay label */}
              <div className="absolute left-3 top-3 rounded-xl border border-border bg-background/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-xl">
                <div className="font-semibold">floods and amenities</div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  hover, click and filter across planning areas, events
                  and roads to explore how floods touch daily infrastructure.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </section>
  )
}

function HeroChip({ icon: Icon, label, text }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5">
      <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="space-y-0.5">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/80">
          {label}
        </div>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

/* ================= historical flood map ================= */

function HistoricalSection() {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-2">
      {/* visual – floating singapore with popup */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        whileHover={{ scale: 1.02 }}
        className="group"
      >
        <Card className="border-border bg-gradient-to-br from-card/80 to-blue-500/5 shadow-lg transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10">
          <CardContent className="relative overflow-hidden rounded-2xl border border-border bg-background/40 p-0">
            <div className="relative h-72 md:h-80">
              {/* fake basemap with enhanced gradients */}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#1d4ed8_0,#020617_40%),radial-gradient(circle_at_80%_70%,#22c55e_0,#020617_45%)] opacity-80 transition-opacity duration-500 group-hover:opacity-90" />
              {/* singapore shape-ish blob with glow */}
              <div className="absolute left-1/2 top-1/2 h-60 w-72 -translate-x-1/2 -translate-y-1/2 rounded-[40%] bg-sky-200/20 backdrop-blur-sm shadow-[0_0_40px_rgba(56,189,248,0.15)] transition-shadow duration-500 group-hover:shadow-[0_0_60px_rgba(56,189,248,0.25)]" />

              {/* choropleth cells */}
              <div className="absolute left-1/2 top-1/2 grid h-52 w-64 -translate-x-1/2 -translate-y-1/2 grid-cols-6 grid-rows-4 gap-[2px]">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-[3px] bg-sky-300/30"
                    style={{
                      opacity: 0.3 + ((i * 37) % 60) / 100,
                    }}
                  />
                ))}
              </div>

              {/* count markers */}
              <div className="absolute left-[32%] top-[36%] flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] text-slate-50 shadow">
                35
              </div>
              <div className="absolute left-[56%] top-[46%] flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] text-slate-50 shadow">
                24
              </div>
              <div className="absolute left-[46%] top-[60%] flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] text-slate-50 shadow">
                10
              </div>

              {/* popup card */}
              <div className="absolute left-6 top-6 max-w-xs rounded-xl bg-slate-950/95 p-3 text-[11px] text-slate-50 shadow-xl">
                <div className="mb-1 text-[12px] font-semibold">
                  planning area · central water catchment
                </div>
                <Separator className="my-1 bg-slate-700" />
                <div className="space-y-0.5">
                  <p>area · 37.16 km²</p>
                  <p>population · no residents recorded</p>
                  <p>recorded floods · thirteen</p>
                  <p>mapped amenities · three hundred plus</p>
                </div>
                <Separator className="my-1 bg-slate-700" />
                <div className="space-y-0.5 text-slate-300">
                  <p>flood density and amenity density ranks shown for every planning area.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* copy */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="space-y-4"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          historical flood map
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          see how floods are distributed across singapore’s planning areas.
        </h2>
        <p className="text-sm text-muted-foreground">
          this dashboard is the entry point into the dataset. it shows every recorded flood mapped onto
          singapore’s planning areas using a choropleth and count markers, so clusters stand out at a glance.
        </p>
        <p className="text-sm text-muted-foreground">
          clicking a planning area opens a popup like the one shown, summarising size, population, flood
          count, amenity count and simple density statistics. the idea is to treat each planning area as a
          profile card that you can compare against the rest of the island.
        </p>
        <Button asChild variant="ghost" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/historicalFloodMap">
            open historical flood map
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>
    </section>
  )
}

/* ================= flood events analysis ================= */

function EventsSection() {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-2">
      {/* copy */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="order-2 space-y-4 lg:order-1"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          flood events analysis
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          zoom into a single flood and see the amenities and roads around it.
        </h2>
        <p className="text-sm text-muted-foreground">
          from the planning area view, you can jump into any event to see its local footprint. the map
          centres on the flood’s origin with inner and outer distance rings, highlighting which roads fall
          into each band and where the water is expected to end.
        </p>
        <p className="text-sm text-muted-foreground">
          the side panel popup reads like an impact card: ar impact band, amenity counts, road counts and
          full event details such as date, location and main road. the combination of rings and numbers
          makes it easier to reason about how concentrated or spread out an individual flood really is.
        </p>
        <Button asChild variant="ghost" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/floodEvents">
            open flood events dashboard
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>

      {/* visual */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        whileHover={{ scale: 1.02 }}
        className="order-1 lg:order-2 group"
      >
        <Card className="border-border bg-gradient-to-br from-card/80 to-emerald-500/5 shadow-lg transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/10">
          <CardContent className="relative overflow-hidden rounded-2xl border border-border bg-background/40 p-0">
            <div className="relative h-72 md:h-80">
              {/* light basemap with enhanced gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-emerald-50/30 transition-all duration-500 group-hover:from-slate-100 group-hover:to-emerald-50/50" />
              {/* ring roads */}
              <div className="absolute inset-0">
                <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-400/70 bg-emerald-400/6 shadow-[0_0_30px_rgba(52,211,153,0.1)] transition-shadow duration-500 group-hover:shadow-[0_0_45px_rgba(52,211,153,0.2)]" />
                <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-400/70 bg-sky-400/5 shadow-[0_0_40px_rgba(56,189,248,0.08)] transition-shadow duration-500 group-hover:shadow-[0_0_55px_rgba(56,189,248,0.15)]" />
                {/* simple road lines */}
                <div className="absolute left-[18%] top-[35%] h-[2px] w-[64%] bg-emerald-500/70" />
                <div className="absolute left-[32%] top-[48%] h-[2px] w-[48%] bg-sky-500/60" />
                <div className="absolute left-[28%] top-[56%] h-[2px] w-[52%] bg-emerald-500/70" />
              </div>

              {/* markers */}
              <div className="absolute left-1/2 top-1/2 -translate-x-[30%] -translate-y-[4%]">
                <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-900 bg-emerald-400 shadow" />
              </div>
              <div className="absolute left-1/2 top-1/2 translate-x-[10%] -translate-y-[4%]">
                <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-900 bg-sky-400 shadow" />
              </div>
              <div className="absolute left-1/2 top-1/2 -translate-x-[2%] translate-y-[10%]">
                <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-slate-900 bg-rose-400 shadow" />
              </div>

              {/* legend */}
              <div className="absolute left-4 top-4 rounded-xl bg-slate-900/95 px-3 py-2 text-[10px] text-slate-100 shadow-xl">
                <div className="text-[11px] font-semibold">legend</div>
                <div className="mt-1 space-y-1">
                  <LegendRow color="bg-emerald-400" label="origin marker & inner ring roads" />
                  <LegendRow color="bg-rose-400" label="end or predicted end marker" />
                  <LegendRow color="bg-sky-400" label="outer ring roads" />
                </div>
              </div>

              {/* right metric popup */}
              <div className="absolute right-4 top-10 w-52 rounded-2xl bg-slate-950/95 p-3 text-[11px] text-slate-50 shadow-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    flood event details
                  </span>
                  <Badge className="bg-slate-800 text-[10px]">top impact</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <MiniMetric label="ar impact" value="0.425" band="top band" />
                  <MiniMetric label="amenities" value="73" band="inner three · outer seventy" />
                  <MiniMetric label="roads" value="237" band="inner forty-nine · outer one eighty-eight" />
                </div>
                <Separator className="my-2 bg-slate-700" />
                <div className="space-y-0.5 text-[10px] text-slate-300">
                  <p>location · prince road</p>
                  <p>type · flash flood risk</p>
                  <p>area · nearby residential and arterial roads</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </section>
  )
}

/* ================= road centrality ================= */

function CentralitySection() {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-2">
      {/* visual */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        whileHover={{ scale: 1.02 }}
        className="group"
      >
        <Card className="border-border bg-gradient-to-br from-card/80 to-blue-600/5 shadow-lg transition-all duration-300 hover:shadow-2xl hover:shadow-blue-600/10">
          <CardContent className="relative overflow-hidden rounded-2xl border border-border bg-background/40 p-0">
            <div className="relative h-72 md:h-80">
              {/* pale basemap with gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-blue-50/40 transition-all duration-500 group-hover:from-slate-100 group-hover:to-blue-50/60" />

              {/* road network */}
              <div className="absolute inset-6">
                <svg viewBox="0 0 400 220" className="h-full w-full transition-opacity duration-500 group-hover:opacity-100 opacity-95">
                  <defs>
                    <linearGradient id="roadImportance" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#0f172a" />
                      <stop offset="50%" stopColor="#2563eb" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                    <filter id="roadGlow">
                      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                      <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                  </defs>
                  {/* base roads */}
                  <g stroke="#cbd5f5" strokeWidth="1.2" strokeOpacity="0.7">
                    <path d="M10 60 L390 60" />
                    <path d="M10 110 L390 110" />
                    <path d="M10 160 L390 160" />
                    <path d="M70 20 L70 200" />
                    <path d="M210 20 L210 200" />
                    <path d="M330 20 L330 200" />
                  </g>
                  {/* highlighted routes */}
                  <g stroke="url(#roadImportance)" strokeLinecap="round" filter="url(#roadGlow)">
                    <path d="M30 110 L210 110" strokeWidth="4" className="transition-all" />
                    <path d="M210 110 L370 110" strokeWidth="6" className="transition-all" />
                    <path d="M210 40 L210 110" strokeWidth="3.5" className="transition-all" />
                    <path d="M210 110 L210 190" strokeWidth="2.8" className="transition-all" />
                  </g>
                </svg>
              </div>

              {/* importance legend */}
              <div className="absolute left-4 bottom-4 rounded-xl bg-slate-950/95 px-3 py-2 text-[10px] text-slate-100 shadow-xl">
                <div className="mb-1 text-[11px] font-semibold">importance scale</div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-20 rounded-full bg-gradient-to-r from-slate-700 via-blue-600 to-sky-400" />
                  <span className="text-[10px] text-slate-300">lower to higher</span>
                </div>
              </div>

              {/* control popup */}
              <div className="absolute right-4 top-4 w-52 rounded-xl bg-slate-950/95 p-3 text-[11px] text-slate-100 shadow-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    road details
                  </span>
                  <Badge className="bg-slate-800 text-[10px]">network view</Badge>
                </div>
                <div className="mt-2 space-y-0.5 text-[10px] text-slate-200">
                  <p>segment · pan-island expressway</p>
                  <p>planning area · kallang</p>
                  <p>importance score · very high</p>
                  <p>maintenance band · inspected every year</p>
                  <p>flood count and amenity count joined to centrality metrics.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* copy */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="space-y-4"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          road network centrality
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          read the road network as a ranked list of segments, not just lines on a map.
        </h2>
        <p className="text-sm text-muted-foreground">
          this dashboard shifts the focus from areas and events to the roads that carry people through
          them. each line segment is coloured by a combined importance metric built from betweenness and
          closeness centrality, with options to layer in flood and amenity information.
        </p>
        <p className="text-sm text-muted-foreground">
          the popup and table give a dossier for every road: planning area, importance score, maintenance
          category, flood count and amenity count. that makes it easier to spot critical segments that both
          serve many amenities and see more flood exposure.
        </p>
        <Button asChild variant="ghost" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/roadCentrality">
            open road centrality dashboard
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>
    </section>
  )
}

/* ================= simulation ================= */

function SimulationSection() {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-2">
      {/* copy */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-4"
      >
        <Badge variant="outline" className="text-[10px] uppercase tracking-[0.16em]">
          travel time simulation
        </Badge>
        <h2 className="font-[montserrat] text-2xl font-bold leading-tight">
          drop new floods onto the map and see how travel times shift.
        </h2>
        <p className="text-sm text-muted-foreground">
          the simulation dashboard lets you turn hypothetical floods into measurable changes in travel
          time. you choose where a flood occurs and which planning areas and roads to analyse, and the map
          shows change bands from low to very high.
        </p>
        <p className="text-sm text-muted-foreground">
          below the map, a results table summarises planning areas and roads: average dry time versus
          flooded time, how many roads remain usable, and where routes become blocked or unreachable.
          combined with the earlier views, this ties past data to future scenarios.
        </p>
        <Button asChild variant="ghost" size="sm" className="inline-flex gap-2 px-0 text-primary">
          <Link to="/simulation">
            open simulation dashboard
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </motion.div>

      {/* visual */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        whileHover={{ scale: 1.02 }}
        className="group"
      >
        <Card className="border-border bg-gradient-to-br from-card/80 to-rose-500/5 shadow-lg transition-all duration-300 hover:shadow-2xl hover:shadow-rose-500/10">
          <CardContent className="relative overflow-hidden rounded-2xl border border-border bg-background/40 p-0">
            <div className="relative h-72 md:h-80">
              {/* basemap with gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-rose-50/30 transition-all duration-500 group-hover:from-slate-100 group-hover:to-rose-50/50" />
              {/* planning area outlines */}
              <div className="absolute inset-6">
                <svg viewBox="0 0 400 220" className="h-full w-full">
                  <g fill="none" stroke="#94a3b8" strokeWidth="1">
                    <rect x="20" y="40" width="100" height="60" />
                    <rect x="130" y="40" width="120" height="70" />
                    <rect x="260" y="40" width="110" height="80" />
                    <rect x="70" y="120" width="110" height="70" />
                    <rect x="200" y="130" width="140" height="60" />
                  </g>
                  {/* flooded area highlight with animation */}
                  <rect x="130" y="40" width="120" height="70" fill="#ef4444" fillOpacity="0.35" className="transition-all duration-500 group-hover:fill-opacity-45">
                    <animate attributeName="fill-opacity" values="0.35;0.42;0.35" dur="3s" repeatCount="indefinite" />
                  </rect>
                  {/* moderate area */}
                  <rect x="70" y="120" width="110" height="70" fill="#22c55e" fillOpacity="0.35" className="transition-all duration-500 group-hover:fill-opacity-45" />
                  {/* points as flooded roads */}
                  <g fill="#0f172a">
                    <circle cx="190" cy="120" r="4" />
                    <circle cx="210" cy="120" r="4" />
                    <circle cx="230" cy="120" r="4" />
                    <circle cx="190" cy="140" r="4" />
                    <circle cx="220" cy="140" r="4" />
                  </g>
                </svg>
              </div>

              {/* legend */}
              <div className="absolute right-4 bottom-4 rounded-xl bg-slate-950/95 px-3 py-2 text-[10px] text-slate-100 shadow-xl">
                <div className="mb-1 text-[11px] font-semibold">travel time change</div>
                <div className="space-y-1">
                  <LegendRowBox color="bg-emerald-400" label="low change" />
                  <LegendRowBox color="bg-amber-400" label="medium change" />
                  <LegendRowBox color="bg-rose-500" label="very high change" />
                  <LegendRowBox color="bg-slate-900" label="flooded roads" />
                </div>
              </div>

              {/* popup */}
              <div className="absolute left-4 top-6 w-60 rounded-xl bg-slate-950/95 p-3 text-[11px] text-slate-50 shadow-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    simulation summary
                  </span>
                  <Badge className="bg-slate-800 text-[10px]">planning area view</Badge>
                </div>
                <div className="mt-2 space-y-0.5 text-[10px] text-slate-200">
                  <p>selected area · newton and nearby towns</p>
                  <p>average travel time change · small increases in green, larger in red.</p>
                  <p>table below map breaks this down into dry time, flooded time and road counts.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
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
      className="rounded-2xl border border-border bg-gradient-to-br from-card/80 to-primary/5 p-6 md:p-8 shadow-lg transition-all duration-300 hover:shadow-xl hover:shadow-primary/10"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <h3 className="font-[montserrat] text-xl font-bold">
            built as a final-year project to make flood analysis more approachable.
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            waterbender was created by students from singapore management university as a way to connect
            flood records with the roads and amenities people use every day. the dashboards are meant for
            exploration: planners, analysts and curious users can all poke around, ask questions and form
            their own stories about how floods shape movement across the island.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <Button asChild size="sm">
            <Link to="/home">back to top</Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            data and dashboards for learning, not official advisories.
          </span>
        </div>
      </div>
    </motion.section>
  )
}

/* ================= small helpers ================= */

function LegendRow({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[10px]">{label}</span>
    </div>
  )
}

function LegendRowBox({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-3 rounded-[3px] ${color}`} />
      <span className="text-[10px]">{label}</span>
    </div>
  )
}

function MiniMetric({ label, value, band }) {
  return (
    <div className="rounded-lg bg-slate-900/80 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[9px] text-slate-300">{band}</div>
    </div>
  )
}
