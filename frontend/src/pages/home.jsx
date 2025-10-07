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
      <MiniGallery />
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
            Visualising Flood Risk in Singapore
          </motion.h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
            One dark map to explore historical flood events, risk hotspots, and nearby amenities. Search a place, fly the map, and share the view.
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

/* ---------------- use cases ---------------- */
function UseCases() {
  const cases = [
    { title: "Urban Planning", desc: "Compare planning areas and subzones over years to guide zoning and drainage upgrades." },
    { title: "Emergency Response", desc: "Locate clinics, shelters, and access roads near hotspots for faster coordination." },
    { title: "Infrastructure Maintenance", desc: "Prioritise assets by recurrence and proximity to critical amenities." },
  ]

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 text-center">
        <h2 className="font-[montserrat] text-3xl font-bold tracking-tight">What Do You Need It For?</h2>
        <p className="mt-2 text-muted-foreground">Pick a path — we’ll shape the map to your goal.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((c) => (
          <Card key={c.title} className="border-border bg-card shadow-sm transition hover:shadow-md">
            <CardHeader>
              <CardTitle className="capitalize">{c.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{c.desc}</CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

/* ---------------- features (updated) ---------------- */
function FeaturesGrid() {
  const features = [
    { title: "Singapore-First Coverage", desc: "Planning areas, subzones, road segments, and amenity overlays — tuned for SG data." },
    { title: "Historical Flood Layers", desc: "Stack years and filter by event type; spot clusters and recurring hotspots." },
    { title: "Trend & Rank Views", desc: "Rank areas by cases or density across years with clean charts for slides." },
    { title: "Amenity Proximity", desc: "See clinics, schools, and shelters near flooded roads for response planning." },
    { title: "Commercial Insights", desc: "Overlay mall clusters and commercial POIs to assess impact on retail & footfall." },
    { title: "Property Prices", desc: "Contextualise hotspots with nearby HDB/condo price bands to study exposure." },
  ]

  return (
    <section id="features" className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 text-center">
        <h2 className="font-[montserrat] text-3xl font-bold tracking-tight">Why Teams Use Waterbenders</h2>
        <p className="mt-2 text-muted-foreground">Built for planners, responders, and analysts who need clarity in minutes.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="border-border bg-card shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-lg)] bg-muted">
                <span className="text-xs text-foreground/70">★</span>
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
    { step: 1, title: "Search & Locate", desc: "Type a place (e.g., “Tampines”), or use your location to fly the map." },
    { step: 2, title: "Filter & Explore", desc: "Pick years, planning areas, and event types; hover for rich context." },
    { step: 3, title: "Prioritise", desc: "Rank hotspots and surface amenities near high-risk roads." },
    { step: 4, title: "Share", desc: "Export images or share a link — brief stakeholders in one click." },
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

/* ---------------- gallery (svg mocks) ---------------- */
function MiniGallery() {
  return (
    <section id="gallery" className="mx-auto max-w-7xl px-4 py-12">
      <h3 className="text-center font-[montserrat] text-2xl font-bold">Screens at a Glance</h3>
      <p className="mt-2 text-center text-muted-foreground">Replace these with your real screenshots later.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="overflow-hidden border-border bg-card"><GalleryMapMock variant="layers" /></Card>
        <Card className="overflow-hidden border-border bg-card"><GalleryMapMock /></Card>
        <Card className="overflow-hidden border-border bg-card"><GalleryMapMock variant="compare" /></Card>
      </div>
    </section>
  )
}

// lightweight inline “mapbox-like” svg for gallery tiles
function GalleryMapMock({ variant = "default" }) {
  return (
    <svg viewBox="0 0 800 300" className="h-48 w-full" role="img" aria-label="map mock">
      <rect width="800" height="300" fill="var(--card)" />
      <g stroke="var(--foreground)" strokeOpacity="0.2">
        <path d="M20,40 L780,260" />
        <path d="M60,280 L420,40" />
        <path d="M740,60 L120,260" />
      </g>
      <g>
        <circle cx="520" cy="120" r="30" fill="var(--primary)" fillOpacity="0.12" />
        <circle cx="280" cy="180" r="28" fill="var(--foreground)" fillOpacity="0.10" />
        <circle cx="380" cy="140" r="22" fill="var(--primary)" fillOpacity="0.12" />
      </g>
      {variant === "layers" && (
        <g>
          <rect x="18" y="18" width="150" height="80" rx="8" fill="var(--background)" opacity="0.85" />
          <text x="30" y="42" fontSize="12" fill="var(--foreground)" opacity="0.9">Layers</text>
        </g>
      )}
      {variant === "compare" && <rect x="260" y="0" width="4" height="300" fill="var(--border)" />}
    </svg>
  )
}

/* ---------------- credibility ---------------- */
function Credibility() {
  return (
    <section className="bg-muted/30 py-12">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h3 className="font-[montserrat] text-2xl font-bold">What We’re Building</h3>
            <p className="mt-2 text-muted-foreground">A simple, fast, SG-tuned web app to explore flood risk with nearby amenities. It’s opinionated about clarity, speed, and shareability.</p>
            <ul className="mt-4 list-inside list-disc text-sm text-muted-foreground">
              <li>Shadcn UI + theme tokens for consistent dark UI</li>
              <li>Map overlays for floods, roads, and amenities</li>
              <li>Ranked views for year-on-year trends</li>
            </ul>
          </div>
          <Card className="border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Who Benefits</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <div className="space-y-2">
                <p><strong className="text-foreground">Planners:</strong> Identify hotspots and infrastructure at risk.</p>
                <p><strong className="text-foreground">Responders:</strong> Check nearby clinics/shelters and route context.</p>
                <p><strong className="text-foreground">Analysts:</strong> Compare year-on-year trends with ranked views.</p>
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
            <h3 className="font-[montserrat] text-2xl font-bold">Get Started in Minutes</h3>
            <p className="mt-1 max-w-2xl text-muted-foreground">Use sample data or bring your own CSVs. No setup drama — just insights.</p>
          </div>
          <div className="flex gap-3">
            <Button>Launch App</Button>
            <Button variant="outline">Book a Walkthrough</Button>
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
          <a className="text-sm text-muted-foreground hover:text-foreground" href="#gallery">Screens</a>
        </div>
      </div>
    </footer>
  )
}
