import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** One composer chip: hover/press as a block. Label toggles MoA; chevron opens settings. */
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
  const openMenu = (e: { preventDefault(): void; stopPropagation(): void }) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) onOpenMenu();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    openMenu(e);
  };
  return (
    <span title={title} className="inline-flex">
    <Button
      type="button"
      variant="ghost"
      aria-pressed={pressed}
      aria-label="MoA"
      disabled={disabled}
      className="h-7 gap-0.5 px-1.5 text-xs"
      onClick={() => onToggle(!pressed)}
    >
      {pressed ? <Icon name="Check" className="size-3.5" /> : null}
      <span>MoA</span>
      {trailing}
      <span
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={menuLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        className={`inline-flex touch-manipulation ${menuFailed ? "text-destructive" : "text-muted-foreground"}`}
        onClick={openMenu}
        onKeyDown={onMenuKey}
      >
        <Icon name={menuFailed ? "AlertCircle" : "ChevronUp"} className="size-4 pointer-events-none" />
      </span>
    </Button>
    </span>
  );
}
