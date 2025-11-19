import { Button } from "@/components/ui/button"
import { Link, useLocation } from "react-router-dom"
import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuLink, } from "@/components/ui/navigation-menu"
import { ArrowRight, Droplets, LineChart, ShieldCheck, Share2, MapPin, LocateFixed, Search } from "lucide-react"

export default function Header() {
  const { pathname } = useLocation();
  const isActive = (path) => pathname === path;

  return (
    <header className="bg-background text-foreground border-b border-border">
      <div className="flex items-center justify-between px-8 py-4">

        {/* BRAND */}
        <Link to="/home" className="flex items-center gap-2 group">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary">
              <Droplets className="h-5 w-5 text-primary-foreground" />
            </div>
          </div>
          <span className="font-semibold text-lg tracking-tight group-hover:text-primary transition-colors">
            WaterBender
          </span>
        </Link>

        {/* NAVIGATION */}
        <nav>
          <NavigationMenu>
            <NavigationMenuList className="flex items-center gap-6">
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link to="/historicalFloodMap">
                    <Button
                      variant={isActive("/historicalFloodMap") ? "secondary" : "ghost"}
                      size="sm"
                      className="transition-all hover:scale-105"
                    >
                      Singapore Historical Flood Map
                    </Button>
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>

              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link to="/floodEvents">
                    <Button
                      variant={isActive("/floodEvents") ? "secondary" : "ghost"}
                      size="sm"
                      className="transition-all hover:scale-105"
                    >
                      Flood Events
                    </Button>
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>

              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link to="/roadCentrality">
                    <Button
                      variant={isActive("/roadCentrality") ? "secondary" : "ghost"}
                      size="sm"
                      className="transition-all hover:scale-105"
                    >
                      Road Centrality
                    </Button>
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>

              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link to="/simulation">
                    <Button
                      variant={isActive("/simulation") ? "secondary" : "ghost"}
                      size="sm"
                      className="transition-all hover:scale-105"
                    >
                      Simulation
                    </Button>
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>

              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link to="/uploadData">
                    <Button
                      variant={isActive("/uploadData") ? "secondary" : "ghost"}
                      size="sm"
                      className="transition-all hover:scale-105"
                    >
                      Upload Data
                    </Button>
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>

            </NavigationMenuList>
          </NavigationMenu>
        </nav>
      </div>
    </header>
  );
}
