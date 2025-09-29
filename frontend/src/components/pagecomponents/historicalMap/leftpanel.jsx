import { useMemo, useState, useCallback } from "react"
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
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Check, ChevronsUpDown, X } from "lucide-react"

function MultiSelectCombobox({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder = "Select",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  popoverWidthClass = "w-[320px]",
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const normalizedOptions = useMemo(() => options.map((o) => `${o}`.trim()).filter(Boolean), [options])
  const selectedValues = useMemo(() => selected.map((v) => `${v}`.trim()).filter(Boolean), [selected])
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return normalizedOptions
    return normalizedOptions.filter((o) => o.toLowerCase().includes(q))
  }, [normalizedOptions, search])

  const toggle = useCallback(
    (val) => {
      const v = val.trim()
      const exists = selectedValues.includes(v)
      const next = exists ? selectedValues.filter((x) => x !== v) : [...selectedValues, v]
      onChange?.(next)
    },
    [onChange, selectedValues]
  )

  return (
    <div className="space-y-2">
      {label && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate text-left">
              {selectedValues.length ? `${selectedValues.length} selected` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={`${popoverWidthClass} p-0`} align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandList>
              <CommandGroup>
                <ScrollArea className="max-h-64">
                  {filteredOptions.map((o) => {
                    const active = selectedValues.includes(o)
                    return (
                      <CommandItem
                        key={o}
                        value={o}
                        onSelect={() => {
                          toggle(o)
                          setOpen(true)
                        }}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{o}</span>
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
      {!!selectedValues.length && (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((v) => (
            <Badge key={v} variant="secondary" className="flex items-center gap-1">
              <span className="truncate max-w-[160px]">{v}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-secondary-foreground/10"
                onClick={() => toggle(v)}
                aria-label={`remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function SingleSelectCombobox({
  label,
  options = [], // array of strings to show
  value = "",
  onChange,
  placeholder = "Search…",
  emptyText = "No results.",
  popoverWidthClass = "w-[320px]",
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const normalized = useMemo(() => options.map((o) => `${o}`.trim()).filter(Boolean), [options])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return normalized
    return normalized.filter((o) => o.toLowerCase().includes(q))
  }, [normalized, search])

  return (
    <div className="space-y-2">
      {label && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate text-left">{value || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={`${popoverWidthClass} p-0`} align="start">
          <Command>
            <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandList>
              <CommandGroup>
                <ScrollArea className="max-h-64">
                  {filtered.map((o) => (
                    <CommandItem
                      key={o}
                      value={o}
                      onSelect={() => {
                        onChange?.(o)
                        setOpen(false)
                      }}
                    >
                      {o}
                    </CommandItem>
                  ))}
                </ScrollArea>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default function LeftPanel({
  /** planning areas (back-compat) */
  options = [],
  selected = [],
  onSelectionChange,
  onResetSelection,

  /** NEW: subzone search */
  subzoneOptions = [], // [{ name, planningArea }]
  selectedSubzone = "",
  onSubzonePick,       // (subzoneName) => void

  /** NEW: amenity filters (from datasource) */
  amenityCategoriesOptions = [],
  selectedAmenityCategories = [],
  onAmenityCategoriesChange,
  amenityTypesOptions = [],
  selectedAmenityTypes = [],
  onAmenityTypesChange,
}) {
  const [paOpen, setPaOpen] = useState(false)
  const [paSearch, setPaSearch] = useState("")
  const normalizedOptions = useMemo(() => options.map((o) => o?.trim?.() ?? "").filter(Boolean), [options])
  const selectedAreas = useMemo(() => selected.map((v) => v?.trim?.() ?? "").filter(Boolean), [selected])
  const hasSelection = selectedAreas.length > 0
  const filteredOptions = useMemo(() => {
    if (!paSearch.trim()) return normalizedOptions
    const q = paSearch.trim().toLowerCase()
    return normalizedOptions.filter((o) => o.toLowerCase().includes(q))
  }, [normalizedOptions, paSearch])

  const handleToggleArea = (area) => {
    const v = area.trim()
    const exists = selectedAreas.includes(v)
    const next = exists ? selectedAreas.filter((x) => x !== v) : [...selectedAreas, v]
    onSelectionChange?.(next)
  }
  const handleSelectAll = () => onSelectionChange?.(normalizedOptions)
  const handleClearAll = () => onSelectionChange?.([])
  const handleReset = () => onResetSelection?.()

  const subzoneNames = useMemo(() => subzoneOptions.map((z) => z.name).sort(), [subzoneOptions])

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Filters</h2>
        <p className="text-sm text-muted-foreground">Refine what’s displayed on the historical flood map.</p>
      </div>

      {/* Planning areas */}
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

          <Popover open={paOpen} onOpenChange={setPaOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={paOpen} className="w-full justify-between">
                <span className="truncate text-left">
                  {hasSelection ? `${selectedAreas.length} planning area${selectedAreas.length > 1 ? "s" : ""} selected` : "Select planning areas"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search planning areas" value={paSearch} onValueChange={setPaSearch} />
                <CommandEmpty>No planning area found.</CommandEmpty>
                <CommandList>
                  <CommandGroup>
                    <ScrollArea className="max-h-64">
                      {filteredOptions.map((o) => {
                        const active = selectedAreas.includes(o)
                        return (
                          <CommandItem
                            key={o}
                            value={o}
                            onSelect={() => {
                              handleToggleArea(o)
                              setPaOpen(true)
                            }}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="truncate">{o}</span>
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
          Tip: Pick a subzone below — its planning area is auto-selected.
        </div>
      </div>

      {/* Subzone search (single) */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subzone</Label>
        <SingleSelectCombobox
          label={null}
          options={subzoneNames}
          value={selectedSubzone}
          onChange={onSubzonePick}
          placeholder="Search subzones"
          emptyText="No subzone found."
        />
      </div>

      <Separator />

      {/* Amenities */}
      <div className="space-y-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amenities</span>
        <MultiSelectCombobox
          label="Categories"
          options={amenityCategoriesOptions}
          selected={selectedAmenityCategories}
          onChange={onAmenityCategoriesChange}
          placeholder="Select categories"
          searchPlaceholder="Search categories"
          emptyText="No category found."
        />
        <MultiSelectCombobox
          label="Types"
          options={amenityTypesOptions}
          selected={selectedAmenityTypes}
          onChange={onAmenityTypesChange}
          placeholder="Select types"
          searchPlaceholder="Search types"
          emptyText="No type found."
        />
      </div>

      <div className="mt-auto">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleReset}
          disabled={
            !hasSelection &&
            !selectedSubzone &&
            !selectedAmenityCategories.length &&
            !selectedAmenityTypes.length
          }
        >
          Reset filters
        </Button>
      </div>
    </div>
  )
}
