const STORAGE_PREFIX = "callingagent:read-calls:v1:";
const INITIALIZED_PREFIX = "callingagent:read-calls-initialized:v1:";
const EVENT_NAME = "callingagent:call-read-state-changed";

type CallState = {
  read: string[];
  known: string[];
};

let applying = false;
let timer: number | null = null;
let observer: MutationObserver | null = null;

function companyId(): string | null {
  if (window.location.pathname !== "/calls") return null;
  return new URLSearchParams(window.location.search).get("companyId");
}

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}${id}`;
}

function initializedKey(id: string): string {
  return `${INITIALIZED_PREFIX}${id}`;
}

function normalizeState(state: CallState): CallState {
  return {
    read: Array.from(new Set(state.read.map(String))).slice(-1000),
    known: Array.from(new Set(state.known.map(String))).slice(-1000),
  };
}

function loadState(id: string): CallState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(id)) || "null");
    return normalizeState({
      read: Array.isArray(parsed?.read) ? parsed.read.map(String) : [],
      known: Array.isArray(parsed?.known) ? parsed.known.map(String) : [],
    });
  } catch {
    return { read: [], known: [] };
  }
}

function saveState(id: string, state: CallState): void {
  const normalized = normalizeState(state);
  const next = JSON.stringify(normalized);
  if (localStorage.getItem(storageKey(id)) === next) return;
  localStorage.setItem(storageKey(id), next);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { companyId: id } }));
}

function ensureStyles(): void {
  if (document.getElementById("call-unread-stable-style")) return;
  const style = document.createElement("style");
  style.id = "call-unread-stable-style";
  style.textContent = `
    body.call-unread-active a[data-call-unread-link="true"] > span.ml-auto { display:none !important; }
    body.call-unread-active a[data-call-unread-link="true"][data-call-unread-count]:not([data-call-unread-count="0"])::after {
      content: attr(data-call-unread-count);
      margin-left:auto;
      min-width:20px;
      height:20px;
      padding:0 6px;
      border-radius:999px;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      border:1px solid rgba(239,68,68,.45);
      background:rgba(239,68,68,.18);
      color:rgb(252,165,165);
      font-size:11px;
      font-weight:700;
      line-height:1;
      flex-shrink:0;
      box-sizing:border-box;
    }
    body.call-unread-active tr[data-call-unread="true"] { background:rgba(6,182,212,.08) !important; box-shadow:inset 2px 0 0 rgb(34,211,238); }
    body.call-unread-active article[data-call-unread="true"] { background:rgba(6,182,212,.08) !important; border-color:rgba(34,211,238,.38) !important; }
  `;
  document.head.appendChild(style);
}

function callRows(): HTMLElement[] {
  const desktop = Array.from(document.querySelectorAll<HTMLElement>("table tbody tr"))
    .filter(row => row.querySelectorAll("td").length >= 6 && !/no call logs found/i.test(row.textContent || ""));
  if (desktop.length) return desktop;

  return Array.from(document.querySelectorAll<HTMLElement>("main article"))
    .filter(card => /(?:in|out|recording|no recording)/i.test(card.textContent || ""));
}

function callSignature(row: HTMLElement): string {
  const cells = Array.from(row.querySelectorAll("td"));
  if (cells.length >= 6) {
    return cells.slice(0, 6).map(cell => {
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[data-new-call-marker]").forEach(node => node.remove());
      return clone.textContent?.replace(/\s+/g, " ").trim() || "";
    }).join("|");
  }
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-new-call-marker]").forEach(node => node.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function sidebarLink(id: string): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`a[href="/calls?companyId=${id}"]`);
}

function setUnreadBadge(id: string, unread: number): void {
  const link = sidebarLink(id);
  if (!link) return;
  link.dataset.callUnreadLink = "true";
  const value = unread > 99 ? "99+" : String(Math.max(0, unread));
  if (link.dataset.callUnreadCount !== value) link.dataset.callUnreadCount = value;
}

function styleRow(row: HTMLElement, unread: boolean): void {
  row.dataset.callUnread = unread ? "true" : "false";
  let marker = row.querySelector<HTMLElement>("[data-new-call-marker]");

  if (unread && !marker) {
    marker = document.createElement("span");
    marker.dataset.newCallMarker = "true";
    marker.textContent = "NEW";
    marker.className = "ml-2 inline-flex rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-cyan-300";
    const target = row.querySelector("td") || row.querySelector("h2")?.parentElement || row.firstElementChild;
    target?.appendChild(marker);
  } else if (!unread && marker) {
    marker.remove();
  }
}

function markRead(id: string, signature: string): void {
  if (!signature) return;
  const state = loadState(id);
  if (!state.read.includes(signature)) state.read.push(signature);
  if (!state.known.includes(signature)) state.known.push(signature);
  saveState(id, state);
  apply();
}

function apply(): void {
  if (applying) return;
  const id = companyId();

  if (!id) {
    document.body.classList.remove("call-unread-active");
    return;
  }

  ensureStyles();
  document.body.classList.add("call-unread-active");

  const rows = callRows();
  if (!rows.length) {
    setUnreadBadge(id, 0);
    return;
  }

  applying = true;
  observer?.disconnect();
  try {
    const state = loadState(id);
    const signatures = rows.map(callSignature).filter(Boolean);
    const initialized = localStorage.getItem(initializedKey(id)) === "true";

    if (!initialized) {
      // First install: existing calls are history, not a flood of fake NEW calls.
      state.known = Array.from(new Set([...state.known, ...signatures]));
      state.read = Array.from(new Set([...state.read, ...signatures]));
      localStorage.setItem(initializedKey(id), "true");
      saveState(id, state);
    } else {
      let changed = false;
      for (const signature of signatures) {
        if (!state.known.includes(signature)) {
          state.known.push(signature);
          changed = true;
        }
      }
      if (changed) saveState(id, state);
    }

    const refreshed = loadState(id);
    let unread = 0;

    rows.forEach(row => {
      const signature = callSignature(row);
      const isUnread = Boolean(signature) && !refreshed.read.includes(signature);
      if (isUnread) unread += 1;
      styleRow(row, isUnread);

      if (!row.dataset.callUnreadBound) {
        row.dataset.callUnreadBound = "true";
        row.addEventListener("click", () => {
          const currentId = companyId();
          if (currentId) markRead(currentId, callSignature(row));
        }, true);
      }
    });

    setUnreadBadge(id, unread);
  } finally {
    applying = false;
    observe();
  }
}

function schedule(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    apply();
  }, 100);
}

function observe(): void {
  if (!observer) observer = new MutationObserver(schedule);
  observer.disconnect();
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

window.addEventListener("popstate", schedule);
window.addEventListener("storage", schedule);
window.addEventListener(EVENT_NAME, schedule as EventListener);
window.addEventListener("focus", schedule);
document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });

observe();
schedule();
