(() => {
  const BADGE_ID = "ca-portal-live-call-badge";
  const STORAGE_PREFIX = "ca_seen_portal_calls_";
  let companyId = null;
  let currentCallIds = [];
  let running = false;

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.results)) return value.results;
    return [];
  }

  async function json(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  }

  function callLink() {
    return document.querySelector('a[href="/portal/calls"], a[href^="/portal/calls?"]');
  }

  function seenKey() {
    return `${STORAGE_PREFIX}${companyId || "unknown"}`;
  }

  function readSeen() {
    try {
      return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]"));
    } catch {
      return new Set();
    }
  }

  function writeSeen(ids) {
    localStorage.setItem(seenKey(), JSON.stringify([...new Set(ids)].slice(-300)));
  }

  function removeBadge() {
    document.getElementById(BADGE_ID)?.remove();
  }

  function render(count) {
    const link = callLink();
    if (!link || count <= 0) {
      removeBadge();
      return;
    }

    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement("span");
      badge.id = BADGE_ID;
      Object.assign(badge.style, {
        marginLeft: "auto",
        minWidth: "20px",
        height: "20px",
        padding: "0 6px",
        borderRadius: "9999px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(239,68,68,.18)",
        border: "1px solid rgba(239,68,68,.42)",
        color: "rgb(252,165,165)",
        fontSize: "10px",
        fontWeight: "700",
        lineHeight: "1",
      });
      link.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
    link.style.color = "rgb(252,165,165)";
    link.style.background = "rgba(239,68,68,.07)";
  }

  function installClickHandler() {
    const link = callLink();
    if (!link || link.dataset.caLiveCallHandler === "true") return;
    link.dataset.caLiveCallHandler = "true";
    link.addEventListener("click", () => {
      writeSeen([...readSeen(), ...currentCallIds]);
      removeBadge();
    });
  }

  async function resolveCompanyId() {
    const user = await json("/api/auth/user");
    const id = Number(user?.companyId ?? user?.company?.id ?? user?.user?.companyId);
    companyId = Number.isFinite(id) && id > 0 ? id : null;
  }

  async function refresh() {
    if (running || !window.location.pathname.startsWith("/portal")) return;
    running = true;
    try {
      if (!companyId) await resolveCompanyId();
      installClickHandler();
      if (!companyId) return;

      const [numbersBody, callsBody] = await Promise.all([
        json("/api/phone-numbers"),
        json("/api/call-logs?limit=200"),
      ]);
      const numbers = asArray(numbersBody).filter(number => Number(number.companyId) === companyId);
      const lineNumbers = new Set(numbers.map(number => String(number.number || "")));
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const calls = asArray(callsBody).filter(call => {
        const belongs = Number(call.companyId) === companyId || lineNumbers.has(String(call.toNumber || ""));
        const created = Date.parse(call.createdAt || call.startedAt || call.date || "");
        return belongs && (!Number.isFinite(created) || created >= cutoff);
      });

      currentCallIds = calls.map(call => String(call.id ?? call.twilioCallSid ?? call.sid)).filter(Boolean);
      const seen = readSeen();
      render(currentCallIds.filter(id => !seen.has(id)).length);
    } catch (error) {
      console.warn("CallingAgent live call alert refresh failed", error);
    } finally {
      running = false;
    }
  }

  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  setInterval(refresh, 2000);
  setTimeout(refresh, 300);
})();
