import { Button } from "@/components/ui/button";
import { setLocale, t, useLocale, useUiLocale, type UiLocale } from "./i18n";

export function LanguageSettings() {
  useLocale();
  const preference = useUiLocale();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("languageHint")}</p>
      <div className="flex items-center gap-1" role="group" aria-label={t("language")}>
        {(["auto", "en", "ru"] as const).map((item: UiLocale) => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={preference === item ? "default" : "outline"}
            onClick={() => setLocale(item)}
          >
            {item === "auto" ? t("languageAuto") : item === "en" ? t("languageEn") : t("languageRu")}
          </Button>
        ))}
      </div>
    </div>
  );
}
