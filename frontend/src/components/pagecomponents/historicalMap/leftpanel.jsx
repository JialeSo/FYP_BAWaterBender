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

/* ---------- shared comboboxes ---------- */
function MultiSelectCombobox({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder = "select",
  searchPlaceholder = "search…",
  emptyText = "no results.",
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
  options = [],
  value = "",
  onChange,
  placeholder = "search…",
  emptyText = "no results.",
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

/* ---------- upgraded left panel ---------- */
export default function LeftPanel({
  /* planning areas */
  options = [],
  selected = [],
  onSelectionChange,
  onResetSelection,

  /* subzones */
  subzoneOptions = [],           // [{ name, planningArea }]
  selectedSubzone = "",
  onSubzonePick,                 // (subzoneName) => void

  /* amenities */
  amenityCategoriesOptions = [],
  selectedAmenityCategories = [],
  onAmenityCategoriesChange,
  amenityTypesOptions = [],
  selectedAmenityTypes = [],
  onAmenityTypesChange,

  /* NEW: floods */
  showFloods = true,
  onShowFloodsChange,            // (bool) => void
  floodTypesOptions = [],        // array<string> from csv event
  selectedFloodTypes = [],       // array<string>
  onFloodTypesChange,            // (array<string>) => void
  visibleFloodCount = 0,         // live count from map

  /* NEW: amenities master toggle (mirrors map) */
  showAmenities = false,
  onShowAmenitiesChange,         // (bool) => void

  /* NEW: choropleth metric */
  colorMetric = "floods",        // 'floods' | 'amenities'
  onColorMetricChange,           // (value) => void
}) {
  /* ----- planning areas ----- */
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

  /* ----- subzones ----- */
  const [limitSubzonesToSelection, setLimitSubzonesToSelection] = useState(true)
  const subzoneNames = useMemo(() => {
    if (!subzoneOptions?.length) return []
    const base = limitSubzonesToSelection && hasSelection
      ? subzoneOptions.filter(z => selectedAreas.includes(z.planningArea))
      : subzoneOptions
    return base.map((z) => z.name).sort()
  }, [subzoneOptions, hasSelection, selectedAreas, limitSubzonesToSelection])

  /* ----- floods ----- */
  const [floodTypeSearch, setFloodTypeSearch] = useState("")
  const filteredFloodTypes = useMemo(() => {
    const q = floodTypeSearch.trim().toLowerCase()
    if (!q) return floodTypesOptions
    return floodTypesOptions.filter(t => t.toLowerCase().includes(q))
  }, [floodTypesOptions, floodTypeSearch])
  const floodTypesSet = useMemo(() => new Set(selectedFloodTypes), [selectedFloodTypes])
  const toggleFloodType = (t) => {
    const exists = floodTypesSet.has(t)
    const next = exists ? selectedFloodTypes.filter(x => x !== t) : [...selectedFloodTypes, t]
    onFloodTypesChange?.(next)
  }
  const selectAllFloods = () => onFloodTypesChange?.(floodTypesOptions.slice())
  const clearAllFloods = () => onFloodTypesChange?.([])

  /* ----- amenities lists are already multi-selects above ----- */

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">filters</h2>
        <p className="text-sm text-muted-foreground">refine what’s displayed on the historical flood map.</p>
      </div>

      {/* display (choropleth metric) */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">display</span>
        <label className="block text-sm">
          <span className="text-muted-foreground">color by</span>
          <select
            className="mt-1 w-full rounded border bg-background p-2"
            value={colorMetric}
            onChange={(e) => onColorMetricChange?.(e.target.value)}
          >
            <option value="floods">flood events</option>
            <option value="amenities">amenities (count)</option>
          </select>
        </label>
      </div>

      <Separator />

      {/* floods */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">floods</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showFloods}
              onChange={(e) => onShowFloodsChange?.(e.target.checked)}
            />
            <span className="text-muted-foreground">show markers</span>
          </label>
        </div>

        {showFloods && (
          <>
            <div className="rounded-lg border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
              visible on map: <span className="font-semibold text-foreground">{visibleFloodCount}</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">types</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={selectAllFloods} disabled={!floodTypesOptions.length}>
                    select all
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={clearAllFloods} disabled={!selectedFloodTypes.length}>
                    clear
                  </Button>
                </div>
              </div>

              {/* searchable flood-type checklist */}
              <div className="rounded-md border p-2">
                <input
                  className="mb-2 w-full rounded border bg-background p-2 text-sm"
                  placeholder="search flood types…"
                  value={floodTypeSearch}
                  onChange={(e) => setFloodTypeSearch(e.target.value)}
                />
                <ScrollArea className="max-h-40 pr-1">
                  <div className="space-y-1">
                    {filteredFloodTypes.map((t) => {
                      const checked = floodTypesSet.has(t)
                      return (
                        <label key={t} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={checked} onChange={() => toggleFloodType(t)} />
                          <span className="truncate">{t}</span>
                        </label>
                      )
                    })}
                    {!filteredFloodTypes.length && (
                      <div className="py-3 text-center text-xs text-muted-foreground">no matching type</div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </>
        )}
      </div>

      <Separator />

      {/* amenities */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">amenities</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAmenities}
              onChange={(e) => onShowAmenitiesChange?.(e.target.checked)}
            />
            <span className="text-muted-foreground">show icons</span>
          </label>
        </div>

        {showAmenities && (
          <>
            <MultiSelectCombobox
              label="categories"
              options={amenityCategoriesOptions}
              selected={selectedAmenityCategories}
              onChange={onAmenityCategoriesChange}
              placeholder="select categories"
              searchPlaceholder="search categories"
              emptyText="no category found."
            />
            <MultiSelectCombobox
              label="types"
              options={amenityTypesOptions}
              selected={selectedAmenityTypes}
              onChange={onAmenityTypesChange}
              placeholder="select types"
              searchPlaceholder="search types"
              emptyText="no type found."
            />
          </>
        )}
      </div>

      <Separator />

      {/* subzone search */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">subzone</Label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={limitSubzonesToSelection}
              onChange={(e) => setLimitSubzonesToSelection(e.target.checked)}
            />
            limit to selected planning areas
          </label>
        </div>
        <SingleSelectCombobox
          label={null}
          options={subzoneNames}
          value={selectedSubzone}
          onChange={onSubzonePick}
          placeholder="search subzones"
          emptyText="no subzone found."
        />
        <div className="rounded-lg border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          tip: picking a subzone will auto-focus the map and show amenities within it.
        </div>
      </div>

      <Separator />

      {/* planning areas */}
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">planning areas</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={handleSelectAll} disabled={!normalizedOptions.length}>
                select all
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={handleClearAll} disabled={!hasSelection}>
                clear
              </Button>
            </div>
          </div>

          <Popover open={paOpen} onOpenChange={setPaOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={paOpen} className="w-full justify-between">
                <span className="truncate text-left">
                  {hasSelection ? `${selectedAreas.length} planning area${selectedAreas.length > 1 ? "s" : ""} selected` : "select planning areas"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <Command>
                <CommandInput placeholder="search planning areas" value={paSearch} onValueChange={setPaSearch} />
                <CommandEmpty>no planning area found.</CommandEmpty>
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
                    aria-label={`remove ${area}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
          tip: click a planning area on the map to drill into subzones.
        </div>
      </div>

      <div className="mt-auto">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleReset}
          disabled={
            !hasSelection &&
            !selectedSubzone &&
            !selectedFloodTypes.length &&
            !selectedAmenityCategories.length &&
            !selectedAmenityTypes.length &&
            showFloods === true &&
            showAmenities === false &&
            colorMetric === "floods"
          }
        >
          reset filters
        </Button>
      </div>
    </div>
  )
}
