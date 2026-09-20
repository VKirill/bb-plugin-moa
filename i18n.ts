import { useSyncExternalStore } from "react";

const en = {
  pluginTitle: "Mixture of Agents",
  settingsTitle: "Mixture of Agents",
  settingsHint: "Plugin language. Auto follows BB. English and Russian switch in one click.",
  language: "Language",
  languageAuto: "Auto",
  languageEn: "English",
  languageRu: "Русский",
  languageHint: "Applies to MoA screens in this browser. Auto uses the BB interface language.",
  chipTitle: "Consult both participants before every message",
  chipTitleNew: "Use MoA starting with the first message",
  chipMenu: "MoA settings and history",
  chipMenuNew: "MoA settings",
  waiting: "Waiting",
  consulting: "Consulting",
  ready: "Ready",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
  bypassed: "Sent without advice",
  historyEmpty: "Consultations will appear here.",
  bbState: "BB state",
  seconds: "seconds",
  latestEvent: "Latest event",
  overdueHint: "Taking longer than the notification threshold. MoA continues waiting; the advisor is not stopped by this timer.",
  viewConsultation: "View consultation",
  retry: "Retry",
  advisorHistory: "Advisor history",
  requestFailed: "Request failed",
  longWaitChip: "Waiting",
  longWaitChipTitle: "Long consultation: open settings for the advisor's state and history",
  dialogDescription: "Both participants independently analyze the request. The current chat model receives both answers, acts and replies.",
  participantA: "Participant A",
  participantB: "Participant B",
  participant: "Participant",
  sessionsHint: "A and B each have a separate advisor session for this chat. The current chat model aggregates both answers.",
  sharedHint: "Models and fallback settings are shared across all chats and projects. Enabling MoA applies only to this chat.",
  chooseDifferent: "Choose two different models.",
  enableChat: "Enable MoA for this chat",
  longWaitLabel: "Long-wait notice after (seconds)",
  longWaitHelp: "This is a notification threshold, not a time limit for an active model. MoA waits for completion or an explicit BB error. You can cancel the queued message or turn MoA off.",
  backupParticipant: "Backup participant",
  close: "Close",
  save: "Save",
  cancel: "Cancel",
  consultationHistory: "Consultation history",
  sendNowHint: "BB’s explicit “Send now” overrides the wait and sends without advice. If a consultation fails, retry here or turn MoA off. Disabling the plugin also releases waiting messages.",
  newChatDescription: "Enable MoA before the first message. Both participants advise independently; your current chat model acts and answers.",
  newChatSharedHint: "Both A and B analyze every request independently. Models and fallback settings are shared across all chats and projects; enabling MoA applies only to this draft.",
  enableForChat: "Enable for this chat",
  loadingModels: "Loading models…",
  loadFailed: "Could not load MoA.",
  saveFailed: "Could not save MoA.",
  draftChanged: "The draft changed. Choose MoA again.",
  fallbackTitle: "If a participant fails",
  fallbackPolicy: "Fallback policy",
  fallbackWait: "Wait for a manual decision",
  fallbackReserve: "Try a reserve model",
  fallbackAvailable: "Continue with one ready answer",
  fallbackHelp: "Applies to a confirmed error or an idle session without a final answer. An active model keeps working, regardless of the notification timer. If both fail, the message stays queued.",
  reserveModel: "Reserve model",
  reserveDifferent: "Choose a reserve model different from A and B.",
  reserveHelp: "One reserve attempt per failed participant. You can also manually replace a still-working participant from its consultation history.",
  fallbackShared: "Fallback settings are shared across all chats.",
  historyTitle: "MoA: consultation history",
  historyDescription: "The actual request, the advisor's answer, and what was delivered to the acting model.",
  sharedConversation: "## Shared conversation history",
  currentRequest: "## Current request",
  advisorSession: "Advisor session",
  session: "Session",
  priorAttempt: "prior attempt",
  loadingConsultation: "Loading consultation…",
  ofTwoFallback: "1 of 2 answers · fallback",
  deliveryConfirmed: "Delivery confirmed",
  notDelivered: "Not delivered",
  thisMessage: "This message",
  historicalOne: "Historical consultation: this version used one advisor.",
  youToMoa: "You → MoA",
  messageAttachments: "Message with attachments",
  foundOutgoing: "Found in the advisor's actual outgoing request.",
  preparedUnconfirmed: "Prepared by MoA; submission is not yet confirmed in the event log.",
  noSavedRequest: "No saved request found.",
  gatewayAvailable: "File Gateway was available for this attempt. Actual reads appear in the participant session.",
  gatewayUnavailable: "External file access was unavailable for this attempt.",
  reserveReplaced: "Reserve replaced",
  stoppedByUser: "Stopped by user",
  requestContext: "Request, context and instructions",
  actingModel: "acting model",
  advisorPending: "The advisor has not returned a final answer yet.",
  actingReceived: "What the acting model received",
  actingConfirmed: "Your message and the complete advisor reference above are present in BB's actual outgoing request.",
  actingMissing: "No outgoing request containing this advice has been found. Ready advice alone does not confirm delivery.",
  showPayload: "Show the complete message payload",
  replaceParticipant: "Stop this participant and start reserve",
  s: "s",
  loadConsultationFailed: "Could not load consultation.",
  replacementFailed: "Replacement failed.",
};

const ru: typeof en = {
  pluginTitle: "Mixture of Agents",
  settingsTitle: "Mixture of Agents",
  settingsHint: "Язык плагина. «Авто» повторяет язык BB. Английский и русский переключаются одним нажатием.",
  language: "Язык",
  languageAuto: "Авто",
  languageEn: "English",
  languageRu: "Русский",
  languageHint: "Действует на экраны MoA в этом браузере. «Авто» берёт язык интерфейса BB.",
  chipTitle: "Совет двух участников перед каждым сообщением",
  chipTitleNew: "MoA с первого сообщения",
  chipMenu: "Настройки и история MoA",
  chipMenuNew: "Настройки MoA",
  waiting: "Ожидание",
  consulting: "Консультация",
  ready: "Готово",
  delivered: "Передано агенту",
  failed: "Ошибка",
  cancelled: "Отменено",
  bypassed: "Отправлено без совета",
  historyEmpty: "Здесь появится история консультаций.",
  bbState: "Состояние BB",
  seconds: "секунд",
  latestEvent: "Последнее событие",
  overdueHint: "Превышен порог уведомления. MoA продолжает ждать; этот таймер не останавливает советника.",
  viewConsultation: "Открыть консультацию",
  retry: "Повторить",
  advisorHistory: "История советника",
  requestFailed: "Ошибка запроса",
  longWaitChip: "Ожидаем",
  longWaitChipTitle: "Долгая консультация: состояние и история советника доступны в настройках",
  dialogDescription: "Оба участника независимо анализируют запрос. Модель текущего чата получает оба ответа, выполняет работу и отвечает.",
  participantA: "Участник A",
  participantB: "Участник B",
  participant: "Участник",
  sessionsHint: "У A и B отдельные сессии советников для этого чата. Модель текущего чата объединяет оба ответа.",
  sharedHint: "Модели и настройки фоллбека общие для всех чатов и проектов. Включение MoA относится только к этому чату.",
  chooseDifferent: "Выбери две разные модели.",
  enableChat: "Включить MoA для этого чата",
  longWaitLabel: "Сообщить о долгом ожидании через (секунд)",
  longWaitHelp: "Это порог уведомления, а не ограничение работы активной модели. MoA ждёт завершения или явной ошибки BB. Можно отменить сообщение в очереди или выключить MoA.",
  backupParticipant: "Резервный участник",
  close: "Закрыть",
  save: "Сохранить",
  cancel: "Отмена",
  consultationHistory: "История консультаций",
  sendNowHint: "Штатная команда BB «Отправить сейчас» отменяет ожидание и отправляет без совета. При ошибке повтори консультацию здесь или выключи MoA. Отключение самого плагина тоже освобождает ожидающие сообщения.",
  newChatDescription: "Включи MoA до первого сообщения. Оба участника сначала дают независимые советы, затем модель чата выполняет работу и отвечает.",
  newChatSharedHint: "A и B независимо анализируют каждый запрос. Модели и настройки фоллбека общие для всех чатов и проектов; включение MoA относится только к этому черновику.",
  enableForChat: "Включить для этого чата",
  loadingModels: "Загрузка моделей…",
  loadFailed: "Не удалось загрузить MoA.",
  saveFailed: "Не удалось сохранить MoA.",
  draftChanged: "Черновик изменился. Выбери MoA ещё раз.",
  fallbackTitle: "Если участник не ответил",
  fallbackPolicy: "Режим фоллбека",
  fallbackWait: "Ждать ручного решения",
  fallbackReserve: "Запустить резервную модель",
  fallbackAvailable: "Продолжить с одним готовым ответом",
  fallbackHelp: "Срабатывает при подтверждённой ошибке или завершении сессии без готового ответа. Активная модель продолжает работать независимо от таймера уведомления. Если не ответили оба, сообщение остаётся в очереди.",
  reserveModel: "Резервная модель",
  reserveDifferent: "Выбери резервную модель, отличную от A и B.",
  reserveHelp: "Одна резервная попытка для каждого сбойного участника. В истории консультации можно вручную заменить и участника, который ещё работает.",
  fallbackShared: "Настройки фоллбека общие для всех чатов.",
  historyTitle: "MoA: история консультации",
  historyDescription: "Что поступило советнику, что он ответил и что было передано основной модели.",
  sharedConversation: "## Переданная история чата",
  currentRequest: "## Текущий запрос",
  advisorSession: "Сессия советника",
  session: "Сессия",
  priorAttempt: "первая попытка",
  loadingConsultation: "Загрузка консультации…",
  ofTwoFallback: "1 из 2 ответов · фоллбек",
  deliveryConfirmed: "Передача подтверждена",
  notDelivered: "Ещё не передано",
  thisMessage: "Это сообщение",
  historicalOne: "Историческая консультация: в этой версии работал один советник.",
  youToMoa: "Вы → MoA",
  messageAttachments: "Сообщение с вложениями",
  foundOutgoing: "Найдено в реальном запросе к советнику.",
  preparedUnconfirmed: "Подготовлено MoA; отправка ещё не подтверждена журналом событий.",
  noSavedRequest: "Сохранённый запрос не найден.",
  gatewayAvailable: "File Gateway был доступен для этой попытки. Фактические чтения видны в сессии участника.",
  gatewayUnavailable: "Внешнее чтение было недоступно для этой попытки.",
  reserveReplaced: "Резерв заменил",
  stoppedByUser: "Остановлен пользователем",
  requestContext: "Запрос, контекст и инструкции",
  actingModel: "основная модель",
  advisorPending: "Советник ещё не вернул готовый ответ.",
  actingReceived: "Что получила основная модель",
  actingConfirmed: "В реальном исходящем запросе BB есть ваше сообщение и весь приведённый выше совет.",
  actingMissing: "Исходящий запрос с этим советом пока не найден. Готовность совета сама по себе не подтверждает передачу.",
  showPayload: "Показать полный состав сообщения",
  replaceParticipant: "Остановить этого участника и запустить резерв",
  s: "с",
  loadConsultationFailed: "Не удалось загрузить консультацию.",
  replacementFailed: "Не удалось заменить участника.",
};

export type I18nKey = keyof typeof en;
export type Locale = "en" | "ru";
export type UiLocale = "auto" | Locale;

const STORAGE_KEY = "moa:language";
const LANGUAGE_EVENT = "moa:language";

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "en" || value === "ru") return value;
  } catch { /* private mode */ }
  return null;
}

export function htmlLocale(): Locale {
  const lang = globalThis.document?.documentElement?.lang ?? "";
  return lang.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function detectLocale(): Locale {
  return storedLocale() ?? htmlLocale();
}

export function storedPreference(): UiLocale {
  return storedLocale() ?? "auto";
}

export function setLocale(locale: UiLocale): void {
  if (locale === "auto") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, locale);
  window.dispatchEvent(new Event(LANGUAGE_EVENT));
}

function subscribeLocale(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(LANGUAGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(LANGUAGE_EVENT, listener);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, detectLocale, () => "en");
}

export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribeLocale, storedPreference, () => "auto");
}

export function t(key: I18nKey, locale: Locale = detectLocale()): string {
  return (locale === "ru" ? ru : en)[key];
}

export const HISTORY_TITLE = en.historyTitle;
export const HISTORY_TITLES = [en.historyTitle, ru.historyTitle] as const;
