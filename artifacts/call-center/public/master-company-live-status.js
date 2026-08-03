(() => {
  const POLL_MS = 1000;
  const state = {
    companyId: null,
    numbers: new Set(),
    calls: [],
    appointments: [],
    messages: [],
    busy: false,
  };

  const normalizePhone = value => String(value || "").replace(/\D/g, "").slice(-10);
  const key = type => `callingagent:master-company:${state.companyId || "unknown"}:${type}:seen:v1`;

  function readSeen(type) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key(type)) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function writeSeen(type, values) {
    try { localStorage.setItem(key(type), JSON.stringify([...values])); } catch {}
  }

  function markSeen(type, id) {
    if (id == null || !state.companyId) return;
    const seen = readSeen(type);
    seen.add(String(id));
    writeSeen(type, seen);
    render();
  }

  async function getJson(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function companyFromLocation() {
    const queryId = Number(new URLSearchParams(location.search).get("companyId"));
    if (Number.isFinite(queryId) && queryId > 0) return queryId;
    const companyMatch = location.pathname.match(/^\/companies\/(\d+)/);
    if (companyMatch) return Number(companyMatch[1]);
    return null;
  }

  async function resolveCompany() {
    const direct = companyFromLocation();
    if (direct) {
      if (state.companyId !== direct) {
        state.companyId = direct;
        state.numbers = new Set();
      }
    } else {
      const numberMatch = location.pathname.match(/^\/numbers\/(\d+)/);
      if (!numberMatch) {
        state.companyId = null;
        state.numbers = new Set();
        return;
      }
      const allNumbers = await getJson("/api/phone-numbers").catch(() => []);
      const selected = (Array.isArray(allNumbers) ? allNumbers : []).find(item => Number(item.id) === Number(numberMatch[1]));
      state.companyId = selected?.companyId ? Number(selected.companyId) : null;
    }

    if (!state.companyId) return;
    const allNumbers = await getJson("/api/phone-numbers").catch(() => []);
    state.numbers = new Set(
      (Array.isArray(allNumbers) ? allNumbers : [])
        .filter(item => Number(item.companyId) === state.companyId)
        .map(item => normalizePhone(item.number)),
    );
  }

  function belongsToCompany(record) {
    const candidates = [record.toNumber, record.fromNumber, record.lineNumber, record.to, record.from]
      .map(normalizePhone)
      .filter(Boolean);
    return candidates.some(number => state.numbers.has(number));
  }

  function listFrom(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.data)) return value.data;
    return [];
  }

  function cleanLabel(link) {
    const clone = link.cloneNode(true);
    clone.querySelectorAll("[data-master-live-badge], .ml-auto").forEach(node => node.remove());
    return clone.textContent?.replace(/\s+/g, " ").trim() || "";
  }

  function findNavLink(labels) {
    const wanted = Array.isArray(labels) ? labels : [labels];
    return [...document.querySelectorAll("aside a")].find(link => wanted.includes(cleanLabel(link))) || null;
  }

  function setBadge(labels, count, tone) {
    const link = findNavLink(labels);
    if (!link) return;

    const reactBadge = link.querySelector("span.ml-auto");
    let badge = link.querySelector("[data-master-live-badge]") || reactBadge;

    if (count <= 0) {
      badge?.remove();
      link.style.removeProperty("color");
      link.style.removeProperty("border-color");
      link.style.removeProperty("background-color");
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      link.appendChild(badge);
    }
    badge.setAttribute("data-master-live-badge", "true");
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.style.cssText = "margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;line-height:1;flex-shrink:0;";

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
  }

  function isActionCall(call) {
    const status = String(call.status || "").toLowerCase();
    const priority = String(call.priority || "").toLowerCase();
    const type = String(call.callType || "").toLowerCase();
    const action = String(call.actionRequired || "").trim();
    return status !== "in-progress" && (
      Boolean(action) || priority === "high" || type === "emergency" || ["failed", "busy", "no-answer"].includes(status)
    );
  }

  function render() {
    if (!state.companyId) return;
    const callSeen = readSeen("calls");
    const bookingSeen = readSeen("appointments");
    const messageSeen = readSeen("messages");

    const callCount = state.calls.filter(call => isActionCall(call) && !callSeen.has(String(call.id))).length;
    const now = Date.now();
    const appointmentCount = state.appointments.filter(item => {
      const status = String(item.status || "").toLowerCase();
      const future = Date.parse(item.startTime) >= now;
      return future && ["scheduled", "confirmed"].includes(status) && !bookingSeen.has(String(item.id));
    }).length;
    const messageCount = state.messages.filter(message => {
      const inbound = String(message.direction || "").toLowerCase() === "inbound";
      const unread = message.unread === true || Number(message.unread || 0) > 0 || String(message.status || "").toLowerCase() === "unread";
      return inbound && unread && !messageSeen.has(String(message.id));
    }).length;

    setBadge("Call Logs", callCount, "danger");
    setBadge(["Appointments", "Bookings"], appointmentCount, "warning");
    setBadge("Messages", messageCount, "danger");
  }

  async function refresh() {
    if (location.pathname.startsWith("/portal") || state.busy) return;
    state.busy = true;
    try {
      await resolveCompany();
      if (!state.companyId) return;
      const [callsResult, appointmentsResult, messagesResult] = await Promise.all([
        getJson("/api/call-logs?limit=300").catch(() => []),
        getJson(`/api/companies/${state.companyId}/appointments`).catch(() => []),
        getJson("/api/sms-messages?limit=500").catch(() => []),
      ]);
      state.calls = listFrom(callsResult).filter(belongsToCompany);
      state.appointments = listFrom(appointmentsResult);
      state.messages = listFrom(messagesResult).filter(belongsToCompany);
      render();
    } finally {
      state.busy = false;
    }
  }

  function markAllAppointmentsSeen() {
    if (!state.companyId) return;
    const seen = readSeen("appointments");
    state.appointments.forEach(item => seen.add(String(item.id)));
    writeSeen("appointments", seen);
    render();
  }

  function markAllMessagesSeen() {
    if (!state.companyId) return;
    const seen = readSeen("messages");
    state.messages.forEach(item => seen.add(String(item.id)));
    writeSeen("messages", seen);
    render();
  }

  function callIdFromRecording(source) {
    return String(source || "").match(/\/api\/call-logs\/(\d+)\/recording/)?.[1] || null;
  }

  const originalPlay = HTMLMediaElement.prototype.play;
  if (!HTMLMediaElement.prototype.__callingAgentMasterLivePatched) {
    Object.defineProperty(HTMLMediaElement.prototype, "__callingAgentMasterLivePatched", { value: true });
    HTMLMediaElement.prototype.play = function (...args) {
      const id = callIdFromRecording(this.currentSrc || this.src);
      if (id) markSeen("calls", id);
      return originalPlay.apply(this, args);
    };
  }

  document.addEventListener("click", event => {
    const link = event.target.closest?.("a");
    if (link) {
      const label = cleanLabel(link);
      if (label === "Appointments" || label === "Bookings") markAllAppointmentsSeen();
      if (label === "Messages") markAllMessagesSeen();
    }
  }, true);

  window.addEventListener("callingagent:call-viewed", event => markSeen("calls", event.detail?.id));
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("popstate", () => setTimeout(refresh, 20));
  setInterval(refresh, POLL_MS);
  setTimeout(refresh, 50);
})();
