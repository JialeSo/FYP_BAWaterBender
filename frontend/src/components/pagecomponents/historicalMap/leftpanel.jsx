import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Check, ChevronsUpDown, X } from "lucide-react"

export default function LeftPanel({ options = [], selected = [], onSelectionChange, onResetSelection }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const normalizedOptions = useMemo(() => options.map((option) => option.trim()).filter(Boolean), [options])
  const selectedAreas = useMemo(() => selected.map((value) => value.trim()).filter(Boolean), [selected])
  const hasSelection = selectedAreas.length > 0

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return normalizedOptions
    const query = search.trim().toLowerCase()
    return normalizedOptions.filter((option) => option.toLowerCase().includes(query))
  }, [normalizedOptions, search])

  const handleToggleArea = (area) => {
    const normalized = area.trim()
    let next
    if (selectedAreas.includes(normalized)) {
      next = selectedAreas.filter((item) => item !== normalized)
    } else {
      next = [...selectedAreas, normalized]
    }
    onSelectionChange?.(next)
  }

  const handleSelectAll = () => {
    onSelectionChange?.(normalizedOptions)
  }

  const handleClearAll = () => {
    onSelectionChange?.([])
  }

  const handleReset = () => {
    onResetSelection?.()
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Filters</h2>
        <p className="text-sm text-muted-foreground">Refine what is displayed on the historical flood map.</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planning Areas</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={handleSelectAll} disabled={!normalizedOptions.length}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={handleClearAll} disabled={!hasSelection}>
                Clear
              </Button>
            </div>
          </div>

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between"
              >
                <span className="truncate text-left">
                  {hasSelection ? `${selectedAreas.length} planning area${selectedAreas.length > 1 ? "s" : ""} selected` : "Select planning areas"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search planning areas" value={search} onValueChange={setSearch} />
                <CommandEmpty>No planning area found.</CommandEmpty>
                <CommandList>
                  <CommandGroup>
                    <ScrollArea className="max-h-64">
                      {filteredOptions.map((option) => {
                        const active = selectedAreas.includes(option)
                        return (
                          <CommandItem
                            key={option}
                            value={option}
                            onSelect={() => {
                              handleToggleArea(option)
                              setOpen(true)
                            }}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="truncate">{option}</span>
                            <Check className={active ? "h-4 w-4" : "h-4 w-4 opacity-0"} />
                          </CommandItem>
                        )
                      })}
                    </ScrollArea>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {hasSelection && (
            <div className="flex flex-wrap gap-2">
              {selectedAreas.map((area) => (
                <Badge key={area} variant="secondary" className="flex items-center gap-1">
                  <span className="truncate max-w-[160px]">{area}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-secondary-foreground/10"
                    onClick={() => handleToggleArea(area)}
                    aria-label={`Remove ${area}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
          Tip: Select one or more planning areas to reveal their subzones and road network on the map.
        </div>
      </div>

      <div className="mt-auto">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleReset}
          disabled={!hasSelection}
        >
          Reset filters
        </Button>
      </div>
    </div>
  )
}

