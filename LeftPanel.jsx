import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const MIN_SEARCH_LENGTH = 2

export default function LeftPanel({ options = [], filters, onFiltersChange, onResetFilters }) {
  const planningArea = filters?.planningArea ?? "all"
  const searchTerm = filters?.searchTerm ?? ""
  const trimmedSearch = searchTerm.trim()
  const searchActive = trimmedSearch.length >= MIN_SEARCH_LENGTH

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Filters</h2>
        <p className="text-sm text-muted-foreground">Refine what is displayed on the historical flood map.</p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="planning-area-select" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Planning Area
          </Label>
          <Select
            value={planningArea}
            onValueChange={(value) => onFiltersChange?.({ planningArea: value })}
          >
            <SelectTrigger id="planning-area-select">
              <SelectValue placeholder="Select planning area" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All planning areas</SelectItem>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subzone-search" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Subzone
          </Label>
          <Input
            id="subzone-search"
            value={searchTerm}
            onChange={(event) => onFiltersChange?.({ searchTerm: event.target.value })}
            placeholder="Search subzone name"
          />
          <p className="text-xs text-muted-foreground">
            {searchActive ? `Filtering subzones that contain "${trimmedSearch}".` : "Type at least two characters to filter by subzone."}
          </p>
        </div>
      </div>

      <div className="mt-auto">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onResetFilters?.()}
          disabled={planningArea === "all" && trimmedSearch.length === 0}
        >
          Reset filters
        </Button>
      </div>
    </div>
  )
}
