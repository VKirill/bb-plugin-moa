import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** Presentational composer chip. DialogTrigger / MobileTrigger owns open, like Agency. */
export const MoAComposerToggle = forwardRef<HTMLButtonElement, {
  pressed: boolean;
  disabled?: boolean;
  menuLabel: string;
  menuFailed?: boolean;
  trailing?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>>(({
  pressed, disabled, menuLabel, menuFailed, trailing, className, type, ...props
}, ref) => (
  <Button
    ref={ref}
    type={type ?? "button"}
    variant="ghost"
    aria-pressed={pressed}
    aria-label="MoA"
    aria-description={menuLabel}
    disabled={disabled}
    className={["h-7 gap-0.5 px-1.5 text-xs", className].filter(Boolean).join(" ")}
    {...props}
  >
    {pressed ? <Icon name="Check" className="size-3.5" /> : null}
    <span>MoA</span>
    {trailing}
    <Icon name={menuFailed ? "AlertCircle" : "ChevronUp"} className={`size-4 ${menuFailed ? "text-destructive" : "text-muted-foreground"}`} />
  </Button>
));
MoAComposerToggle.displayName = "MoAComposerToggle";
