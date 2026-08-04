(() => {
  const CARD_ID = "booking-flow-settings-card";
  let lastPath = "";

  function numberIdFromPath() {
    const match = window.location.pathname.match(/^\/(?:portal\/)?numbers\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function styles() {
    if (document.getElementById("booking-flow-settings-style")) return;
    const style = document.createElement("style");
    style.id = "booking-flow-settings-style";
    style.textContent = `
      #${CARD_ID}{margin:18px 0;border:1px solid rgba(51,65,85,.8);background:#111a2e;border-radius:12px;padding:20px;color:#e5eefb}
      .bfs-title{font-size:16px;font-weight:700;margin:0 0 5px}.bfs-copy{font-size:13px;color:#9fb0c8;line-height:1.5;margin-bottom:16px}
      .bfs-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.bfs-option{display:block;border:1px solid #334155;border-radius:10px;padding:14px;cursor:pointer;background:#0b1324;transition:.15s}
      .bfs-option:hover{border-color:#0ea5e9}.bfs-option.active{border-color:#0ea5e9;background:rgba(14,165,233,.08);box-shadow:0 0 0 1px rgba(14,165,233,.3)}
      .bfs-option input{margin-right:8px}.bfs-name{font-size:14px;font-weight:700}.bfs-desc{display:block;font-size:12px;line-height:1.45;color:#94a3b8;margin:7px 0 0 24px}
      .bfs-actions{display:flex;align-items:center;gap:12px;margin-top:16px}.bfs-save{border:0;border-radius:7px;background:#0ea5e9;color:#04111d;font-weight:700;padding:10px 16px;cursor:pointer}.bfs-save:disabled{opacity:.55;cursor:wait}.bfs-status{font-size:12px;color:#94a3b8}.bfs-status.ok{color:#34d399}.bfs-status.err{color:#f87171}
      .bfs-note{margin-top:14px;border-left:3px solid #f59e0b;background:rgba(245,158,11,.07);padding:10px 12px;font-size:12px;line-height:1.5;color:#d7c5a3}
      @media(max-width:760px){.bfs-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "include", cache: "no-store", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }

  function insertionPoint() {
    const main = document.querySelector("main") || document.querySelector("[role='main']");
    if (!main) return null;
    const heading = Array.from(main.querySelectorAll("h1,h2")).find(el => /configure line behavior|phone line|routing mode/i.test(el.textContent || ""));
    const header = heading?.closest("header") || heading?.parentElement?.parentElement || main.firstElementChild;
    return header?.parentElement || main;
  }

  function setActive(card, mode) {
    card.querySelectorAll(".bfs-option").forEach(option => option.classList.toggle("active", option.dataset.mode === mode));
    const input = card.querySelector(`input[value='${mode}']`);
    if (input) input.checked = true;
  }

  async function mount() {
    styles();
    const id = numberIdFromPath();
    if (!id) { document.getElementById(CARD_ID)?.remove(); return; }
    if (document.getElementById(CARD_ID)) return;
    const point = insertionPoint();
    if (!point) return;

    const card = document.createElement("section");
    card.id = CARD_ID;
    card.innerHTML = `
      <h2 class="bfs-title">AI Appointment Conversation Flow</h2>
      <div class="bfs-copy">Choose how the AI starts the booking conversation for this phone number. This setting is controlled by the company admin and applies only to this line.</div>
      <div class="bfs-grid">
        <label class="bfs-option" data-mode="availability_first"><input type="radio" name="booking-flow" value="availability_first"><span class="bfs-name">Check availability first</span><span class="bfs-desc">The AI checks the calendar and offers available times before asking the caller to choose.</span></label>
        <label class="bfs-option" data-mode="caller_preference_first"><input type="radio" name="booking-flow" value="caller_preference_first"><span class="bfs-name">Ask caller's preferred time first</span><span class="bfs-desc">The AI asks which date and time the caller wants, checks that exact slot, then confirms it or offers another time.</span></label>
      </div>
      <div class="bfs-actions"><button type="button" class="bfs-save">Save booking flow</button><span class="bfs-status">Loading current setting…</span></div>
      <div class="bfs-note"><strong>Same-day requests:</strong> The AI will collect all details and tell the caller that someone from the team will confirm availability. It will not guarantee same-day service.</div>`;

    point.insertBefore(card, point.children[1] || null);
    card.addEventListener("change", event => {
      const input = event.target.closest("input[name='booking-flow']");
      if (input) setActive(card, input.value);
    });

    const status = card.querySelector(".bfs-status");
    try {
      const current = await api(`/api/phone-numbers/${id}/booking-flow`);
      setActive(card, current.mode || "caller_preference_first");
      status.textContent = "Current setting loaded";
    } catch (error) {
      status.textContent = error.message;
      status.className = "bfs-status err";
    }

    card.querySelector(".bfs-save").addEventListener("click", async event => {
      const button = event.currentTarget;
      const selected = card.querySelector("input[name='booking-flow']:checked")?.value;
      if (!selected) return;
      button.disabled = true;
      status.className = "bfs-status";
      status.textContent = "Saving…";
      try {
        await api(`/api/phone-numbers/${id}/booking-flow`, { method: "PATCH", body: JSON.stringify({ mode: selected }) });
        status.textContent = "Saved for this phone number";
        status.className = "bfs-status ok";
      } catch (error) {
        status.textContent = error.message;
        status.className = "bfs-status err";
      } finally {
        button.disabled = false;
      }
    });
  }

  function run() {
    const current = `${location.pathname}${location.search}`;
    if (current !== lastPath) {
      lastPath = current;
      document.getElementById(CARD_ID)?.remove();
    }
    mount();
  }

  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("popstate", run);
  setInterval(run, 1200);
  run();
})();
