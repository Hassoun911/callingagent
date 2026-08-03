(() => {
  const POLL_MS = 1000;
  let companyId = 0;
  let scheduledCount = 0;
  let callCount = 0;
  let busy = false;

  const asArray = (value) => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : [];
  const digits = (value) => String(value ?? "").replace(/\D/g, "").slice(-10);

  async function getJson(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function findPortalLink(path) {
    return [...document.querySelectorAll("a")].find((a) => {
      try {
        const url = new URL(a.href, location.origin);
        return url.pathname === path;
      } catch {
        return false;
      }
    }) || null;
  }

  function setBadge(path, count, tone) {
    const link = findPortalLink(path);
    if (!link) return;

    let badge = link.querySelector("[data-ca-sidebar-status-v5]");
    if (count <= 0) {
      badge?.remove();
      link.style.removeProperty("color");
      link.style.removeProperty("background");
      link.style.removeProperty("border");
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute("data-ca-sidebar-status-v5", "true");
      badge.style.cssText = "margin-left:auto;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;font-size:11px;font-weight:800;line-height:1;flex-shrink:0";
      link.appendChild(badge);
    }

    badge.textContent = count > 99 ? "99+" : String(count);
    const danger = tone === "danger";
    const rgb = danger ? "239,68,68" : "245,158,11";
    const text = danger ? "rgb(252,165,165)" : "rgb(253,230,138)";
    badge.style.background = `rgba(${rgb},.22)`;
    badge.style.border = `1px solid rgba(${rgb},.55)`;
    badge.style.color = text;
    link.style.color = text;
    link.style.background = `rgba(${rgb},.08)`;
    link.style.border = `1px solid rgba(${rgb},.22)`;
  }

  function fallbackScheduledFromPage() {
    return [...document.querySelectorAll("body *")].filter((node) => {
      if (node.children.length) return false;
      return node.textContent?.trim().toLowerCase() === "scheduled";
    }).length;
  }

  function render() {
    if (!location.pathname.startsWith("/portal")) return;
    setBadge("/portal/bookings", scheduledCount || fallbackScheduledFromPage(), "warning");
    setBadge("/portal/calls", callCount, "danger");
  }

  async function identifyCompany() {
    if (companyId) return true;
    const auth = await getJson("/api/auth/user");
    companyId = Number(auth?.user?.companyId || 0);
    return companyId > 0;
  }

  async function refresh() {
    if (!location.pathname.startsWith("/portal") || busy) return;
    busy = true;
    try {
      if (!(await identifyCompany())) return;
      const [appointmentsResult, numbersResult, callsResult] = await Promise.all([
        getJson(`/api/companies/${companyId}/appointments`).catch(() => []),
        getJson("/api/phone-numbers").catch(() => []),
        getJson("/api/call-logs?limit=250").catch(() => []),
      ]);

      const now = Date.now();
      scheduledCount = asArray(appointmentsResult).filter((item) => {
        const status = String(item.status || "").toLowerCase();
        const start = Date.parse(item.startTime);
        return status === "scheduled" && Number.isFinite(start) && start >= now;
      }).length;

      const companyNumbers = new Set(asArray(numbersResult)
        .filter((item) => Number(item.companyId) === companyId)
        .map((item) => digits(item.number)));

      callCount = asArray(callsResult).filter((call) => {
        const belongs = Number(call.companyId) === companyId || companyNumbers.has(digits(call.toNumber)) || companyNumbers.has(digits(call.fromNumber));
        if (!belongs) return false;
        const action = String(call.actionRequired || "").trim();
        const priority = String(call.priority || "").toLowerCase();
        const type = String(call.callType || "").toLowerCase();
        const status = String(call.status || "").toLowerCase();
        return Boolean(action) || priority === "high" || type === "emergency" || ["failed", "busy", "no-answer"].includes(status);
      }).length;

      render();
    } catch {
      render();
    } finally {
      busy = false;
    }
  }

  const observer = new MutationObserver(() => render());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("popstate", () => setTimeout(refresh, 25));
  setInterval(refresh, POLL_MS);
  setTimeout(refresh, 50);
})();
