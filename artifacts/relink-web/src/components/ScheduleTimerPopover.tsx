import { useState } from "react";
import { Clock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "2 min", minutes: 2 },
  { label: "5 min", minutes: 5 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "5h", minutes: 300 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
];

type Props = {
  onSchedule: (minutes: number) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  /** If true, shows icon + chevron (compact mode for SuggestReplies) */
  compact?: boolean;
};

export function ScheduleTimerPopover({ onSchedule, disabled, size = "default", compact }: Props) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<"minutes" | "heures">("minutes");
  const [customVal, setCustomVal] = useState("");
  const [error, setError] = useState("");

  const maxVal = unit === "minutes" ? 1440 : 24;
  const minVal = unit === "minutes" ? 2 : 1;

  function handlePreset(minutes: number) {
    onSchedule(minutes);
    setOpen(false);
    setCustomVal("");
    setError("");
  }

  function handleCustomConfirm() {
    const n = parseInt(customVal, 10);
    if (isNaN(n) || n < minVal || n > maxVal) {
      setError(`Entre ${minVal} et ${maxVal} ${unit}`);
      return;
    }
    const minutes = unit === "heures" ? n * 60 : n;
    if (minutes < 2 || minutes > 1440) {
      setError("Entre 2 minutes et 24 heures");
      return;
    }
    onSchedule(minutes);
    setOpen(false);
    setCustomVal("");
    setError("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            className="h-8 px-2.5 text-xs rounded-lg gap-1"
            title="Programmer l'envoi"
          >
            <Clock className="h-3.5 w-3.5" />
            <ChevronDown className="h-3 w-3" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-xl"
            title="Programmer l'envoi"
            disabled={disabled}
          >
            <Clock className="h-4 w-4 text-amber-600" />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-3 space-y-3">
        {/* Header */}
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          ⏱ Timer de réponse
        </div>

        {/* Presets grid */}
        <div className="grid grid-cols-3 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.minutes}
              onClick={() => handlePreset(p.minutes)}
              className="text-xs py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-accent hover:text-accent-foreground transition-colors font-medium"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <div className="flex-1 h-px bg-border" />
          ou personnaliser
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Custom input */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={minVal}
              max={maxVal}
              value={customVal}
              onChange={(e) => { setCustomVal(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleCustomConfirm(); }}
              placeholder={`Ex: ${unit === "minutes" ? "45" : "3"}`}
              className="flex-1 h-8 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {/* Unit toggle */}
            <div className="flex rounded-lg border border-input overflow-hidden text-xs">
              {(["minutes", "heures"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => { setUnit(u); setCustomVal(""); setError(""); }}
                  className={cn(
                    "px-2 py-1.5 transition-colors",
                    unit === u
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted text-muted-foreground"
                  )}
                >
                  {u === "minutes" ? "min" : "h"}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-[11px] text-destructive">{error}</p>}

          <Button
            size="sm"
            className="w-full h-8 text-xs rounded-lg"
            onClick={handleCustomConfirm}
            disabled={!customVal}
          >
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            Programmer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
