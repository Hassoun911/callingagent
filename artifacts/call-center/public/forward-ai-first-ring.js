(() => {
  const OPTION_ID = "ca-ai-after-first-ring";
  const STYLE_ID = "ca-ai-after-first-ring-style";
  let attempts = 0;

  function numberIdFromPath() {
    const match = window.location.pathname.match(/(?:^|\/)numbers\/(\d+)(?:\/|$)/);
    return match ? Number(match[1]) : null;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OPTION_ID}{width:100%;display:flex;align-items:flex-start;gap:14px;padding:16px;border:1px solid rgba(51,65,85,.75);border-radius:6px;background:rgba(2,6,23,.45);color:rgb(148,163,184);text-align:left;cursor:pointer;transition:.15s ease}
      #${OPTION_ID}:hover{border-color:rgba(14,165,233,.65);background:rgba(14,165,233,.06);color:rgb(226,232,240)}
      #${OPTION_ID}[data-saving="true"]{opacity:.65;cursor:wait}
      #${OPTION_ID} .ca-radio{width:20px;height:20px;flex:0 0 20px;border-radius:999px;border:2px solid rgb(100,116,139);margin-top:1px;display:flex;align-items:center;justify-content:center}
      #${OPTION_ID} .ca-title{display:block;font-size:14px;font-weight:600;color:rgb(203,213,225)}
      #${OPTION_ID} .ca-desc{display:block;margin-top:4px;font-size:12px;line-height:1.45;color:rgb(148,163,184)}
      #${OPTION_ID} .ca-note{display:block;margin-top:5px;font-size:11px;color:rgb(56,189,248)}
    `;
    document.head.appendChild(style);
  }

  function findWhenSomeoneCallsSection() {
    const labels = [...document.querySelectorAll("label, h2, h3, div")];
    const heading = labels.find(el => el.textContent?.trim() === "When Someone Calls");
    if (!heading) return null;
    let node = heading.parentElement;
    while (node && node !== document.body) {
      if (node.querySelectorAll("button").length >= 4) return node;
      node = node.parentElement;
    }
    return null;
  }

  async function applyPreset(button) {
    const numberId = numberIdFromPath();
    if (!numberId || button.dataset.saving === "true") return;

    button.dataset.saving = "true";
    const title = button.querySelector(".ca-title");
    const original = title?.textContent || "AI answers after first ring";
    if (title) title.textContent = "Saving…";

    try {
      const response = await fetch(`/api/phone-numbers/${numberId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answerMode: "forward",
          callerExperience: "ringing",
          ringCount: 1,
          callScreen: true,
          callScreenFallback: "ai_voice",
          forwardNoAnswerAction: "ai_voice"
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.message || "Could not save routing preset");
      if (title) title.textContent = "Saved — AI answers after first ring";
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      button.dataset.saving = "false";
      if (title) title.textContent = original;
      window.alert(error instanceof Error ? error.message : "Could not save routing preset");
    }
  }

  function install() {
    if (!numberIdFromPath() || document.getElementById(OPTION_ID)) return false;
    const section = findWhenSomeoneCallsSection();
    if (!section) return false;
    const options = section.querySelector("div.space-y-2") || [...section.querySelectorAll("div")].find(el => el.querySelectorAll(":scope > button").length >= 4);
    if (!options) return false;

    addStyles();
    const button = document.createElement("button");
    button.type = "button";
    button.id = OPTION_ID;
    button.innerHTML = `
      <span class="ca-radio">⚡</span>
      <span>
        <span class="ca-title">AI answers after first ring</span>
        <span class="ca-desc">The forwarded phone rings once. A person must answer and press 1 to accept the call. If nobody accepts it, the configured AI agent takes over.</span>
        <span class="ca-note">Prevents the forwarded phone's personal voicemail from taking the call. Uses the same AI voice, greeting, instructions and booking rules shown under AI Agent.</span>
      </span>`;
    button.addEventListener("click", () => applyPreset(button));
    options.appendChild(button);
    return true;
  }

  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 20) window.clearInterval(timer);
  }, 400);
  install();
})();
