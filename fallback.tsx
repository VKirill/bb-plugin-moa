import type { ReactNode } from "react";
import type { Config } from "./contract";
import { t, useLocale } from "./i18n";

export function invalidFallback(config: Config) {
  return config.failurePolicy === "reserve" && !config.reserve || !!config.reserve && [config.a, config.b].some(s => s.providerId === config.reserve!.providerId && s.model === config.reserve!.model);
}
export function FallbackSettings({ config, onChange, picker }: { config: Config; onChange: (config: Config) => void; picker: ReactNode }) {
  useLocale();
  return <section className="space-y-3 rounded-lg border border-border p-3">
    <label className="block text-sm font-medium">{t("fallbackTitle")}
      <select aria-label={t("fallbackPolicy")} className="mt-2 w-full rounded-md border border-input bg-background p-2 text-sm"
        value={config.failurePolicy ?? "wait"} onChange={e => onChange({ ...config, failurePolicy: e.target.value as Config["failurePolicy"] })}>
        <option value="wait">{t("fallbackWait")}</option>
        <option value="reserve">{t("fallbackReserve")}</option>
        <option value="available">{t("fallbackAvailable")}</option>
      </select>
    </label>
    <p className="text-xs text-muted-foreground">{t("fallbackHelp")}</p>
    {(config.failurePolicy === "reserve" || config.reserve) && <div className="space-y-2">
      <p className="text-sm font-medium">{t("reserveModel")}</p>
      {picker}
      {invalidFallback(config) && <p className="text-xs text-destructive">{t("reserveDifferent")}</p>}
      <p className="text-xs text-muted-foreground">{t("reserveHelp")}</p>
    </div>}
    <p className="text-xs text-muted-foreground">{t("fallbackShared")}</p>
  </section>;
}
