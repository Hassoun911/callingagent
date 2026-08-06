(() => {
  const POLL_MS = 2000;
  const BADGE_ATTR = "data-ca-portal-activity-badge";
  let busy = false;

  const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.results)) return value.results;
    return [];
  };

  const digits = (value) => String(value ?? "").replace(/\D/g, "").slice(-10);

  async function getJson(url) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
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

  async function refresh() {
    if (busy || !location.pathname.startsWith("/portal")) return;
    busy = true;

    try {
      // Portal APIs are tenant-filtered. Use the assigned line itself as the
      // authoritative company context instead of the platform auth endpoint.
      const numbers = asArray(await getJson("/api/phone-numbers"));
      const companyId = Number(numbers.find((item) => Number(item?.companyId) > 0)?.companyId || 0);
      const companyNumbers = new Set(numbers.map((item) => digits(item?.number)).filter(Boolean));

      const callsPromise = getJson("/api/call-logs?limit=250").catch(() => []);
      const appointmentsPromise = companyId
        ? getJson(`/api/companies/${companyId}/appointments`).catch(() => [])
        : Promise.resolve([]);

      const [callsBody, appointmentsBody] = await Promise.all([callsPromise, appointmentsPromise]);
      const calls = asArray(callsBody).filter((call) => {
        if (companyId && Number(call?.companyId) === companyId) return true;
        return companyNumbers.has(digits(call?.toNumber)) || companyNumbers.has(digits(call?.fromNumber));
      });

      // Match the master dashboard rule: calls needing attention stay visible,
      // including incomplete booking calls and emergency/high-priority calls.
      const callActionCount = calls.filter((call) => {
        const action = String(call?.actionRequired ?? "").trim();
        const priority = String(call?.priority ?? "").toLowerCase();
        const type = String(call?.callType ?? "").toLowerCase();
        const status = String(call?.status ?? "").toLowerCase();
        return Boolean(action) || priority === "high" || type === "emergency" || ["failed", "busy", "no-answer", "canceled"].includes(status);
      }).length;

      const now = Date.now();
      const scheduledCount = asArray(appointmentsBody).filter((appointment) => {
        const status = String(appointment?.status ?? "").toLowerCase();
        const start = Date.parse(appointment?.startTime ?? "");
        return status === "scheduled" && Number.isFinite(start) && start >= now;
      }).length;

      setBadge("/portal/calls", callActionCount, "danger");
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
