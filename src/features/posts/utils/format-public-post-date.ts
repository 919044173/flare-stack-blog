import { getLocale } from "@/paraglide/runtime";

// Publication dates already use UTC days for validation and archive grouping.
// Explicit locale + timezone make the SSR text identical to the first client render.
const formats = {
  zh: {
    full: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    short: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
    }),
    fullWithTime: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    shortWithTime: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  },
  en: {
    full: new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    short: new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
    }),
    fullWithTime: new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    shortWithTime: new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  },
};

export function formatPublicPostDate(
  value: Date | string | number | null | undefined,
  {
    monthDay = false,
    withTime = false,
    locale = getLocale(),
  }: { monthDay?: boolean; withTime?: boolean; locale?: "zh" | "en" } = {},
) {
  if (value == null) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const key = `${monthDay ? "short" : "full"}${withTime ? "WithTime" : ""}` as
    | "full"
    | "short"
    | "fullWithTime"
    | "shortWithTime";
  return formats[locale][key].format(date);
}