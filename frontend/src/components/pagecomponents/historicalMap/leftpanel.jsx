import { useMemo, useState, useCallback, useEffect, useRef } from "react"
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

/* ---------- Simple string multiselect (Planning Areas, Amenity Types, Flood Types) ---------- */
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
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate text-left">
              {selectedValues.length ? `${selectedValues.length} selected` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        {/* keep over the map canvas */}
        <PopoverContent className={`z-50 ${popoverWidthClass} p-0`} align="start">
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
                          setOpen(true) // keep open for multi-pick
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

/* ---------- Subzone multiselect with PA subtitle and optional bulk actions ---------- */
function SubzoneMultiSelect({
  label,
  items = [],              // [{ name, planningArea }]
  selected = [],           // string[] of subzone names
  onChange,
  placeholder = "Select subzones",
  searchPlaceholder = "Search subzones…",
  emptyText = "No subzone found.",
  popoverWidthClass = "w-[360px]",
  showBulkActions = false, // show Select all / Clear only when PA is selected
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const options = useMemo(
    () =>
      items
        .map((z) => ({
          name: `${z?.name ?? ""}`.trim(),
          planningArea: `${z?.planningArea ?? ""}`.trim(),
        }))
        .filter((z) => z.name),
    [items]
  )

  const selectedValues = useMemo(
    () => selected.map((v) => `${v}`.trim()).filter(Boolean),
    [selected]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (z) =>
        z.name.toLowerCase().includes(q) ||
        z.planningArea.toLowerCase().includes(q)
    )
  }, [options, search])

  const toggle = useCallback(
    (name) => {
      const v = name.trim()
      const exists = selectedValues.includes(v)
      const next = exists ? selectedValues.filter((x) => x !== v) : [...selectedValues, v]
      onChange?.(next)
    },
    [onChange, selectedValues]
  )

  const handleSelectAll = () => onChange?.(options.map((o) => o.name))
  const handleClearAll = () => onChange?.([])

  return (
    <div className="space-y-2">
      {label && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate text-left">
              {selectedValues.length ? `${selectedValues.length} selected` : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        {/* over the map */}
        <PopoverContent className={`z-50 ${popoverWidthClass} p-0`} align="start">
          {showBulkActions && (
            <div className="flex items-center justify-between px-3 pt-3">
              <div className="text-xs text-muted-foreground">Subzones</div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={handleSelectAll} disabled={!options.length}>
                  Select all
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={handleClearAll} disabled={!selectedValues.length}>
                  Clear
                </Button>
              </div>
            </div>
          )}
          <Command>
            <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandList>
              <CommandGroup>
                <ScrollArea className="max-h-64">
                  {filtered.map((o) => {
                    const active = selectedValues.includes(o.name)
                    return (
                      <CommandItem
                        key={`${o.planningArea}::${o.name}`}
                        value={`${o.name} ${o.planningArea}`}
                        onSelect={() => {
                          toggle(o.name)
                          setOpen(true) // keep open for multi-pick
                        }}
                        className="flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate">{o.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {o.planningArea}
                          </div>
                        </div>
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

export default function LeftPanel({
  /** planning areas */
  options = [],
  selected = [],
  onSelectionChange,
  onResetSelection,

  /** subzone multi-select (scoped by PA selection if any) */
  subzoneOptions = [],          // [{ name, planningArea }]
  selectedSubzones = [],        // string[]
  onSelectedSubzonesChange,     // (names: string[]) => void

  /** amenities */
  amenityCategoriesOptions = [],
  selectedAmenityCategories = [],
  onAmenityCategoriesChange,
  amenityTypesOptions = [],
  selectedAmenityTypes = [],
  onAmenityTypesChange,

  /** floods */
  floodTypeOptions = [],
  selectedFloodTypes = [],
  onFloodTypesChange,
  floodDateFrom = "",
  floodDateTo = "",
  onFloodDateFromChange,
  onFloodDateToChange,
}) {
  const [paOpen, setPaOpen] = useState(false)
  const [paSearch, setPaSearch] = useState("")
  const normalizedOptions = useMemo(() => options.map((o) => o?.trim?.() ?? "").filter(Boolean), [options])
  const selectedAreas = useMemo(() => selected.map((v) => v?.trim?.() ?? "").filter(Boolean), [selected])
  const hasSelection = selectedAreas.length > 0

  const filteredPAOptions = useMemo(() => {
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
  const handleClearAll = () => onSelectionChange?.([])
  const handleReset = () => onResetSelection?.()

  /* subzones scoped by selected PAs (union); if no PA selected, show all subzones */
  const scopedSubzones = useMemo(() => {
    if (!subzoneOptions?.length) return []
    if (!selectedAreas.length) return subzoneOptions
    const set = new Set(selectedAreas.map((s) => s.trim()))
    return subzoneOptions.filter((z) => set.has(z.planningArea))
  }, [subzoneOptions, selectedAreas])

  /* Auto-select all subzones within scope whenever PA selection changes */
  const paKeyRef = useRef("")
  useEffect(() => {
    const newKey = selectedAreas.join("|")
    if (paKeyRef.current !== newKey) {
      paKeyRef.current = newKey
      const allNamesInScope = scopedSubzones.map((z) => z.name)
      onSelectedSubzonesChange?.(allNamesInScope)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAreas.join("|"), scopedSubzones.map((z) => z.name).join("|")])

  /* normalize amenity type options */
  const amenityTypeOptionsNormalized = useMemo(
    () => amenityTypesOptions.map((o) => `${o}`.trim()).filter(Boolean),
    [amenityTypesOptions]
  )

  return (
    /* z-30 so popovers sit above the map container */
    <div className="relative z-30 flex h-full flex-col gap-6 p-6">
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
              {/* No "Select all" per your request */}
              <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={handleClearAll} disabled={!hasSelection}>
                Clear
              </Button>
            </div>
          </div>

          <Popover open={paOpen} onOpenChange={setPaOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" role="combobox" aria-expanded={paOpen} className="w-full justify-between">
                <span className="truncate text-left">
                  {hasSelection ? `${selectedAreas.length} planning area${selectedAreas.length > 1 ? "s" : ""} selected` : "Select planning areas"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="z-50 w-[320px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search planning areas" value={paSearch} onValueChange={setPaSearch} />
                <CommandEmpty>No planning area found.</CommandEmpty>
                <CommandList>
                  <CommandGroup>
                    <ScrollArea className="max-h-64">
                      {filteredPAOptions.map((o) => {
                        const active = selectedAreas.includes(o)
                        return (
                          <CommandItem
                            key={o}
                            value={o}
                            onSelect={() => {
                              handleToggleArea(o)
                              setPaOpen(true) // keep open for multi-pick
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
      </div>

      {/* Subzones (MULTI) — independent, but scoped when PA is chosen */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subzones</Label>
        <SubzoneMultiSelect
          items={scopedSubzones}
          selected={selectedSubzones}
          onChange={onSelectedSubzonesChange}
          placeholder="Select subzones"
          searchPlaceholder="Search by subzone or planning area"
          showBulkActions={hasSelection}  // Select all / Clear only when PA is selected
        />
      </div>

      <Separator />

      {/* Amenities */}
      <div className="space-y-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amenities</span>
        <MultiSelectCombobox
          label="Categories (always full list)"
          options={amenityCategoriesOptions}
          selected={selectedAmenityCategories}
          onChange={onAmenityCategoriesChange}
          placeholder="Select categories"
          searchPlaceholder="Search categories"
          emptyText="No category found."
        />
        <MultiSelectCombobox
          label="Types (based on chosen categories)"
          options={amenityTypeOptionsNormalized}
          selected={selectedAmenityTypes}
          onChange={onAmenityTypesChange}
          placeholder="Select types"
          searchPlaceholder="Search types"
          emptyText="No type found."
        />
      </div>

      <Separator />

      {/* Floods */}
      <div className="space-y-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Floods</span>
        <MultiSelectCombobox
          label="Event types"
          options={floodTypeOptions}
          selected={selectedFloodTypes}
          onChange={onFloodTypesChange}
          placeholder="Select flood types"
          searchPlaceholder="Search flood types"
          emptyText="No type found."
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From date</Label>
            <input
              type="date"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={floodDateFrom}
              onChange={(e) => onFloodDateFromChange?.(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To date</Label>
            <input
              type="date"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={floodDateTo}
              onChange={(e) => onFloodDateToChange?.(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-auto">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleReset}
          disabled={
            !hasSelection &&
            !(selectedSubzones?.length) &&
            !selectedAmenityCategories.length &&
            !selectedAmenityTypes.length &&
            !selectedFloodTypes.length &&
            !floodDateFrom && !floodDateTo
          }
        >
          Reset filters
        </Button>
      </div>
    </div>
  )
}
