import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, X } from "lucide-react";
import { format_option_label } from "./utils";

export function MultiSelectFilter({ id, label, options = [], values = [], onChange, placeholder = "All" }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const normalized = useMemo(() => {
    return options
      .map((opt) => {
        const value = String(opt ?? "").trim();
        if (!value) return null;
        return { value, label: format_option_label(value, value) };
      })
      .filter(Boolean);
  }, [options]);

  const labelMap = useMemo(() => {
    const map = new Map();
    for (const opt of normalized) map.set(opt.value, opt.label);
    return map;
  }, [normalized]);

  const selectedValues = useMemo(
    () => values.map((v) => String(v ?? "").trim()).filter(Boolean),
    [values]
  );
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q)
    );
  }, [normalized, search]);

  const orderedFromSet = (set) =>
    normalized.map((opt) => opt.value).filter((value) => set.has(value));

  const toggle = (raw) => {
    const value = String(raw ?? "").trim();
    if (!value) return;
    const nextSet = new Set(selectedValues);
    if (nextSet.has(value)) nextSet.delete(value);
    else nextSet.add(value);
    onChange?.(orderedFromSet(nextSet));
  };

  const displayLabel = selectedValues.length
    ? (selectedValues.length <= 2
        ? selectedValues.map((v) => labelMap.get(v) ?? v).join(", ")
        : `${selectedValues.length} selected`)
    : placeholder;

  return (
    <div className="space-y-1.5">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <span className="truncate text-left">{displayLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="z-50 w-[320px] p-0"
        >
          <Command>
            <CommandInput
              placeholder={`Search ${label?.toLowerCase() ?? "options"}`}
              value={search}
              onValueChange={setSearch}
            />
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandList className="max-h-64 overflow-y-auto">
              <CommandGroup>
                <CommandItem
                  value="__all__"
                  onSelect={() => {
                    onChange?.([]);
                    setSearch("");
                  }}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    checked={selectedValues.length === 0}
                    readOnly
                    className="h-4 w-4"
                  />
                  <span className="truncate">All (no filter)</span>
                </CommandItem>
                <div className="my-1 h-px bg-border/60" />
                {filtered.map((opt) => {
                  const active = selectedSet.has(opt.value);
                  return (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      onSelect={() => toggle(opt.value)}
                      className="flex items-center gap-2"
                    >
                      <Checkbox checked={active} readOnly className="h-4 w-4" />
                      <span className="truncate">{opt.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((value) => {
            const labelText = labelMap.get(value) ?? format_option_label(value, value);
            return (
              <button
                type="button"
                key={value}
                onClick={() => toggle(value)}
                aria-label={`Remove ${labelText}`}
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                <span className="truncate">{labelText}</span>
                <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
