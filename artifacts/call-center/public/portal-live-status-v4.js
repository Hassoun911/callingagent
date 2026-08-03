(() => {
  const POLL_MS = 1000;
  const state = { companyId: 0, bookings: [], calls: [], phoneNumbers: new Set(), loading: false };

  const digits = (value) => String(value ?? "").replace(/\D/g, "").slice(-10);

  async function getJson(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.data)) return value.data;
    return [];
  }

  async function identifyCompany() {
    if (state.companyId) return true;
    const auth = await getJson("/api/auth/user").catch(() => null);
    const companyId = Number(auth?.user?.companyId);
    if (!Number.isInteger(companyId) || companyId <= 0) return false;
    state.companyId = companyId;

    const numbers = asArray(await getJson("/api/phone-numbers").catch(() => []));
    state.phoneNumbers = new Set(
      numbers
        .filter((number) => Number(number.companyId) === companyId)
        .map((number) => digits(number.number)),
    );
    return true;
  }

  function belongsToCompany(call) {
    if (Number(call.companyId) === state.companyId) return true;
    return state.phoneNumbers.has(digits(call.toNumber)) || state.phoneNumbers.has(digits(call.fromNumber));
  }

  function routeLink(path) {
    return document.querySelector(`a[href="${path}"]`);
  }

  function setBadge(path, count, tone) {
    const link = routeLink(path);
    if (!link) return;

    let badge = link.querySelector("[data-portal-route-badge]");
    if (count <= 0) {
      badge?.remove();
      link.style.removeProperty("color");
      link.style.removeProperty("background");
      link.style.removeProperty("border");
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute("data-portal-route-badge", "true");
      badge.style.cssText = "margin-left:auto;display:inline-flex;min-width:21px;height:21px;padding:0 6px;align-items:center;justify-content:center;border-radius:999px;font-size:11px;font-weight:800;line-height:1";
      link.appendChild(badge);
    }

    badge.textContent = count > 99 ? "99+" : String(count);
    const danger = tone === "danger";
    const rgb = danger ? "239,68,68" : "245,158,11";
    const text = danger ? "rgb(252,165,165)" : "rgb(253,230,138)";
    badge.style.background = `rgba(${rgb},.20)`;
    badge.style.border = `1px solid rgba(${rgb},.55)`;
    badge.style.color = text;
    link.style.color = text;
    link.style.background = `rgba(${rgb},.07)`;
    link.style.border = `1px solid rgba(${rgb},.25)`;
  }

  function render() {
    const now = Date.now();
    const scheduledCount = state.bookings.filter((booking) => {
      const status = String(booking.status || "").trim().toLowerCase();
      const start = Date.parse(booking.startTime);
      return status === "scheduled" && Number.isFinite(start) && start >= now;
    }).length;

    const callCount = state.calls.filter((call) => {
      const status = String(call.status || "").toLowerCase();
      const action = String(call.actionRequired || "").trim();
      const priority = String(call.priority || "").toLowerCase();
      const type = String(call.callType || "").toLowerCase();
      return status !== "in-progress" && (Boolean(action) || priority === "high" || type === "emergency" || ["failed", "busy", "no-answer"].includes(status));
    }).length;

    setBadge("/portal/bookings", scheduledCount, "warning");
    setBadge("/portal/calls", callCount, "danger");
  }

  async function refresh() {
    if (!location.pathname.startsWith("/portal") || state.loading) return;
    state.loading = true;
    try {
      if (!(await identifyCompany())) return;
      const [bookings, calls] = await Promise.all([
        getJson(`/api/companies/${state.companyId}/appointments`).catch(() => []),
        getJson("/api/call-logs?limit=250").catch(() => []),
      ]);
      state.bookings = asArray(bookings);
      state.calls = asArray(calls).filter(belongsToCompany);
      render();
    } finally {
      state.loading = false;
    }
  }

  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("popstate", () => setTimeout(refresh, 25));
  document.addEventListener("click", () => setTimeout(render, 50), true);

  setInterval(refresh, POLL_MS);
  setTimeout(refresh, 50);
})();
