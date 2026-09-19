import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** Composer chip: MoA toggles the mode; the up-chevron opens settings. One visual control, two hit targets. */
export function MoAComposerToggle({
  pressed, disabled, title, menuLabel, onToggle, onOpenMenu, menuFailed, trailing, open,
}: {
  pressed: boolean;
  disabled?: boolean;
  title: string;
  menuLabel: string;
  onToggle: (next: boolean) => void;
  onOpenMenu: () => void;
  menuFailed?: boolean;
  trailing?: ReactNode;
  open?: boolean;
}) {
  return (
    <span title={title} className="inline-flex items-stretch">
      <Button
        type="button"
        variant="ghost"
        aria-pressed={pressed}
        aria-label="MoA"
        disabled={disabled}
        className="h-7 gap-0.5 rounded-r-none px-1.5 pr-0 text-xs"
        onClick={() => onToggle(!pressed)}
      >
        {pressed ? <Icon name="Check" className="size-3.5" /> : null}
        <span>MoA</span>
        {trailing}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        aria-label={menuLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`h-7 min-w-0 w-auto justify-center rounded-l-none px-0.5 touch-manipulation active:scale-95 ${menuFailed ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenMenu();
        }}
      >
        <span className="inline-flex">
          <Icon name={menuFailed ? "AlertCircle" : "ChevronUp"} className="size-4 pointer-events-none" />
        </span>
      </Button>
    </span>
  );
}
