"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, ChevronsUpDown, X } from "lucide-react";

export function MultiSelectCombobox({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder = "select",
  searchPlaceholder = "search...",
  emptyText = "no results.",
  popoverWidthClass = "w-[320px]",
  showClear = true,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const normalizedOptions = useMemo(() => options.map((o) => `${o}`.trim()).filter(Boolean), [options]);
  const selectedValues = useMemo(() => selected.map((v) => `${v}`.trim()).filter(Boolean), [selected]);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((o) => o.toLowerCase().includes(q));
  }, [normalizedOptions, search]);

  const toggle = (val) => {
    const v = val.trim();
    const exists = selectedValues.includes(v);
    const next = exists ? selectedValues.filter((x) => x !== v) : [...selectedValues, v];
    onChange?.(next);
  };

  const clearAll = () => onChange?.([]);

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          {showClear && selectedValues.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={clearAll}>
              clear
            </Button>
          )}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate text-left">{selectedValues.length ? `${selectedValues.length} selected` : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className={`z-50 ${popoverWidthClass} p-0`}>
          <Command>
            <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            <CommandEmpty>{emptyText}</CommandEmpty>

            <ScrollArea className="max-h-[60vh]">
              <CommandList>
                <CommandGroup>
                  {filteredOptions.map((opt) => {
                    const active = selectedSet.has(opt);
                    return (
                      <CommandItem
                        key={opt}
                        value={opt}
                        onSelect={() => toggle(opt)}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{opt}</span>
                        <Check className={active ? "h-4 w-4" : "h-4 w-4 opacity-0"} />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </ScrollArea>
          </Command>
        </PopoverContent>
      </Popover>

      {!!selectedValues.length && (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => toggle(v)}
              aria-label={`Remove ${v}`}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              <span className="truncate max-w-[160px]">{v}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
