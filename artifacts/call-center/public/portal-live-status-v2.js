(() => {
  const POLL_MS = 1000;
  const VERSION = "v3";
  const state = { companyId: 0, phoneNumbers: new Set(), calls: [], bookings: [], loading: false };

  const digits = (value) => String(value ?? "").replace(/\D/g, "").slice(-10);
  const key = (type) => `callingagent:${VERSION}:company:${state.companyId}:${type}:seen`;

  function readSeen(type) {
    try {
      const data = JSON.parse(localStorage.getItem(key(type)) || "[]");
      return new Set(Array.isArray(data) ? data.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function saveSeen(type, set) {
    try { localStorage.setItem(key(type), JSON.stringify([...set])); } catch {}
  }

  function markSeen(type, id) {
    if (!state.companyId || id == null) return;
    const seen = readSeen(type);
    seen.add(String(id));
    saveSeen(type, seen);
    render();
  }

  async function json(url) {
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
    const auth = await json("/api/auth/user").catch(() => null);
    const id = Number(auth?.user?.companyId);
    if (!Number.isInteger(id) || id <= 0) return false;
    state.companyId = id;

    const numbers = asArray(await json("/api/phone-numbers").catch(() => []));
    state.phoneNumbers = new Set(
      numbers.filter((item) => Number(item.companyId) === id).map((item) => digits(item.number)),
    );
    return true;
  }

  function companyCall(call) {
    if (Number(call.companyId) === state.companyId) return true;
    return state.phoneNumbers.has(digits(call.toNumber)) || state.phoneNumbers.has(digits(call.fromNumber));
  }

  function findNav(label) {
    return [...document.querySelectorAll("a")].find((link) => {
      const clone = link.cloneNode(true);
      clone.querySelectorAll?.("[data-portal-live-badge]").forEach((node) => node.remove());
      return clone.textContent?.trim() === label;
    }) || null;
  }

  function badge(label, count, danger) {
    const link = findNav(label);
    if (!link) return;
    let node = link.querySelector("[data-portal-live-badge]");
    if (count <= 0) {
      node?.remove();
      link.style.removeProperty("color");
      link.style.removeProperty("border-color");
      link.style.removeProperty("background");
      return;
    }
    if (!node) {
      node = document.createElement("span");
      node.dataset.portalLiveBadge = "true";
      node.style.cssText = "margin-left:auto;display:inline-flex;min-width:21px;height:21px;padding:0 6px;align-items:center;justify-content:center;border-radius:999px;font-size:11px;font-weight:800;line-height:1";
      link.appendChild(node);
    }
    node.textContent = count > 99 ? "99+" : String(count);
    const rgb = danger ? "239,68,68" : "245,158,11";
    const text = danger ? "rgb(252,165,165)" : "rgb(253,230,138)";
    node.style.background = `rgba(${rgb},.2)`;
    node.style.border = `1px solid rgba(${rgb},.5)`;
    node.style.color = text;
    link.style.color = text;
    link.style.background = `rgba(${rgb},.06)`;
  }

  function render() {
    if (!state.companyId) return;
    const seenCalls = readSeen("calls");
    const now = Date.now();

    const callCount = state.calls.filter((call) => {
      const status = String(call.status || "").toLowerCase();
      return status !== "in-progress" && !seenCalls.has(String(call.id));
    }).length;

    // A scheduled future appointment is unresolved work. It stays highlighted
    // until its status changes to confirmed, cancelled, no_show, or completed.
    const bookingCount = state.bookings.filter((item) => {
      const status = String(item.status || "").toLowerCase();
      const start = Date.parse(item.startTime);
      return status === "scheduled" && Number.isFinite(start) && start >= now;
    }).length;

    badge("Call Logs", callCount, true);
    badge("Bookings", bookingCount, false);
  }

  async function refresh() {
    if (!location.pathname.startsWith("/portal") || state.loading) return;
    state.loading = true;
    try {
      if (!(await identifyCompany())) return;
      const [calls, bookings] = await Promise.all([
        json("/api/call-logs?limit=250").catch(() => []),
        json(`/api/companies/${state.companyId}/appointments`).catch(() => []),
      ]);
      state.calls = asArray(calls).filter(companyCall);
      state.bookings = asArray(bookings);
      render();
    } finally {
      state.loading = false;
    }
  }

  const nativePlay = HTMLMediaElement.prototype.play;
  if (!HTMLMediaElement.prototype.__callingAgentPortalV3) {
    Object.defineProperty(HTMLMediaElement.prototype, "__callingAgentPortalV3", { value: true });
    HTMLMediaElement.prototype.play = function (...args) {
      const match = String(this.currentSrc || this.src || "").match(/\/api\/call-logs\/(\d+)\/recording/);
      if (match) markSeen("calls", match[1]);
      return nativePlay.apply(this, args);
    };
  }

  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("popstate", () => setTimeout(refresh, 25));
  setInterval(refresh, POLL_MS);
  setTimeout(refresh, 100);
})();
