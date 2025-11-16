import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Check, ChevronsUpDown } from "lucide-react"
import { Input } from "@/components/ui/input"

/* ---------- utils ---------- */
const pretty = (s = "") =>
  String(s)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())

/* ------------------- generic multiselect (strings OR {value,label}) with bulk actions ------------------- */
function MultiSelectCombobox({
  label,
  options = [],                         // string[] | { value, label }[]
  selected = [],                        // raw values (string[])
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  popoverWidthClass = "w-[320px]",
  showBulkActions = true,
  showAllRow = true,                    // now default to showing “All”
  allMeansEmpty = true,                 // [] = no filter
  keepOpenOnSelect = true,
  showRightCheck = true,
  renderItemLeft = null,
  renderItemOverridesLabel = false,
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  // normalize to { value, label }
  const normalized = useMemo(
    () => options
      .map((o) => {
        if (typeof o === "string") {
          const v = o.trim()
          return v ? { value: v, label: v } : null
        }
        const v = String(o?.value ?? "").trim()
        const l = String(o?.label ?? o?.value ?? "").trim()
        return v ? { value: v, label: l || v } : null
      })
      .filter(Boolean),
    [options]
  )

  const selectedValues = useMemo(
    () => selected.map((v) => `${v}`.trim()).filter(Boolean),
    [selected]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return normalized
    return normalized.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    )
  }, [normalized, search])

  const onSelectAll = useCallback(() => {
    onChange?.(allMeansEmpty ? [] : normalized.map((o) => o.value))
    setSearch("")
  }, [onChange, normalized, allMeansEmpty])

  const onClear = useCallback(() => {
    onChange?.([])
    setSearch("")
  }, [onChange])

  const toggle = useCallback((rawVal) => {
    const v = String(rawVal || "").trim()
    const exists = selectedValues.includes(v)
    const next = exists ? selectedValues.filter((x) => x !== v) : [...selectedValues, v]
    onChange?.(next)
  }, [onChange, selectedValues])

  return (
    <div className="space-y-2">
      {label && <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate text-left">
              {showAllRow && allMeansEmpty && selectedValues.length === 0
                ? "All (no filter)"
                : (selectedValues.length ? `${selectedValues.length} selected` : placeholder)}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className={`z-50 ${popoverWidthClass} p-0 max-h-[70vh] overflow-hidden`} align="start">
          {showBulkActions && (
            <div className="flex items-center justify-between px-3 pt-3">
              <div className="text-xs text-muted-foreground">{label || "Options"}</div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={onSelectAll}>
                  Select all
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={onClear} disabled={!selectedValues.length}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          <Command className="w-full">
            <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            <CommandEmpty>{emptyText}</CommandEmpty>

            {/* single scroll layer */}
            <CommandList className="max-h-[60vh] overflow-y-auto overscroll-contain">
              <CommandGroup>
                {showAllRow && (
                  <>
                    <CommandItem
                      value="__ALL__"
                      onSelect={() => onSelectAll()}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={allMeansEmpty ? selectedValues.length === 0 : selectedValues.length === normalized.length}
                          readOnly
                        />
                        <span className="truncate">All (no filter)</span>
                      </div>
                    </CommandItem>
                    <div className="h-px my-1 bg-border/60" />
                  </>
                )}

                {filtered.map((o) => {
                  const active = selectedValues.includes(o.value)
                  return (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      onSelect={(raw) => {
                        toggle(raw)
                        if (!keepOpenOnSelect) setOpen(false)
                      }}
                      className="flex items-start justify-between gap-2"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        {renderItemLeft ? renderItemLeft(o.value, active, o.label) : null}
                        {!renderItemOverridesLabel && (
                          <span className="truncate">{o.label}</span>
                        )}
                      </div>
                      {showRightCheck && <Check className={active ? "h-4 w-4" : "h-4 w-4 opacity-0"} />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/* -------------------------------- LeftPanel -------------------------------- */
export default function LeftPanel({
  /** planning areas */
  options = [],
  selected = [],                // now a single-select
  onSelectionChange,
  onResetSelection,

  /** subzones */
  subzoneOptions = [],
  selectedSubzones = [],
  onSelectedSubzonesChange,

  /** amenities */
  amenityCategoriesOptions = [],
  selectedAmenityCategories = [],
  onAmenityCategoriesChange,
  amenityTypesOptions = [],
  selectedAmenityTypes = [],
  onAmenityTypesChange,

  /** flood types */
  floodTypeOptions = [],
  selectedFloodTypes = [],
  onFloodTypesChange,

  /** flood date range */
  floodDateFrom = "",
  floodDateTo = "",
  onFloodDateFromChange,
  onFloodDateToChange,
}) {
  /* ----- planning areas (multi-select with all by default) ----- */
  const paOptions = useMemo(() => options.map((o) => pretty(o?.trim?.() ?? "")).filter(Boolean), [options])

  /* ----- flood types (checkbox list, all by default) ----- */
  const floodTypesList = useMemo(() => floodTypeOptions.map((v) => String(v || "").trim()).filter(Boolean), [floodTypeOptions])

  const handleResetFilters = useCallback(() => {
    onSelectionChange?.([])
    onSelectedSubzonesChange?.([])
    onAmenityCategoriesChange?.([])
    onAmenityTypesChange?.([])
    onFloodTypesChange?.([])
    onFloodDateFromChange?.("")
    onFloodDateToChange?.("")
  }, [onSelectionChange, onSelectedSubzonesChange, onAmenityCategoriesChange, onAmenityTypesChange, onFloodTypesChange, onFloodDateFromChange, onFloodDateToChange])

  const hasFilters = selected.length > 0
    || selectedSubzones.length > 0
    || selectedAmenityCategories.length > 0
    || selectedAmenityTypes.length > 0
    || selectedFloodTypes.length > 0
    || floodDateFrom
    || floodDateTo

  return (
    <div className="relative z-30 flex h-full min-h-0 flex-col p-6">
      {/* header */}
      <div className="shrink-0 space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Filters</h2>
        <p className="text-sm text-muted-foreground">Refine what's displayed on the historical flood map.</p>
      </div>

      {/* scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {/* Planning Area (multi-select, all checked by default) */}
        <div className="space-y-2 pt-4">
          <MultiSelectCombobox
            label="Planning Area"
            options={paOptions.map((pa) => ({ value: pa, label: pa }))}
            selected={selected}
            onChange={onSelectionChange}
            placeholder="Select planning areas"
            searchPlaceholder="Search planning areas…"
            emptyText="No planning area found."
            showBulkActions
            showAllRow={false}
            allMeansEmpty={false}
            renderItemLeft={(value, active) => (
              <Checkbox checked={active} readOnly />
            )}
          />
        </div>

        <Separator className="my-6" />

        {/* Amenity Categories (all by default) */}
        <div className="space-y-2">
          <MultiSelectCombobox
            label="Amenity Category"
            options={amenityCategoriesOptions
              .map((v) => String(v || "").trim())
              .filter(Boolean)
              .map((v) => ({ value: v, label: pretty(v) }))
            }
            selected={selectedAmenityCategories}
            onChange={onAmenityCategoriesChange}
            placeholder="All categories"
            searchPlaceholder="Search categories…"
            emptyText="No category found."
            showBulkActions
            showAllRow
            allMeansEmpty
          />
        </div>

        <Separator className="my-6" />

        {/* Flood Type (checkbox list, all by default) */}
        <div className="space-y-2">
          <MultiSelectCombobox
            label="Flood Type"
            options={floodTypesList.map((v) => ({ value: v, label: pretty(v) }))}
            selected={selectedFloodTypes}
            onChange={onFloodTypesChange}
            placeholder="All flood types"
            searchPlaceholder="Search flood types…"
            emptyText="No flood type found."
            showBulkActions
            showAllRow
            allMeansEmpty
          />
        </div>

        <Separator className="my-6" />

        {/* Date Range */}
        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Flood Date Range</span>
          <div className="space-y-2">
            <div>
              <Label htmlFor="date-from" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="date-from"
                type="date"
                value={floodDateFrom}
                onChange={(e) => onFloodDateFromChange?.(e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <Label htmlFor="date-to" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="date-to"
                type="date"
                value={floodDateTo}
                onChange={(e) => onFloodDateToChange?.(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="mt-4 shrink-0">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleResetFilters}
          disabled={!hasFilters}
        >
          Reset filters
        </Button>
      </div>
    </div>
  )
}
