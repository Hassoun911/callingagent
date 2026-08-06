(() => {
  const CARD_ID = "ca-company-whatsapp-setup-help";
  const MAX_ATTEMPTS = 20;
  let attempts = 0;

  function isPortalSetupPage() {
    const path = window.location.pathname;
    return path === "/portal" || path === "/portal/numbers" || path.startsWith("/portal/numbers/");
  }

  function findNotificationSetting() {
    return [...document.querySelectorAll("p,span,div")].find((node) => {
      const text = node.textContent?.trim().toLowerCase();
      return text === "notification phone" || text === "post-call notifications not configured";
    }) || null;
  }

  function findPageHeading() {
    const path = window.location.pathname;
    if (path === "/portal") {
      return [...document.querySelectorAll("h1")].find((node) => node.textContent?.trim() === "Dashboard") || null;
    }
    return [...document.querySelectorAll("h1,h2")].find((node) => {
      const text = node.textContent?.trim().toLowerCase() || "";
      return text.includes("phone") || text.includes("configure");
    }) || null;
  }

  function createCard() {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.setAttribute("aria-label", "Admin WhatsApp Call Alerts");
    card.className = "rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4";
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:rgba(16,185,129,.14);color:rgb(52,211,153);font-weight:800;flex-shrink:0">WA</div>
        <div style="min-width:0;flex:1">
          <h2 style="margin:0;color:rgb(226,232,240);font-size:15px;font-weight:700">Admin WhatsApp Call Alerts</h2>
          <p style="margin:4px 0 0;color:rgb(148,163,184);font-size:12px;line-height:1.55">Choose the WhatsApp number that should receive this company’s AI call summaries, appointment updates, and required-action alerts.</p>
          <div style="margin-top:12px;display:grid;gap:8px;color:rgb(203,213,225);font-size:12px;line-height:1.5">
            <div><strong style="color:rgb(226,232,240)">1. Company recipient:</strong> Enter the company admin’s WhatsApp number. A 10-digit Canadian or US number such as <code style="font-family:monospace">2263473180</code> is accepted and saved as <code style="font-family:monospace">+12263473180</code>.</div>
            <div><strong style="color:rgb(226,232,240)">2. Company-specific delivery:</strong> Alerts for this company’s phone lines go only to the number saved here. Other companies keep their own separate recipients.</div>
            <div><strong style="color:rgb(226,232,240)">3. What the alert includes:</strong> Company name, caller name and number, call type, AI summary, and any action the admin must take.</div>
            <div><strong style="color:rgb(226,232,240)">4. Sandbox testing:</strong> While the platform uses the Twilio WhatsApp Sandbox, this recipient must join the Sandbox once before test alerts can arrive. Production WhatsApp does not require the join code.</div>
          </div>
          <p style="margin:10px 0 0;color:rgb(110,231,183);font-size:11px;font-weight:600">The Twilio sender and approved message template are managed by CallingAgent. Company admins only need to maintain their own recipient number.</p>
        </div>
      </div>`;
    return card;
  }

  function install() {
    if (!isPortalSetupPage() || document.getElementById(CARD_ID)) return true;

    const setting = findNotificationSetting();
    if (setting) {
      const settingCard = setting.closest("div.rounded-lg") || setting.parentElement?.parentElement || setting.parentElement;
      if (settingCard?.parentElement) {
        settingCard.insertAdjacentElement("beforebegin", createCard());
        return true;
      }
    }

    const heading = findPageHeading();
    if (heading?.parentElement?.parentElement) {
      heading.parentElement.insertAdjacentElement("afterend", createCard());
      return true;
    }

    return false;
  }

  function run() {
    attempts += 1;
    if (install() || attempts >= MAX_ATTEMPTS) return;
    window.setTimeout(run, 350);
  }

  window.addEventListener("popstate", () => {
    document.getElementById(CARD_ID)?.remove();
    attempts = 0;
    window.setTimeout(run, 100);
  });
  window.setTimeout(run, 100);
})();
