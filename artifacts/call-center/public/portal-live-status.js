(() => {
  const POLL_MS = 3000;
  const state = {
    companyId: null,
    numberSet: new Set(),
    numberIdSet: new Set(),
    numbers: [],
    campaigns: [],
    calls: [],
    contacts: [],
    appointments: [],
    users: [],
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

  function markCollectionSeen(type, collection) {
    if (!state.companyId) return;
    const seen = readSeen(type);
    for (const item of collection || []) {
      if (item?.id != null) seen.add(String(item.id));
    }
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
    const allNumbers = await getJson("/api/phone-numbers").catch(() => []);
    const visibleNumbers = [...document.querySelectorAll("body *")]
      .map((node) => normalizePhone(node.textContent))
      .filter((value) => value.length === 10);
    const visibleSet = new Set(visibleNumbers);
    const own = allNumbers.filter((number) => visibleSet.has(normalizePhone(number.number)));
    const chosen = own[0] || (allNumbers.length === 1 ? allNumbers[0] : null);
    if (!chosen?.companyId) return;

    state.companyId = Number(chosen.companyId);
    state.numbers = allNumbers.filter((number) => Number(number.companyId) === state.companyId);
    state.numberSet = new Set(state.numbers.map((number) => normalizePhone(number.number)));
    state.numberIdSet = new Set(state.numbers.map((number) => Number(number.id)));
  }

  function belongsToCompany(call) {
    return state.numberSet.has(normalizePhone(call.toNumber)) || state.numberSet.has(normalizePhone(call.fromNumber));
  }

  function campaignBelongs(campaign) {
    const id = Number(campaign.fromPhoneNumberId ?? campaign.phoneNumberId ?? campaign.numberId);
    return state.numberIdSet.has(id) || Number(campaign.companyId) === state.companyId;
  }

  function contactBelongs(contact) {
    if (Number(contact.companyId) === state.companyId) return true;
    const line = normalizePhone(contact.phoneNumber ?? contact.lineNumber ?? contact.toNumber);
    return line && state.numberSet.has(line);
  }

  async function refresh() {
    if (!location.pathname.startsWith("/portal") || state.busy) return;
    state.busy = true;
    try {
      await resolveCompany();
      if (!state.companyId) return;

      const [allNumbers, campaigns, calls, contacts, appointments, users] = await Promise.all([
        getJson("/api/phone-numbers").catch(() => state.numbers),
        getJson("/api/campaigns").catch(() => []),
        getJson("/api/call-logs?limit=200").catch(() => []),
        getJson(`/api/contacts?companyId=${state.companyId}`).catch(() => []),
        getJson(`/api/companies/${state.companyId}/appointments`).catch(() => []),
        getJson(`/api/platform-users?companyId=${state.companyId}`).catch(() => []),
      ]);

      state.numbers = Array.isArray(allNumbers)
        ? allNumbers.filter((number) => Number(number.companyId) === state.companyId)
        : state.numbers;
      state.numberSet = new Set(state.numbers.map((number) => normalizePhone(number.number)));
      state.numberIdSet = new Set(state.numbers.map((number) => Number(number.id)));
      state.campaigns = Array.isArray(campaigns) ? campaigns.filter(campaignBelongs) : [];
      state.calls = Array.isArray(calls) ? calls.filter(belongsToCompany) : [];
      state.contacts = Array.isArray(contacts) ? contacts.filter(contactBelongs) : [];
      state.appointments = Array.isArray(appointments) ? appointments : [];
      state.users = Array.isArray(users) ? users : [];
      render();
    } finally {
      state.busy = false;
    }
  }

  function navLink(label) {
    return [...document.querySelectorAll("a")].find((anchor) => {
      const clone = anchor.cloneNode(true);
      clone.querySelectorAll?.("[data-live-status-badge]").forEach((node) => node.remove());
      return clone.textContent?.trim() === label;
    }) || null;
  }

  function setBadge(label, count, tone = "warning") {
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
    } else if (tone === "info") {
      badge.style.background = "rgba(14,165,233,.18)";
      badge.style.border = "1px solid rgba(14,165,233,.45)";
      badge.style.color = "rgb(125,211,252)";
      link.style.color = "rgb(125,211,252)";
    } else {
      badge.style.background = "rgba(245,158,11,.18)";
      badge.style.border = "1px solid rgba(245,158,11,.45)";
      badge.style.color = "rgb(253,230,138)";
      link.style.color = "rgb(253,230,138)";
    }
    link.setAttribute("data-live-alert", "true");
  }

  function unseenCount(type, collection, predicate = () => true) {
    const seen = readSeen(type);
    return (collection || []).filter((item) => item?.id != null && predicate(item) && !seen.has(String(item.id))).length;
  }

  function render() {
    if (!state.companyId) return;

    const callCount = unseenCount("calls", state.calls, (call) => {
      const status = String(call.status || "").toLowerCase();
      return status !== "in-progress";
    });

    const now = Date.now();
    const bookingCount = unseenCount("bookings", state.appointments, (appointment) => {
      const active = ["scheduled", "confirmed"].includes(String(appointment.status || "").toLowerCase());
      const future = Date.parse(appointment.startTime) >= now;
      return active && future;
    });

    setBadge("Phone Numbers", unseenCount("numbers", state.numbers), "info");
    setBadge("Campaigns", unseenCount("campaigns", state.campaigns), "info");
    setBadge("Call Logs", callCount, "danger");
    setBadge("Contacts", unseenCount("contacts", state.contacts), "info");
    setBadge("Bookings", bookingCount, "warning");
    setBadge("Users", unseenCount("users", state.users), "info");
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
    const clone = link.cloneNode(true);
    clone.querySelectorAll?.("[data-live-status-badge]").forEach((node) => node.remove());
    const label = clone.textContent?.trim();

    if (label === "Phone Numbers") markCollectionSeen("numbers", state.numbers);
    if (label === "Campaigns") markCollectionSeen("campaigns", state.campaigns);
    if (label === "Contacts") markCollectionSeen("contacts", state.contacts);
    if (label === "Bookings") markCollectionSeen("bookings", state.appointments);
    if (label === "Users") markCollectionSeen("users", state.users);
  }, true);

  window.addEventListener("callingagent:call-viewed", (event) => markSeen("calls", event.detail?.id));
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("popstate", () => setTimeout(refresh, 50));

  setInterval(refresh, POLL_MS);
  setTimeout(refresh, 100);
})();
