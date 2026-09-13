import type { ReactNode } from "react";
import type { Config } from "./contract";
const ru = typeof navigator !== "undefined" && navigator.languages.some(l => l.startsWith("ru"));
const t = (en: string, russian: string) => ru ? russian : en;
export function invalidFallback(config: Config) {
  return config.failurePolicy === "reserve" && !config.reserve || !!config.reserve && [config.a, config.b].some(s => s.providerId === config.reserve!.providerId && s.model === config.reserve!.model);
}
export function FallbackSettings({ config, onChange, picker }: { config: Config; onChange: (config: Config) => void; picker: ReactNode }) {
  return <section className="space-y-3 rounded-lg border border-border p-3">
    <label className="block text-sm font-medium">{t("If a participant fails", "Если участник не ответил")}
      <select aria-label={t("Fallback policy", "Режим фоллбека")} className="mt-2 w-full rounded-md border border-input bg-background p-2 text-sm"
        value={config.failurePolicy ?? "wait"} onChange={e => onChange({ ...config, failurePolicy: e.target.value as Config["failurePolicy"] })}>
        <option value="wait">{t("Wait for a manual decision", "Ждать ручного решения")}</option>
        <option value="reserve">{t("Try a reserve model", "Запустить резервную модель")}</option>
        <option value="available">{t("Continue with one ready answer", "Продолжить с одним готовым ответом")}</option>
      </select>
    </label>
    <p className="text-xs text-muted-foreground">{t("Applies to a confirmed error or an idle session without a final answer. An active model keeps working, regardless of the notification timer. If both fail, the message stays queued.", "Срабатывает при подтверждённой ошибке или завершении сессии без готового ответа. Активная модель продолжает работать независимо от таймера уведомления. Если не ответили оба, сообщение остаётся в очереди.")}</p>
    {(config.failurePolicy === "reserve" || config.reserve) && <div className="space-y-2">
      <p className="text-sm font-medium">{t("Reserve model", "Резервная модель")}</p>
      {picker}
      {invalidFallback(config) && <p className="text-xs text-destructive">{t("Choose a reserve model different from A and B.", "Выбери резервную модель, отличную от A и B.")}</p>}
      <p className="text-xs text-muted-foreground">{t("One reserve attempt per failed participant. You can also manually replace a still-working participant from its consultation history.", "Одна резервная попытка для каждого сбойного участника. В истории консультации можно вручную заменить и участника, который ещё работает.")}</p>
    </div>}
    <p className="text-xs text-muted-foreground">{t("Fallback settings are shared across all chats.", "Настройки фоллбека общие для всех чатов.")}</p>
  </section>;
}
