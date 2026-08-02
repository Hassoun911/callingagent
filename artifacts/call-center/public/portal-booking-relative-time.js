(() => {
  const RELATIVE_ATTR = "data-relative-booking-time";
  const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

  function normalizeTimeText(value) {
    return value
      .replace(/\u00a0/g, " ")
      .replace(/a\.m\./gi, "AM")
      .replace(/p\.m\./gi, "PM")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parsePortalDate(text) {
    const normalized = normalizeTimeText(text);
    const match = normalized.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(\d{4}))?,?\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
    if (!match) return null;

    const now = new Date();
    const month = MONTHS.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
    const day = Number(match[2]);
    let year = match[3] ? Number(match[3]) : now.getFullYear();
    let hour = Number(match[4]);
    const minute = Number(match[5]);
    const meridiem = match[6].toUpperCase();

    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;

    let result = new Date(year, month, day, hour, minute, 0, 0);
    if (!match[3] && result.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
      year += 1;
      result = new Date(year, month, day, hour, minute, 0, 0);
    }
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function formatRelative(target) {
    const diffMs = target.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const future = diffMs >= 0;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (absMs < minute) return future ? "starting now" : "just started";
    if (absMs < hour) {
      const minutes = Math.max(1, Math.round(absMs / minute));
      return future ? `in ${minutes} minute${minutes === 1 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    }
    if (absMs < day) {
      const hours = Math.max(1, Math.round(absMs / hour));
      return future ? `in ${hours} hour${hours === 1 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"} ago`;
    }

    const days = Math.max(1, Math.round(absMs / day));
    if (future && days === 1) return "tomorrow";
    if (!future && days === 1) return "yesterday";
    return future ? `in ${days} days` : `${days} days ago`;
  }

  function findUpcomingSection() {
    return Array.from(document.querySelectorAll("h1,h2,h3,div,span"))
      .find(el => el.textContent?.trim().toUpperCase() === "UPCOMING BOOKINGS");
  }

  function updateRelativeTimes() {
    if (!window.location.pathname.startsWith("/portal")) return;
    const heading = findUpcomingSection();
    if (!heading) return;

    const section = heading.parentElement?.parentElement ?? heading.parentElement;
    if (!section) return;

    const candidates = Array.from(section.querySelectorAll("span,p,div"));
    for (const element of candidates) {
      if (element.hasAttribute(RELATIVE_ATTR)) continue;
      if (element.children.length > 0) continue;

      const date = parsePortalDate(element.textContent ?? "");
      if (!date) continue;

      let badge = element.nextElementSibling;
      if (!(badge instanceof HTMLElement) || !badge.hasAttribute(RELATIVE_ATTR)) {
        badge = document.createElement("span");
        badge.setAttribute(RELATIVE_ATTR, "true");
        badge.style.marginLeft = "8px";
        badge.style.padding = "2px 7px";
        badge.style.borderRadius = "9999px";
        badge.style.fontSize = "11px";
        badge.style.fontWeight = "600";
        badge.style.whiteSpace = "nowrap";
        badge.style.background = "rgba(14, 165, 233, 0.12)";
        badge.style.color = "rgb(56, 189, 248)";
        element.insertAdjacentElement("afterend", badge);
      }
      badge.textContent = formatRelative(date);
      badge.dataset.targetTime = date.toISOString();
    }

    document.querySelectorAll(`[${RELATIVE_ATTR}]`).forEach(node => {
      if (!(node instanceof HTMLElement) || !node.dataset.targetTime) return;
      const date = new Date(node.dataset.targetTime);
      if (!Number.isNaN(date.getTime())) node.textContent = formatRelative(date);
    });
  }

  const observer = new MutationObserver(() => updateRelativeTimes());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", updateRelativeTimes);
  window.addEventListener("load", updateRelativeTimes);
  setInterval(updateRelativeTimes, 60 * 1000);
  updateRelativeTimes();
})();
