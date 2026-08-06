(() => {
  const POLL_MS = 2000;
  const BADGE_ATTR = "data-ca-portal-activity-badge";
  const REVIEWED_PREFIX = "ca_portal_reviewed_calls_";
  const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  let busy = false;
  let companyId = 0;
  let currentCalls = [];

  const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.results)) return value.results;
    return [];
  };

  const digits = (value) => String(value ?? "").replace(/\D/g, "").slice(-10);
  const callId = (call) => String(call?.id ?? call?.twilioCallSid ?? call?.sid ?? "");
  const callTime = (call) => Date.parse(call?.createdAt ?? call?.startedAt ?? call?.date ?? "");

  async function getJson(url) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  }

  function reviewedKey() {
    return `${REVIEWED_PREFIX}${companyId || "unknown"}`;
  }

  function readReviewed() {
    try {
      return new Set(JSON.parse(localStorage.getItem(reviewedKey()) || "[]"));
    } catch {
      return new Set();
    }
  }

  function writeReviewed(values) {
    try {
      localStorage.setItem(reviewedKey(), JSON.stringify([...new Set(values)].slice(-500)));
    } catch {
      // Local storage may be disabled; the live badge still works for this page load.
    }
  }

  function markReviewed(id) {
    if (!id) return;
    const reviewed = readReviewed();
    reviewed.add(id);
    writeReviewed([...reviewed]);
    renderCallBadge();
  }

  function portalLink(path) {
    return [...document.querySelectorAll("a")].find((anchor) => {
      try {
        return new URL(anchor.href, location.origin).pathname === path;
      } catch {
        return false;
      }
    }) || null;
  }

  function setBadge(path, count, tone) {
    const link = portalLink(path);
    if (!link) return;

    let badge = link.querySelector(`[${BADGE_ATTR}="${path}"]`);
    if (count <= 0) {
      badge?.remove();
      link.style.removeProperty("color");
      link.style.removeProperty("background");
      link.style.removeProperty("border");
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute(BADGE_ATTR, path);
      badge.style.cssText = "margin-left:auto;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:9999px;font-size:10px;font-weight:800;line-height:1;flex-shrink:0";
      link.appendChild(badge);
    }

    const danger = tone === "danger";
    const rgb = danger ? "239,68,68" : "245,158,11";
    const text = danger ? "rgb(252,165,165)" : "rgb(253,230,138)";
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.style.background = `rgba(${rgb},.20)`;
    badge.style.border = `1px solid rgba(${rgb},.48)`;
    badge.style.color = text;
    link.style.color = text;
    link.style.background = `rgba(${rgb},.07)`;
    link.style.border = `1px solid rgba(${rgb},.20)`;
  }

  function unreviewedCalls() {
    const reviewed = readReviewed();
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    return currentCalls.filter((call) => {
      const id = callId(call);
      const created = callTime(call);
      return id && !reviewed.has(id) && (!Number.isFinite(created) || created >= cutoff);
    });
  }

  function renderCallBadge() {
    setBadge("/portal/calls", unreviewedCalls().length, "danger");
  }

  function bindVisibleCallRows() {
    if (location.pathname !== "/portal/calls") return;
    const rows = [...document.querySelectorAll("table tbody tr")];
    if (!rows.length) return;

    const sortedCalls = [...currentCalls].sort((a, b) => {
      const aTime = callTime(a);
      const bTime = callTime(b);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });

    rows.forEach((row, index) => {
      const id = callId(sortedCalls[index]);
      if (!id || row.dataset.caReviewBound === id) return;
      row.dataset.caReviewBound = id;
      row.addEventListener("click", () => markReviewed(id));
      row.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => markReviewed(id));
      });
    });
  }

  async function refresh() {
    if (busy || !location.pathname.startsWith("/portal")) return;
    busy = true;

    try {
      const numbers = asArray(await getJson("/api/phone-numbers"));
      companyId = Number(numbers.find((item) => Number(item?.companyId) > 0)?.companyId || 0);
      const companyNumbers = new Set(numbers.map((item) => digits(item?.number)).filter(Boolean));

      const callsPromise = getJson("/api/call-logs?limit=250").catch(() => []);
      const appointmentsPromise = companyId
        ? getJson(`/api/companies/${companyId}/appointments`).catch(() => [])
        : Promise.resolve([]);

      const [callsBody, appointmentsBody] = await Promise.all([callsPromise, appointmentsPromise]);
      currentCalls = asArray(callsBody).filter((call) => {
        if (companyId && Number(call?.companyId) === companyId) return true;
        return companyNumbers.has(digits(call?.toNumber)) || companyNumbers.has(digits(call?.fromNumber));
      });

      renderCallBadge();
      bindVisibleCallRows();

      const now = Date.now();
      const scheduledCount = asArray(appointmentsBody).filter((appointment) => {
        const status = String(appointment?.status ?? "").toLowerCase();
        const start = Date.parse(appointment?.startTime ?? "");
        return status === "scheduled" && Number.isFinite(start) && start >= now;
      }).length;
      setBadge("/portal/bookings", scheduledCount, "warning");
    } catch (error) {
      console.warn("CallingAgent portal activity refresh failed", error);
    } finally {
      busy = false;
    }
  }

  window.addEventListener("focus", refresh);
  window.addEventListener("popstate", () => setTimeout(refresh, 50));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  setInterval(refresh, POLL_MS);
  setTimeout(refresh, 250);
})();
