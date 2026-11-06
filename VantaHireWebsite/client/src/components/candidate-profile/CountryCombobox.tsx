// Searchable country picker. Design adapted from 21st.dev "Country Combobox"
// (cnippet-dev, v-combobox-10): outline trigger, search field with icon, empty state,
// scrollable list. Rebuilt on the app's Popover + cmdk Command (the original uses Base UI,
// which this app doesn't ship) and on the server's own 249-code country list.
import { useId, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { COUNTRIES } from "./countries";

type Props = {
  value: string;
  onChange: (code: string) => void;
  labelId?: string | undefined;
  id?: string | undefined;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  exclude?: string[] | undefined;
  placeholder?: string | undefined;
  onClose?: (() => void) | undefined;
};

/** Plain matching, not fuzzy: names starting with the query first, then names with a word
 * starting with it, then names containing it; an exact two-letter code also matches. */
export function matchCountries(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRIES;
  const rank = (name: string, code: string) => {
    const n = name.toLowerCase();
    if (code.toLowerCase() === q || n.startsWith(q)) return 0;
    if (n.split(/[\s&(),.-]+/).some(w => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return COUNTRIES.map(c => ({ c, r: rank(c.name, c.code) })).filter(x => x.r >= 0).sort((a, b) => a.r - b.r).map(x => x.c);
}

export function CountryCombobox({ value, onChange, labelId, id, describedBy, invalid, disabled, exclude = [], placeholder = "Select a country", onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = matchCountries(query).filter(c => !exclude.includes(c.code));
  const listId = useId();
  const selected = COUNTRIES.find(c => c.code === value);
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); setQuery(""); if (!o) onClose?.(); }}>
      <PopoverTrigger asChild>
        <button id={id} type="button" role="combobox" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox"
          aria-labelledby={labelId && id ? `${labelId} ${id}` : labelId} aria-describedby={describedBy} aria-invalid={invalid} disabled={disabled}
          className={cn(
            "flex min-h-11 w-full cursor-pointer items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-base md:text-sm",
            "ring-offset-background transition-colors duration-200 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
            !selected && "text-muted-foreground",
          )}>
          <span className="truncate">{selected?.name ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <CommandPrimitive shouldFilter={false} className="flex flex-col overflow-hidden rounded-md text-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <CommandPrimitive.Input value={query} onValueChange={setQuery} placeholder="e.g. India" aria-label="Search countries"
              className="flex h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm" />
          </div>
          <CommandPrimitive.List id={listId} className="max-h-64 overflow-y-auto overscroll-contain p-1">
            <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">No countries found.</CommandPrimitive.Empty>
            {shown.map(c => (
              <CommandPrimitive.Item key={c.code} value={`${c.name} ${c.code}`}
                onSelect={() => { onChange(c.code); setOpen(false); onClose?.(); }}
                className="flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-sm px-2 text-sm aria-selected:bg-muted data-[selected=true]:bg-muted">
                <Check className={cn("h-4 w-4 shrink-0", c.code === value ? "opacity-100" : "opacity-0")} aria-hidden />
                <span>{c.name}</span>
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
