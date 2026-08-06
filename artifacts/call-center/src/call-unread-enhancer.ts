const STORAGE_PREFIX = "callingagent:read-calls:v1:";
const INITIALIZED_PREFIX = "callingagent:read-calls-initialized:v1:";
const EVENT_NAME = "callingagent:call-read-state-changed";

type CallState = {
  read: string[];
  known: string[];
};

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

function loadState(id: string): CallState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(id)) || "null");
    return {
      read: Array.isArray(parsed?.read) ? parsed.read.map(String) : [],
      known: Array.isArray(parsed?.known) ? parsed.known.map(String) : [],
    };
  } catch {
    return { read: [], known: [] };
  }
}

function saveState(id: string, state: CallState): void {
  localStorage.setItem(storageKey(id), JSON.stringify({
    read: Array.from(new Set(state.read)).slice(-1000),
    known: Array.from(new Set(state.known)).slice(-1000),
  }));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { companyId: id } }));
}

function callSignature(row: HTMLElement): string {
  const cells = Array.from(row.querySelectorAll("td"));
  if (cells.length >= 6) {
    return cells.slice(0, 6).map(cell => cell.textContent?.trim() || "").join("|");
  }
  return (row.textContent || "").replace(/\s+/g, " ").trim();
}

function callRows(): HTMLElement[] {
  const desktop = Array.from(document.querySelectorAll<HTMLElement>("table tbody tr"))
    .filter(row => row.querySelectorAll("td").length >= 6 && !/no call logs found/i.test(row.textContent || ""));
  if (desktop.length) return desktop;

  return Array.from(document.querySelectorAll<HTMLElement>("main article"))
    .filter(card => /(?:in|out|recording|no recording)/i.test(card.textContent || ""));
}

function sidebarLink(id: string): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`a[href="/calls?companyId=${id}"]`);
}

function badgeHint(id: string): number {
  const link = sidebarLink(id);
  if (!link) return 0;
  const badges = Array.from(link.querySelectorAll("span"));
  const value = badges.map(node => Number((node.textContent || "").trim())).find(Number.isFinite);
  return value || 0;
}

function updateBadge(id: string, unread: number): void {
  const link = sidebarLink(id);
  if (!link) return;

  let badge = link.querySelector<HTMLElement>("[data-call-unread-badge]");
  const existingCandidates = Array.from(link.querySelectorAll<HTMLElement>("span"));
  const existing = existingCandidates.find(node => /^\d+\+?$/.test((node.textContent || "").trim()));

  if (!badge && existing) {
    badge = existing;
    badge.dataset.callUnreadBadge = "true";
  }

  if (unread <= 0) {
    badge?.remove();
    link.classList.remove("border", "border-red-500/20", "bg-red-500/5", "text-red-300");
    return;
  }

  if (!badge) {
    badge = document.createElement("span");
    badge.dataset.callUnreadBadge = "true";
    badge.className = "ml-auto inline-flex min-w-5 items-center justify-center rounded-full border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-red-300";
    link.appendChild(badge);
  }
  badge.textContent = unread > 99 ? "99+" : String(unread);
}

function markRead(id: string, signature: string): void {
  if (!signature) return;
  const state = loadState(id);
  if (!state.read.includes(signature)) state.read.push(signature);
  if (!state.known.includes(signature)) state.known.push(signature);
  saveState(id, state);
  apply();
}

function styleRow(row: HTMLElement, unread: boolean): void {
  row.dataset.callUnread = unread ? "true" : "false";
  row.classList.toggle("bg-cyan-500/[0.08]", unread);
  row.classList.toggle("border-l-2", unread);
  row.classList.toggle("border-l-cyan-400", unread);

  let marker = row.querySelector<HTMLElement>("[data-new-call-marker]");
  if (unread && !marker) {
    marker = document.createElement("span");
    marker.dataset.newCallMarker = "true";
    marker.textContent = "NEW";
    marker.className = "ml-2 inline-flex rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-cyan-300";
    const target = row.querySelector("td") || row.querySelector("h2")?.parentElement || row.firstElementChild;
    target?.appendChild(marker);
  }
  if (!unread) marker?.remove();
}

let applying = false;
function apply(): void {
  if (applying) return;
  const id = companyId();
  if (!id) return;
  const rows = callRows();
  if (!rows.length) return;

  applying = true;
  try {
    const state = loadState(id);
    const signatures = rows.map(callSignature).filter(Boolean);
    const initialized = localStorage.getItem(initializedKey(id)) === "true";

    if (!initialized) {
      const initialUnread = Math.min(badgeHint(id), signatures.length);
      state.known = Array.from(new Set([...state.known, ...signatures]));
      state.read = Array.from(new Set([...state.read, ...signatures.slice(initialUnread)]));
      localStorage.setItem(initializedKey(id), "true");
      saveState(id, state);
    } else {
      for (const signature of signatures) {
        if (!state.known.includes(signature)) state.known.push(signature);
      }
      saveState(id, state);
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
        row.addEventListener("click", event => {
          const target = event.target as HTMLElement;
          if (target.closest("button, a") || row.matches("article")) {
            markRead(id, callSignature(row));
            return;
          }
          markRead(id, callSignature(row));
        }, true);
      }
    });
    updateBadge(id, unread);
  } finally {
    applying = false;
  }
}

let timer: number | null = null;
function schedule(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    apply();
  }, 120);
}

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", schedule);
window.addEventListener("storage", schedule);
window.addEventListener(EVENT_NAME, schedule as EventListener);
window.addEventListener("focus", schedule);
schedule();
