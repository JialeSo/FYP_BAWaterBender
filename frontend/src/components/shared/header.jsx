import { Button } from "@/components/ui/button"
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
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Button variant="outline" size="sm">About</Button>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Button variant="ghost" size="sm">Use Case 1</Button>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Button variant="ghost" size="sm">Use Case 2</Button>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Button variant="ghost" size="sm">Use Case 3</Button>
              </NavigationMenuLink>
            </NavigationMenuItem>

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
