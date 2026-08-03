(() => {
  const POLL_MS = 3000;
  const state = {
    companyId: null,
    numberSet: new Set(),
    calls: [],
    appointments: [],
    busy: false,
  };

  const storageKey = (type) => `callingagent:portal:${state.companyId || "unknown"}:${type}:seen`;

  function readSeen(type) {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(type)) || "[]");
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function writeSeen(type, values) {
    try {
      localStorage.setItem(storageKey(type), JSON.stringify([...values]));
    } catch {}
  }

  function markSeen(type, id) {
    if (id == null) return;
    const seen = readSeen(type);
    seen.add(String(id));
    writeSeen(type, seen);
    render();
  }

  async function getJson(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }

  function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "").slice(-10);
  }

  async function resolveCompany() {
    if (state.companyId) return;
    const numbers = await getJson("/api/phone-numbers").catch(() => []);
    const visibleNumbers = [...document.querySelectorAll("body *")]
      .map((node) => normalizePhone(node.textContent))
      .filter((value) => value.length === 10);
    const visibleSet = new Set(visibleNumbers);
    const own = numbers.filter((number) => visibleSet.has(normalizePhone(number.number)));
    const chosen = own[0] || (numbers.length === 1 ? numbers[0] : null);
    if (!chosen?.companyId) return;
    state.companyId = Number(chosen.companyId);
    state.numberSet = new Set(numbers.filter((number) => Number(number.companyId) === state.companyId).map((number) => normalizePhone(number.number)));
  }

  function belongsToCompany(call) {
    return state.numberSet.has(normalizePhone(call.toNumber)) || state.numberSet.has(normalizePhone(call.fromNumber));
  }

  async function refresh() {
    if (!location.pathname.startsWith("/portal") || state.busy) return;
    state.busy = true;
    try {
      await resolveCompany();
      if (!state.companyId) return;
      const [calls, appointments] = await Promise.all([
        getJson("/api/call-logs?limit=200").catch(() => []),
        getJson(`/api/companies/${state.companyId}/appointments`).catch(() => []),
      ]);
      state.calls = Array.isArray(calls) ? calls.filter(belongsToCompany) : [];
      state.appointments = Array.isArray(appointments) ? appointments : [];
      render();
    } finally {
      state.busy = false;
    }
  }

  function navLink(label) {
    return [...document.querySelectorAll("a")].find((anchor) => anchor.textContent?.trim().replace(/\d+$/, "").trim() === label) || null;
  }

  function setBadge(label, count, tone) {
    const link = navLink(label);
    if (!link) return;
    let badge = link.querySelector("[data-live-status-badge]");
    if (count <= 0) {
      badge?.remove();
      link.removeAttribute("data-live-alert");
      link.style.removeProperty("color");
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute("data-live-status-badge", "true");
      badge.style.cssText = "margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;line-height:1;";
      link.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
    if (tone === "danger") {
      badge.style.background = "rgba(239,68,68,.18)";
      badge.style.border = "1px solid rgba(239,68,68,.45)";
      badge.style.color = "rgb(252,165,165)";
      link.style.color = "rgb(252,165,165)";
    } else {
      badge.style.background = "rgba(245,158,11,.18)";
      badge.style.border = "1px solid rgba(245,158,11,.45)";
      badge.style.color = "rgb(253,230,138)";
      link.style.color = "rgb(253,230,138)";
    }
    link.setAttribute("data-live-alert", "true");
  }

  function render() {
    if (!state.companyId) return;
    const callSeen = readSeen("calls");
    const bookingSeen = readSeen("bookings");

    const callCount = state.calls.filter((call) => {
      const status = String(call.status || "").toLowerCase();
      return !callSeen.has(String(call.id)) && status !== "in-progress";
    }).length;

    const now = Date.now();
    const bookingCount = state.appointments.filter((appointment) => {
      const active = ["scheduled", "confirmed"].includes(String(appointment.status || "").toLowerCase());
      const future = Date.parse(appointment.startTime) >= now;
      return active && future && !bookingSeen.has(String(appointment.id));
    }).length;

    setBadge("Call Logs", callCount, "danger");
    setBadge("Bookings", bookingCount, "warning");
  }

  function markCurrentBookingsSeen() {
    if (!state.companyId) return;
    const seen = readSeen("bookings");
    for (const appointment of state.appointments) seen.add(String(appointment.id));
    writeSeen("bookings", seen);
    render();
  }

  const originalPlay = HTMLMediaElement.prototype.play;
  if (!HTMLMediaElement.prototype.__callingAgentLivePatched) {
    Object.defineProperty(HTMLMediaElement.prototype, "__callingAgentLivePatched", { value: true });
    HTMLMediaElement.prototype.play = function (...args) {
      const source = String(this.currentSrc || this.src || "");
      const match = source.match(/\/api\/call-logs\/(\d+)\/recording/);
      if (match) {
        markSeen("calls", match[1]);
        window.dispatchEvent(new CustomEvent("callingagent:call-viewed", { detail: { id: Number(match[1]) } }));
      }
      return originalPlay.apply(this, args);
    };
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a");
    if (!link) return;
    const label = link.textContent?.replace(/\d+$/, "").trim();
    if (label === "Bookings") markCurrentBookingsSeen();
  }, true);

  window.addEventListener("callingagent:call-viewed", (event) => markSeen("calls", event.detail?.id));
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("popstate", () => setTimeout(refresh, 50));

  setInterval(refresh, POLL_MS);
  setTimeout(refresh, 100);
})();
