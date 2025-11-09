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

/* ----------------------------- subzone multiselect (scoped, user-editable) ----------------------------- */
function SubzoneMultiSelect({
  items = [],          // [{ name, planningArea }]
  selected = [],       // string[]
  onChange,
}) {
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
  const names = useMemo(() => options.map((o) => o.name), [options])

  const renderRow = useCallback(
    (name, active) => {
      const pa = options.find((x) => x.name === name)?.planningArea || ""
      return (
        <div className="flex items-start gap-2 min-w-0">
          <Checkbox checked={!!active} readOnly className="mt-0.5" />
          <div className="min-w-0">
            <div className="truncate">{name}</div>
            <div className="text-[11px] text-muted-foreground truncate">{pa}</div>
          </div>
        </div>
      )
    },
    [options]
  )

  return (
    <MultiSelectCombobox
      label="Subzones"
      options={names}
      selected={selected}
      onChange={onChange}
      placeholder="All subzones (in scope)"
      searchPlaceholder="Search subzones…"
      emptyText="No subzone found."
      popoverWidthClass="w-[420px]"
      showBulkActions
      showAllRow       // ✅ All row shown
      allMeansEmpty    // ✅ [] = no filter
      showRightCheck={false}
      renderItemLeft={renderRow}
      renderItemOverridesLabel={true}
    />
  )
}

/* -------------------------------- LeftPanel -------------------------------- */
export default function LeftPanel({
  /** planning areas */
  options = [],
  selected = [],                // [] means All (no filter)
  onSelectionChange,
  onResetSelection,

  /** subzones */
  subzoneOptions = [],          // [{ name, planningArea }]
  selectedSubzones = [],
  onSelectedSubzonesChange,

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
  /* ----- planning areas ----- */
  const paOptions = useMemo(() => options.map((o) => o?.trim?.() ?? "").filter(Boolean), [options])
  const selectedAreas = useMemo(() => selected.map((v) => v?.trim?.() ?? "").filter(Boolean), [selected])
  const isAll = selectedAreas.length === 0

  /* ----- subzones list scoped by PA (users can still filter inside) ----- */
  const scopedSubzones = useMemo(() => {
    if (!subzoneOptions?.length) return []
    if (isAll) return subzoneOptions
    const allow = new Set(selectedAreas.map((s) => s.trim()))
    return subzoneOptions.filter((z) => allow.has(z.planningArea))
  }, [subzoneOptions, selectedAreas, isAll])

  // When scope changes: drop out-of-scope selections; DON'T auto-select everything.
  const lastScopeKeyRef = useRef("")
  useEffect(() => {
    const scopeKey = (isAll ? "__ALL__" : selectedAreas.join("|"))
    if (lastScopeKeyRef.current === scopeKey) return

    const scopeSet = new Set(scopedSubzones.map((z) => z.name))
    const kept = (selectedSubzones || []).filter((n) => scopeSet.has(n))
    if (kept.length !== (selectedSubzones || []).length) {
      onSelectedSubzonesChange?.(kept) // if empty after filter → [] = All
    }
    lastScopeKeyRef.current = scopeKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAll,
    selectedAreas.join("|"),
    scopedSubzones.map((z) => z.name).join("|"),
    selectedSubzones.join("|"),
  ])

  return (
    <div className="relative z-30 flex h-full min-h-0 flex-col p-6">
      {/* header */}
      <div className="shrink-0 space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Filters</h2>
        <p className="text-sm text-muted-foreground">Refine what’s displayed on the historical flood map.</p>
      </div>

      {/* scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {/* Planning Areas (All by default) */}
        <div className="space-y-2 pt-4">
          <MultiSelectCombobox
            label="Planning Areas"
            options={paOptions}
            selected={selected}
            onChange={onSelectionChange}
            placeholder="All planning areas"
            searchPlaceholder="Search planning areas…"
            emptyText="No planning area found."
            popoverWidthClass="w-[360px]"
            showBulkActions
            showAllRow
            allMeansEmpty     // [] = no PA filter
            renderItemLeft={(o) => (
              <Checkbox checked={isAll ? false : selectedAreas.includes(o)} readOnly />
            )}
          />
        </div>

        <Separator className="my-6" />

        {/* Subzones (scoped list, All by default) */}
        <div className="space-y-2">
          <SubzoneMultiSelect
            items={scopedSubzones}
            selected={selectedSubzones}
            onChange={onSelectedSubzonesChange}
          />
        </div>

        <Separator className="my-6" />

        {/* Amenities (pretty labels, All by default) */}
        <div className="space-y-4">
          <MultiSelectCombobox
            label="Amenity Categories"
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
          <MultiSelectCombobox
            label="Amenity Types"
            options={amenityTypesOptions
              .map((v) => String(v || "").trim())
              .filter(Boolean)
              .map((v) => ({ value: v, label: pretty(v) }))
            }
            selected={selectedAmenityTypes}
            onChange={onAmenityTypesChange}
            placeholder="All types"
            searchPlaceholder="Search types…"
            emptyText="No type found."
            showBulkActions
            showAllRow
            allMeansEmpty
          />
        </div>

        <Separator className="my-6" />

        {/* Floods (All by default) */}
        <div className="space-y-4">
          <MultiSelectCombobox
            label="Flood Event Types"
            options={floodTypeOptions
              .map((v) => String(v || "").trim())
              .filter(Boolean)
              .map((v) => ({ value: v, label: pretty(v) }))
            }
            selected={selectedFloodTypes}
            onChange={onFloodTypesChange}
            placeholder="All flood types"
            searchPlaceholder="Search flood types…"
            emptyText="No type found."
            showBulkActions
            showAllRow
            allMeansEmpty
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
      </div>

      {/* footer */}
      <div className="mt-4 shrink-0">
        <Button
          variant="outline"
          className="w-full"
          onClick={onResetSelection}
          disabled={
            selected.length === 0 &&
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
