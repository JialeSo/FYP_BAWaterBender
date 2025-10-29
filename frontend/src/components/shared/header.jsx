import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from "@/components/ui/navigation-menu"

export default function Header() {
  return (
    <header className="bg-background text-foreground border-b border-border">
      <nav className="flex justify-center px-6 py-4">
        <NavigationMenu>
          <NavigationMenuList className="flex items-center gap-6">
            {/* home */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link to="/home">
                  <Button variant="ghost" size="sm">Home</Button>
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {/* dashboard map */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link to="/dashboard-map">
                  <Button variant="ghost" size="sm">Dashboard Map</Button>
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {/* flood events */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link to="/flood-events">
                  <Button variant="ghost" size="sm">Flood Events</Button>
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {/* road centrality */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link to="/road-centrality">
                  <Button variant="ghost" size="sm">Road Centrality</Button>
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {/* singapore historical flood map */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link to="/historical-flood-map">
                  <Button variant="ghost" size="sm">Singapore Historical Flood Map</Button>
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {/* simulation */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link to="/simulation">
                  <Button variant="ghost" size="sm">Simulation</Button>
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {/* learn more (kept as requested) */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Button variant="outline" size="sm">Learn More</Button>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </nav>
    </header>
  )
}
