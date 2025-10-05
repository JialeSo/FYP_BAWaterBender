import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { ArrowRight, Droplets, Map, Layers, LineChart, ShieldCheck, Building2, Zap, Navigation, Share2, MapPin, LocateFixed, Search } from "lucide-react"
import { motion } from "framer-motion"

/*
  landing page (marketing-first) for waterbenders — visualising flood risk in singapore
  - dark-mode first: relies on your CSS vars (bg-background, text-foreground, primary, muted, etc.)
  - top nav: centered location search + "use my location" CTA
  - hero: bold statement + dark sg map mock + quick actions
  - sections: use-cases, features, how-it-works, gallery, credibility, cta, footer
*/

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

function SiteNav() {
  const [query, setQuery] = useState("")

  function onSubmit(e) {
    e.preventDefault()
    // TODO: wire this to your geocode / map flyTo logic
    // e.g., props.onSearch?.(query)
  }

  function useMyLocation() {
    // TODO: wire to navigator.geolocation & map flyTo
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        {/* left: brand */}
        <div className="flex min-w-[140px] items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary">
            <Droplets className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="hidden text-base font-semibold tracking-tight sm:inline">waterbenders</span>
        </div>

        {/* center: location search */}
        <form onSubmit={onSubmit} className="flex w-full max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search a location, road, or planning area…"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary" className="hidden sm:inline-flex">
            search
          </Button>
          <Button type="button" onClick={useMyLocation} variant="outline" className="gap-2">
            <LocateFixed className="h-4 w-4" /> my location
          </Button>
        </form>

        {/* right: auth / cta */}
        <div className="flex min-w-[140px] items-center justify-end gap-2">
          <Button variant="ghost" className="hidden md:inline-flex">sign in</Button>
          <Button>
            launch app <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* subtle theme-aware glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(100%_60%_at_50%_0%,var(--color-primary)/18_0%,transparent_60%)]" />

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 md:py-20">
        <div className="flex flex-col justify-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="font-[montserrat] text-4xl font-extrabold leading-tight tracking-tight md:text-5xl"
          >
            visualising flood risk in singapore
          </motion.h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
            one dark map to explore historical flood events, risk hotspots, and nearby amenities. search a place, fly the map, and share the view.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="lg">open the risk map</Button>
            <Button size="lg" variant="outline">what’s in the data</Button>
          </div>
          <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> role-based access
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Share2 className="h-4 w-4" /> shareable views
            <Separator orientation="vertical" className="mx-1 h-4" />
            <LineChart className="h-4 w-4" /> yoy trend ranks
          </div>
        </div>

        {/* visual map mock */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative"
        >
          <Card className="border-border bg-card shadow-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium text-foreground/80">singapore risk map (mock)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-xl)] border border-border">
                {/* swap with a real dark map screenshot */}
                <img src="/screenshots/sg-map-dark.png" alt="singapore map" className="h-full w-full object-cover" />

                {/* floating legend mock */}
                <div className="absolute right-3 top-3 rounded-[var(--radius-md)] border border-border bg-background/80 p-2 text-xs backdrop-blur">
                  <div className="mb-1 font-medium">flood density</div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-chart-1" /> low
                    <span className="h-2 w-2 rounded-full bg-chart-3" /> med
                    <span className="h-2 w-2 rounded-full bg-chart-5" /> high
                  </div>
                </div>

                {/* pin mock */}
                <div className="absolute left-1/3 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] border border-border bg-background/90 px-2 py-1 text-[11px] shadow">orchard rd</div>
                <MapPin className="absolute left-[31%] top-[54%] h-5 w-5 text-primary" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  )
}

function UseCases() {
  const cases = [
    {
      title: "urban planning",
      desc: "compare planning areas and subzones over years to guide zoning and drainage upgrades.",
    },
    {
      title: "emergency response",
      desc: "locate clinics, shelters, and access roads near hotspots for faster coordination.",
    },
    {
      title: "infrastructure maintenance",
      desc: "prioritise assets by recurrence and proximity to critical amenities.",
    },
  ]

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 text-center">
        <h2 className="font-[montserrat] text-3xl font-bold tracking-tight">what do you need it for?</h2>
        <p className="mt-2 text-muted-foreground">pick a path — we’ll shape the map to your goal.</p>
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

function FeaturesGrid() {
  const features = [
    { icon: Map, title: "singapore-first coverage", desc: "planning areas, subzones, road segments, and amenity overlays — tuned for sg data." },
    { icon: Layers, title: "historical flood layers", desc: "stack years and filter by event type; spot clusters and recurring hotspots." },
    { icon: LineChart, title: "trend & rank views", desc: "rank areas by cases or density across years with clean charts for slides." },
    { icon: Building2, title: "amenity proximity", desc: "see clinics, schools, and shelters near flooded roads for response planning." },
    { icon: Navigation, title: "route hints", desc: "contextual road segments help estimate safer access during events." },
    { icon: Zap, title: "fast briefings", desc: "save & share filtered links — everyone sees the same view." },
  ]

  return (
    <section id="features" className="mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 text-center">
        <h2 className="font-[montserrat] text-3xl font-bold tracking-tight">why teams use waterbenders</h2>
        <p className="mt-2 text-muted-foreground">built for planners, responders, and analysts who need clarity in minutes.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="border-border bg-card shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-lg)] bg-muted">
                <f.icon className="h-5 w-5 text-foreground/80" />
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

function HowItWorks() {
  const steps = [
    { step: 1, title: "search & locate", desc: "type a place (e.g., 'tampines'), or use your location to fly the map." },
    { step: 2, title: "filter & explore", desc: "pick years, planning areas, and event types; hover for rich context." },
    { step: 3, title: "prioritise", desc: "rank hotspots and surface amenities near high‑risk roads." },
    { step: 4, title: "share", desc: "export images or share a link — brief stakeholders in one click." },
  ]

  return (
    <section id="how" className="bg-muted/30 py-12">
      <div className="mx-auto max-w-7xl px-4">
        <h3 className="text-center font-[montserrat] text-2xl font-bold">how it works</h3>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <Card key={s.step} className="border-border bg-card shadow-sm">
              <CardHeader>
                <Badge variant="secondary" className="w-fit">step {s.step}</Badge>
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

function MiniGallery() {
  return (
    <section id="gallery" className="mx-auto max-w-7xl px-4 py-12">
      <h3 className="text-center font-[montserrat] text-2xl font-bold">screens at a glance</h3>
      <p className="mt-2 text-center text-muted-foreground">replace these with your real screenshots in /public/screenshots</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          { src: "/screenshots/layer-controls.png", alt: "layer controls" },
          { src: "/screenshots/amenities.png", alt: "amenities view" },
          { src: "/screenshots/compare.png", alt: "compare planning areas" },
        ].map((img) => (
          <Card key={img.alt} className="overflow-hidden border-border bg-card">
            <img src={img.src} alt={img.alt} className="h-48 w-full object-cover" />
          </Card>
        ))}
      </div>
    </section>
  )
}

function Credibility() {
  return (
    <section className="bg-muted/30 py-12">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h3 className="font-[montserrat] text-2xl font-bold">what we’re building</h3>
            <p className="mt-2 text-muted-foreground">a simple, fast, sg‑tuned web app to explore flood risk with nearby amenities. it’s opinionated about clarity, speed, and shareability.</p>
            <ul className="mt-4 list-inside list-disc text-sm text-muted-foreground">
              <li>shadcn ui + theme tokens for consistent dark ui</li>
              <li>map overlays for floods, roads, and amenities</li>
              <li>ranked views for year‑on‑year trends</li>
            </ul>
          </div>
          <Card className="border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">who benefits</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <div className="space-y-2">
                <p><strong className="text-foreground">planners:</strong> identify hotspots and infrastructure at risk.</p>
                <p><strong className="text-foreground">responders:</strong> check nearby clinics/shelters and route context.</p>
                <p><strong className="text-foreground">analysts:</strong> compare year‑on‑year trends with ranked views.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}

function CtaSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <Card className="border-border bg-card">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center md:flex-row md:justify-between md:text-left">
          <div>
            <h3 className="font-[montserrat] text-2xl font-bold">get started in minutes</h3>
            <p className="mt-1 max-w-2xl text-muted-foreground">use sample data or bring your own csvs. no setup drama — just insights.</p>
          </div>
          <div className="flex gap-3">
            <Button>launch app</Button>
            <Button variant="outline">book a walkthrough</Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 md:grid-cols-2">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-primary">
            <Droplets className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold">waterbenders</span>
        </div>
        <div className="flex items-center justify-start gap-4 md:justify-end">
          <a className="text-sm text-muted-foreground hover:text-foreground" href="#features">features</a>
          <a className="text-sm text-muted-foreground hover:text-foreground" href="#how">how it works</a>
          <a className="text-sm text-muted-foreground hover:text-foreground" href="#gallery">screens</a>
        </div>
      </div>
    </footer>
  )
}
