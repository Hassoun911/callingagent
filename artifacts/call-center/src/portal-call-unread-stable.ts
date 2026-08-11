type AuthUser = {
  id?: string | number | null;
  companyId?: number | null;
  role?: string | null;
};

type CallLog = {
  id: number;
  createdAt?: string | null;
  direction?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  contactName?: string | null;
  callerIdName?: string | null;
  callerName?: string | null;
  callerEmail?: string | null;
  callType?: string | null;
  status?: string | null;
  duration?: number | null;
};

type StoredState = {
  initialized: boolean;
  known: string[];
  read: string[];
};

const PORTAL_CALLS = "/portal/calls";
const POLL_MS = 5000;
const DOM_MS = 500;
const RECENT_MS = 24 * 60 * 60 * 1000;
const MAX_IDS = 1500;

let authUser: AuthUser | null = null;
let calls: CallLog[] = [];
let fetching = false;
let destroyed = false;

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function callerName(call: CallLog): string {
  return [call.callerName, call.contactName, call.callerIdName]
    .find(value => value && value !== "null" && value !== "undefined") || "";
}

function storageKey(): string | null {
  if (!authUser?.companyId || authUser.id == null) return null;
  return `callingagent:portal-call-unread:v2:${authUser.companyId}:${authUser.id}`;
}

function loadState(): StoredState {
  const key = storageKey();
  if (!key) return { initialized: false, known: [], read: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return {
      initialized: parsed?.initialized === true,
      known: Array.isArray(parsed?.known) ? parsed.known.map(String).slice(-MAX_IDS) : [],
      read: Array.isArray(parsed?.read) ? parsed.read.map(String).slice(-MAX_IDS) : [],
    };
  } catch {
    return { initialized: false, known: [], read: [] };
  }
}

function saveState(state: StoredState): void {
  const key = storageKey();
  if (!key) return;
  const normalized: StoredState = {
    initialized: true,
    known: Array.from(new Set(state.known.map(String))).slice(-MAX_IDS),
    read: Array.from(new Set(state.read.map(String))).slice(-MAX_IDS),
  };
  try { localStorage.setItem(key, JSON.stringify(normalized)); } catch {}
  window.dispatchEvent(new CustomEvent("callingagent:portal-call-unread-changed", {
    detail: { companyId: authUser?.companyId, userId: authUser?.id },
  }));
}

function syncStateWithCalls(): StoredState {
  const state = loadState();
  const ids = calls.map(call => String(call.id));

  if (!state.initialized) {
    const cutoff = Date.now() - RECENT_MS;
    state.known = ids;
    state.read = calls
      .filter(call => {
        const at = call.createdAt ? Date.parse(call.createdAt) : 0;
        return !Number.isFinite(at) || at < cutoff;
      })
      .map(call => String(call.id));
    state.initialized = true;
    saveState(state);
    return loadState();
  }

  let changed = false;
  for (const id of ids) {
    if (!state.known.includes(id)) {
      state.known.push(id);
      changed = true;
    }
  }
  if (changed) saveState(state);
  return changed ? loadState() : state;
}

function unreadIds(): Set<string> {
  const state = syncStateWithCalls();
  const read = new Set(state.read);
  return new Set(calls.map(call => String(call.id)).filter(id => !read.has(id)));
}

function markRead(callId: number): void {
  const id = String(callId);
  const state = loadState();
  if (!state.known.includes(id)) state.known.push(id);
  if (!state.read.includes(id)) state.read.push(id);
  saveState(state);
  render();
}

async function ensureAuth(): Promise<boolean> {
  if (authUser?.companyId && authUser.id != null) return true;
  try {
    const response = await fetch("/api/auth/user", { credentials: "include", cache: "no-store" });
    if (!response.ok) return false;
    const body = await response.json();
    const user = body?.user as AuthUser | undefined;
    if (!user?.companyId || user.id == null || !["company_admin", "company_user"].includes(String(user.role))) return false;
    authUser = user;
    return true;
  } catch {
    return false;
  }
}

async function refreshCalls(): Promise<void> {
  if (fetching || destroyed) return;
  if (!(await ensureAuth())) return;
  fetching = true;
  try {
    const response = await fetch("/api/call-logs?limit=200", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = await response.json();
    calls = Array.isArray(body) ? body : [];
    syncStateWithCalls();
    render();
  } catch {
    // Keep the last stable unread state on transient failures.
  } finally {
    fetching = false;
  }
}

function portalCallLink(): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>('aside a[href="/portal/calls"]');
}

function ensurePortalBadge(unread: number): void {
  const link = portalCallLink();
  if (!link) return;

  const directSpans = Array.from(link.querySelectorAll<HTMLElement>(":scope > span"));
  const reactBadge = directSpans.find(span =>
    !span.dataset.portalUnreadBadge && /^\d+\+?$/.test((span.textContent || "").trim()),
  );
  if (reactBadge) {
    reactBadge.dataset.portalReactCallBadge = "true";
    reactBadge.style.setProperty("display", "none", "important");
  }

  let badge = link.querySelector<HTMLElement>("[data-portal-unread-badge]");
  if (unread <= 0) {
    badge?.remove();
    link.style.removeProperty("border-color");
    link.style.removeProperty("background");
    link.style.removeProperty("box-shadow");
    link.style.removeProperty("color");
    return;
  }

  if (!badge) {
    badge = document.createElement("span");
    badge.dataset.portalUnreadBadge = "true";
    badge.className = "ml-auto min-w-8 rounded-full bg-red-500 px-2.5 py-1 text-center text-[12px] font-black text-white ring-2 ring-red-300/20";
    link.appendChild(badge);
  }
  const label = unread > 99 ? "99+" : String(unread);
  if (badge.textContent !== label) badge.textContent = label;

  link.style.setProperty("border-color", "rgba(239,68,68,.55)", "important");
  link.style.setProperty("background", "rgba(239,68,68,.15)", "important");
  link.style.setProperty("box-shadow", "0 0 20px rgba(239,68,68,.14), inset 0 0 0 1px rgba(239,68,68,.08)", "important");
  link.style.setProperty("color", "rgb(254,226,226)", "important");
}

function selectedDirection(): string | null {
  const triggers = Array.from(document.querySelectorAll<HTMLElement>("main button"));
  const text = triggers.map(node => (node.textContent || "").trim());
  if (text.includes("Inbound")) return "inbound";
  if (text.includes("Outbound")) return "outbound";
  return null;
}

function selectedStatus(): string | null {
  const values = Array.from(document.querySelectorAll<HTMLElement>("main button"))
    .map(node => (node.textContent || "").trim().toLowerCase());
  if (values.includes("completed")) return "completed";
  if (values.includes("busy")) return "busy";
  if (values.includes("no answer")) return "no-answer";
  if (values.includes("failed")) return "failed";
  return null;
}

function visibleCalls(): CallLog[] {
  const direction = selectedDirection();
  const status = selectedStatus();
  const search = (document.querySelector<HTMLInputElement>('main input[placeholder="Search calls..."]')?.value || "").trim().toLowerCase();

  return calls.filter(call => {
    if (direction && String(call.direction || "").toLowerCase() !== direction) return false;
    if (status && String(call.status || "").toLowerCase() !== status) return false;
    if (!search) return true;
    return [call.fromNumber, call.toNumber, call.contactName, call.callerIdName, call.callerName, call.callerEmail, call.callType]
      .some(value => String(value ?? "").toLowerCase().includes(search));
  });
}

function callSignature(call: CallLog): string {
  return [
    formatDate(call.createdAt),
    normalizePhone(call.fromNumber),
    callerName(call) || normalizePhone(call.fromNumber),
    String(call.callType || ""),
    formatDuration(call.duration),
  ].join("|").toLowerCase();
}

function rowSignature(row: HTMLElement): string {
  const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>("td"));
  if (cells.length >= 6) {
    return [
      (cells[0].textContent || "").trim(),
      normalizePhone(cells[2].textContent),
      (cells[3].textContent || "").trim(),
      (cells[4].textContent || "").trim(),
      (cells[5].textContent || "").trim(),
    ].join("|").toLowerCase();
  }
  return "";
}

function styleDesktopRows(unread: Set<string>): void {
  if (location.pathname !== PORTAL_CALLS) return;
  const rows = Array.from(document.querySelectorAll<HTMLElement>("main table tbody tr"))
    .filter(row => row.querySelectorAll("td").length >= 6 && !/no call logs found/i.test(row.textContent || ""));
  if (!rows.length) return;

  const pool = visibleCalls();
  const bySignature = new Map<string, CallLog[]>();
  for (const call of pool) {
    const sig = callSignature(call);
    const list = bySignature.get(sig) || [];
    list.push(call);
    bySignature.set(sig, list);
  }

  rows.forEach((row, index) => {
    const sig = rowSignature(row);
    const matching = sig ? bySignature.get(sig) : undefined;
    const call = matching?.shift() || pool[index];
    if (!call) return;
    row.dataset.portalCallId = String(call.id);
    const isUnread = unread.has(String(call.id));
    row.classList.toggle("bg-cyan-500/[0.08]", isUnread);
    row.classList.toggle("border-l-2", isUnread);
    row.classList.toggle("border-l-cyan-400", isUnread);

    let marker = row.querySelector<HTMLElement>("[data-portal-new-call]");
    if (isUnread && !marker) {
      marker = document.createElement("span");
      marker.dataset.portalNewCall = "true";
      marker.textContent = "NEW";
      marker.className = "ml-2 inline-flex rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-cyan-300";
      row.querySelector("td")?.appendChild(marker);
    }
    if (!isUnread) marker?.remove();

    if (!row.dataset.portalReadBound) {
      row.dataset.portalReadBound = "true";
      row.addEventListener("click", () => {
        const id = Number(row.dataset.portalCallId);
        if (Number.isFinite(id)) markRead(id);
      }, true);
    }
  });
}

function styleMobileCards(unread: Set<string>): void {
  if (location.pathname !== PORTAL_CALLS) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>("main article"))
    .filter(card => /(?:recording|no recording)/i.test(card.textContent || ""));
  if (!cards.length) return;
  const pool = visibleCalls();

  cards.forEach((card, index) => {
    const call = pool[index];
    if (!call) return;
    card.dataset.portalCallId = String(call.id);
    const isUnread = unread.has(String(call.id));
    card.classList.toggle("border-cyan-400/60", isUnread);
    card.classList.toggle("bg-cyan-500/[0.08]", isUnread);

    let marker = card.querySelector<HTMLElement>("[data-portal-new-call]");
    if (isUnread && !marker) {
      marker = document.createElement("span");
      marker.dataset.portalNewCall = "true";
      marker.textContent = "NEW";
      marker.className = "ml-2 inline-flex rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-cyan-300";
      card.querySelector("h2")?.parentElement?.appendChild(marker);
    }
    if (!isUnread) marker?.remove();

    if (!card.dataset.portalReadBound) {
      card.dataset.portalReadBound = "true";
      card.addEventListener("click", () => {
        const id = Number(card.dataset.portalCallId);
        if (Number.isFinite(id)) markRead(id);
      }, true);
    }
  });
}

function render(): void {
  if (!authUser?.companyId || authUser.id == null) return;
  const unread = unreadIds();
  ensurePortalBadge(unread.size);
  styleDesktopRows(unread);
  styleMobileCards(unread);
}

async function start(): Promise<void> {
  if (!(await ensureAuth())) return;
  await refreshCalls();
  render();

  const fetchTimer = window.setInterval(() => {
    if (!document.hidden) void refreshCalls();
  }, POLL_MS);
  const domTimer = window.setInterval(() => {
    if (!document.hidden) render();
  }, DOM_MS);

  window.addEventListener("focus", () => void refreshCalls());
  window.addEventListener("popstate", render);
  window.addEventListener("callingagent:portal-call-unread-changed", render as EventListener);
  window.addEventListener("beforeunload", () => {
    destroyed = true;
    window.clearInterval(fetchTimer);
    window.clearInterval(domTimer);
  }, { once: true });
}

void start();

export {};
