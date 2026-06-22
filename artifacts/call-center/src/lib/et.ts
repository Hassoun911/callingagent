export const ET = "America/New_York";

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ET, month: "short", day: "numeric", year: "numeric",
  });
}

export function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ET, month: "short", day: "numeric",
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: ET, hour: "2-digit", minute: "2-digit",
  });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: ET, month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function fmtWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: ET, weekday: "short",
  });
}

export function fmtNowTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: ET, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

export function fmtRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return fmtTime(iso);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return fmtWeekday(iso);
  return fmtDateShort(iso);
}
