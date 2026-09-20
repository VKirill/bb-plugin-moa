import { forwardRef, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { blurActiveKeyboardInputBeforeOverlayOpen, getOverlayTriggerClassName, preventOverlayTriggerSelection } from "@/components/ui/overlay-trigger";

/** One composer chip. The whole control opens settings, like BB's model picker. */
export const MoAComposerToggle = forwardRef<HTMLButtonElement, {
  pressed: boolean;
  disabled?: boolean;
  menuLabel: string;
  menuFailed?: boolean;
  trailing?: ReactNode;
  open?: boolean;
  onOpenMenu: () => void;
}>(({ pressed, disabled, menuLabel, menuFailed, trailing, open, onOpenMenu }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    aria-pressed={pressed}
    aria-label="MoA"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-description={menuLabel}
    disabled={disabled}
    className={getOverlayTriggerClassName("h-7 gap-0.5 px-1.5 text-xs")}
    onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
      if (!open) blurActiveKeyboardInputBeforeOverlayOpen();
      preventOverlayTriggerSelection(event);
    }}
    onClick={() => { if (!disabled) onOpenMenu(); }}
  >
    {pressed ? <Icon name="Check" className="size-3.5" /> : null}
    <span>MoA</span>
    {trailing}
    <Icon name={menuFailed ? "AlertCircle" : "ChevronUp"} className={`size-4 ${menuFailed ? "text-destructive" : "text-muted-foreground"}`} />
  </Button>
));
MoAComposerToggle.displayName = "MoAComposerToggle";
