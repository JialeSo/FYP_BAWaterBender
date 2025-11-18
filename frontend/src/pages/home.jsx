import { useState, useEffect, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { ArrowRight, Droplets, LineChart, ShieldCheck, Share2, MapPin, LocateFixed, Search } from "lucide-react"
import { motion } from "framer-motion"

/*
  waterbenders — landing page (marketing-first)
  - dark-mode first
  - top nav: centered location search + "my location"
  - hero: real mapbox dark basemap (singapore)
  - sections: use-cases, features, how-it-works, gallery, credibility, cta, footer
*/

// mapbox hero (non-interactive for performance)
function MapboxHeroMap({ className = "" }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ""
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [103.8198, 1.3521], // singapore
      zoom: 10.6,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      interactive: false,
    })
    return () => map.remove()
  }, [])

  return <div ref={ref} className={className} />
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <HeroSection />
      <UseCases />
      <FeaturesGrid />
      <HowItWorks />
      <Credibility />
      <CtaSection />
      <SiteFooter />
    </div>
  )
}

/* ---------------- top nav ---------------- */
function SiteNav() {
  const [query, setQuery] = useState("")

  function onSubmit(e) {
    e.preventDefault()
    // wire to geocode / map flyTo
  }
  function useMyLocation() {
    // wire to navigator.geolocation & map flyTo
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur nav">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        {/* brand */}
        <div className="flex min-w-[140px] items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary">
            <Droplets className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="brand hidden text-base font-semibold tracking-tight sm:inline">Waterbenders</span>
        </div>

        {/* location search */}
        <form onSubmit={onSubmit} className="flex w-full max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a location, road, or planning area…"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary" className="hidden sm:inline-flex">
            Search
          </Button>
          <Button type="button" onClick={useMyLocation} variant="outline" className="gap-2">
            <LocateFixed className="h-4 w-4" /> My Location
          </Button>
        </form>

        {/* auth / cta */}
        <div className="flex min-w-[140px] items-center justify-end gap-2">
          <Button variant="ghost" className="hidden md:inline-flex">Sign In</Button>
          <Button>
            Launch App <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}

/* ---------------- hero ---------------- */
function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(100%_60%_at_50%_0%,var(--color-primary)/18_0%,transparent_60%)]" />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 md:py-20">
        <div className="flex flex-col justify-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="font-[montserrat] text-4xl font-extrabold leading-tight tracking-tight md:text-5xl"
          >
            Flood Risk Analysis for Singapore
          </motion.h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
            Analyze historical flood patterns, assess infrastructure impact, and prioritize road maintenance using centrality metrics and amenity proximity analysis.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="lg">Open the Risk Map</Button>
            <Button size="lg" variant="outline">What’s in the Data</Button>
          </div>
          <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> Role-Based Access
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Share2 className="h-4 w-4" /> Shareable Views
            <Separator orientation="vertical" className="mx-1 h-4" />
            <LineChart className="h-4 w-4" /> YoY Trend Ranks
          </div>
        </div>

        {/* hero map */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative"
        >
          <Card className="border-border bg-card shadow-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium text-foreground/80">Singapore Risk Map</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-xl)] border border-border">
                <MapboxHeroMap className="h-full w-full" />
                {/* legend chip */}
                <div className="absolute right-3 top-3 rounded-[var(--radius-md)] border border-border bg-background/80 p-2 text-xs backdrop-blur">
                  <div className="mb-1 font-medium">Flood Density</div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-foreground/60" /> Low
                    <span className="h-2 w-2 rounded-full bg-primary/70" /> High
                  </div>
                </div>
                {/* pin label (mock) */}
                <div className="absolute left-1/3 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] border border-border bg-background/90 px-2 py-1 text-[11px] shadow">Orchard Rd</div>
                <MapPin className="absolute left-[31%] top-[54%] h-5 w-5 text-primary" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  )
}

/* ---------------- use cases with visual previews ---------------- */
function UseCases() {
  const cases = [
    {
      title: "Historical Flood Map",
      tagline: "Explore 615 Past Events",
      desc: "Interactive timeline of flood incidents across Singapore. Filter by location, date, and severity to identify recurring hotspots and vulnerable areas.",
      link: "/historicalFloodMap",
      visual: "clusters"
    },
    {
      title: "Flood Events Analysis",
      tagline: "AR Impact & Risk Scoring",
      desc: "Deep-dive into each event with AR Impact scores combining road centrality, amenity proximity, and infrastructure density within customizable rings.",
      link: "/floodevents",
      visual: "rings"
    },
    {
      title: "Road Centrality",
      tagline: "Network Importance Ranking",
      desc: "Prioritize maintenance using betweenness and closeness metrics. Identify critical road segments with weighted scoring for amenities and flood exposure.",
      link: "/roadcentrality",
      visual: "heatmap"
    },
    {
      title: "Scenario Simulation",
      tagline: "What-If Planning",
      desc: "Model flood scenarios with adjustable parameters. Assess potential impact on infrastructure and simulate response strategies before they happen.",
      link: "/simulation",
      visual: "compare"
    },
  ]

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 text-center">
        <h2 className="font-[montserrat] text-3xl font-bold tracking-tight">Four Powerful Tools, One Platform</h2>
        <p className="mt-2 text-muted-foreground">From historical analysis to predictive planning — everything you need to understand flood risk.</p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {cases.map((c) => (
          <Card key={c.title} className="border-border bg-card shadow-sm transition hover:shadow-lg overflow-hidden group">
            {/* Map Visual Preview */}
            <div className="relative h-48 bg-slate-900 overflow-hidden">
              <FeatureMapPreview variant={c.visual} />
              <div className="absolute top-3 left-3 z-10">
                <Badge className="bg-primary/90 backdrop-blur text-primary-foreground">{c.tagline}</Badge>
              </div>
            </div>

            <CardHeader>
              <CardTitle className="text-lg group-hover:text-primary transition-colors">{c.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{c.desc}</p>
              <Button variant="outline" size="sm" className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors" asChild>
                <a href={c.link}>
                  Explore <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

// Feature preview maps (non-interactive SVG illustrations)
function FeatureMapPreview({ variant }) {
  return (
    <svg viewBox="0 0 400 200" className="w-full h-full" role="img">
      <defs>
        <linearGradient id="mapGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "rgb(15, 23, 42)", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "rgb(30, 41, 59)", stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <rect width="400" height="200" fill="url(#mapGradient)" />

      {/* Road network background */}
      <g stroke="rgb(71, 85, 105)" strokeOpacity="0.3" strokeWidth="0.5">
        <path d="M20,50 L380,50" />
        <path d="M20,100 L380,100" />
        <path d="M20,150 L380,150" />
        <path d="M100,20 L100,180" />
        <path d="M200,20 L200,180" />
        <path d="M300,20 L300,180" />
      </g>

      {variant === "clusters" && (
        <g>
          {/* Flood event clusters */}
          <circle cx="280" cy="80" r="28" fill="rgb(239, 68, 68)" fillOpacity="0.15" />
          <circle cx="280" cy="80" r="18" fill="rgb(239, 68, 68)" fillOpacity="0.25" />
          <circle cx="280" cy="80" r="8" fill="rgb(239, 68, 68)" fillOpacity="0.8" />

          <circle cx="150" cy="120" r="22" fill="rgb(59, 130, 246)" fillOpacity="0.15" />
          <circle cx="150" cy="120" r="14" fill="rgb(59, 130, 246)" fillOpacity="0.25" />
          <circle cx="150" cy="120" r="6" fill="rgb(59, 130, 246)" fillOpacity="0.8" />

          <circle cx="320" cy="140" r="16" fill="rgb(251, 146, 60)" fillOpacity="0.15" />
          <circle cx="320" cy="140" r="10" fill="rgb(251, 146, 60)" fillOpacity="0.25" />
          <circle cx="320" cy="140" r="5" fill="rgb(251, 146, 60)" fillOpacity="0.8" />
        </g>
      )}

      {variant === "rings" && (
        <g>
          {/* Distance rings around selected point */}
          <circle cx="200" cy="100" r="70" fill="none" stroke="rgb(96, 165, 250)" strokeWidth="2" strokeOpacity="0.4" strokeDasharray="4 2" />
          <circle cx="200" cy="100" r="45" fill="none" stroke="rgb(59, 130, 246)" strokeWidth="2" strokeOpacity="0.6" strokeDasharray="4 2" />
          <circle cx="200" cy="100" r="8" fill="rgb(239, 68, 68)" />

          {/* Amenity markers */}
          <circle cx="180" cy="70" r="4" fill="rgb(34, 197, 94)" />
          <circle cx="230" cy="85" r="4" fill="rgb(34, 197, 94)" />
          <circle cx="170" cy="120" r="4" fill="rgb(34, 197, 94)" />
          <circle cx="240" cy="130" r="4" fill="rgb(34, 197, 94)" />
          <circle cx="150" cy="100" r="4" fill="rgb(34, 197, 94)" />
        </g>
      )}

      {variant === "heatmap" && (
        <g>
          {/* Road segments with varying importance */}
          <path d="M50,100 L150,100" stroke="rgb(191, 219, 254)" strokeWidth="3" strokeOpacity="0.7" />
          <path d="M150,100 L250,100" stroke="rgb(96, 165, 250)" strokeWidth="5" strokeOpacity="0.8" />
          <path d="M250,100 L350,100" stroke="rgb(29, 78, 216)" strokeWidth="7" strokeOpacity="0.9" />

          <path d="M200,40 L200,80" stroke="rgb(59, 130, 246)" strokeWidth="4" strokeOpacity="0.7" />
          <path d="M200,120 L200,160" stroke="rgb(147, 197, 253)" strokeWidth="3" strokeOpacity="0.6" />
        </g>
      )}

      {variant === "compare" && (
        <g>
          {/* Split view comparison */}
          <line x1="200" y1="0" x2="200" y2="200" stroke="rgb(148, 163, 184)" strokeWidth="2" />

          {/* Before scenario - left */}
          <circle cx="120" cy="100" r="25" fill="rgb(251, 146, 60)" fillOpacity="0.2" />
          <circle cx="120" cy="100" r="6" fill="rgb(251, 146, 60)" />

          {/* After scenario - right */}
          <circle cx="280" cy="100" r="35" fill="rgb(239, 68, 68)" fillOpacity="0.2" />
          <circle cx="280" cy="100" r="8" fill="rgb(239, 68, 68)" />
        </g>
      )}
    </svg>
  )
}

/* ---------------- core capabilities ---------------- */
function FeaturesGrid() {
  const features = [
    { title: "615 Historical Events", desc: "Complete dataset of flood incidents with timestamps, locations, and event metadata for pattern analysis." },
    { title: "45K+ Road Segments", desc: "Full Singapore road network with betweenness and closeness centrality metrics for importance ranking." },
    { title: "37K Amenities Mapped", desc: "Schools, clinics, shelters, and infrastructure categorized with proximity analysis for impact assessment." },
    { title: "AR Impact Scoring", desc: "Composite risk metric combining centrality, amenity density, and flood frequency with configurable weights." },
    { title: "Distance Ring Analysis", desc: "Customizable inner/outer rings (200m/500m default) with band filtering and multiplier weights." },
    { title: "Real-time Calculations", desc: "Instant recalculation of scores when adjusting weights, filters, or analysis parameters." },
  ]

  return (
    <section id="features" className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 text-center">
        <h2 className="font-[montserrat] text-3xl font-bold tracking-tight">Built on Comprehensive Data</h2>
        <p className="mt-2 text-muted-foreground">Extensive datasets combined with flexible analysis tools for actionable insights.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="border-border bg-card shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-lg)] bg-primary/10 text-primary">
                <LineChart className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">{f.title}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">{f.desc}</CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

/* ---------------- how it works ---------------- */
function HowItWorks() {
  const steps = [
    { step: 1, title: "Explore Historical Data", desc: "View 615 flood events on an interactive map, filter by planning area and date range." },
    { step: 2, title: "Configure Analysis", desc: "Adjust amenity category weights, distance rings, and AR impact component weights using preset configurations." },
    { step: 3, title: "Analyze Impact", desc: "Select flood events or roads to view AR Impact scores, affected amenities (inner/outer rings), and nearby infrastructure." },
    { step: 4, title: "Prioritize Maintenance", desc: "Review road importance rankings with centrality metrics and export results for maintenance planning." },
  ]

  return (
    <section id="how" className="bg-muted/30 py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h3 className="text-center font-[montserrat] text-2xl font-bold">How It Works</h3>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <Card key={s.step} className="border-border bg-card shadow-sm">
              <CardHeader>
                <Badge variant="secondary" className="w-fit">Step {s.step}</Badge>
                <CardTitle className="mt-2 text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">{s.desc}</CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------- credibility ---------------- */
function Credibility() {
  return (
    <section className="bg-muted/30 py-12">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h3 className="font-[montserrat] text-2xl font-bold">Technical Capabilities</h3>
            <p className="mt-2 text-muted-foreground">A comprehensive flood risk analysis platform combining spatial analysis, network centrality metrics, and infrastructure impact assessment.</p>
            <ul className="mt-4 list-inside list-disc text-sm text-muted-foreground">
              <li>615 historical flood events with complete metadata</li>
              <li>45,763 road segments with centrality metrics</li>
              <li>37,713 amenities across 10+ categories</li>
              <li>Real-time AR Impact calculations with configurable weights</li>
              <li>Distance ring analysis with inner/outer band filtering</li>
              <li>Automated maintenance priority categorization</li>
            </ul>
          </div>
          <Card className="border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Key Features</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <div className="space-y-2">
                <p><strong className="text-foreground">Historical Flood Map:</strong> Visualize and explore past flood events with interactive filtering.</p>
                <p><strong className="text-foreground">Flood Events Dashboard:</strong> Analyze AR Impact scores with amenity and road proximity analysis.</p>
                <p><strong className="text-foreground">Road Centrality:</strong> Calculate road importance using betweenness/closeness metrics.</p>
                <p><strong className="text-foreground">Scenario Simulation:</strong> Simulate flood scenarios with customizable parameters.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}

/* ---------------- cta ---------------- */
function CtaSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <Card className="border-border bg-card">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center md:flex-row md:justify-between md:text-left">
          <div>
            <h3 className="font-[montserrat] text-2xl font-bold">Start Analyzing Flood Risk</h3>
            <p className="mt-1 max-w-2xl text-muted-foreground">Access 615 historical flood events, analyze 45K+ road segments, and assess infrastructure impact with real-time calculations.</p>
          </div>
          <div className="flex gap-3">
            <Button>Launch Dashboard</Button>
            <Button variant="outline">View Documentation</Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

/* ---------------- footer ---------------- */
function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 md:grid-cols-2">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-primary">
            <Droplets className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold">Waterbenders</span>
        </div>
        <div className="flex items-center justify-start gap-4 md:justify-end">
          <a className="text-sm text-muted-foreground hover:text-foreground" href="#features">Features</a>
          <a className="text-sm text-muted-foreground hover:text-foreground" href="#how">How It Works</a>
          <a className="text-sm text-muted-foreground hover:text-foreground" href="/historicalFloodMap">Historical Map</a>
          <a className="text-sm text-muted-foreground hover:text-foreground" href="/floodevents">Flood Events</a>
          <a className="text-sm text-muted-foreground hover:text-foreground" href="/roadcentrality">Road Centrality</a>
        </div>
      </div>
    </footer>
  )
}
