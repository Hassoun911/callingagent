(() => {
  const PAGE_PATH = "/bookings/setup";
  const HELP_ATTR = "data-booking-rule-help";

  const explanations = [
    {
      match: "Enable AI and dashboard bookings",
      text: "Turn this on to allow the AI phone agent and company dashboard users to create appointments. Turn it off to pause all new bookings without deleting your services, staff, hours, or existing appointments.",
      example: "Recommended: ON when the booking system is ready for customers."
    },
    {
      match: "Timezone",
      text: "Controls how the AI understands words such as today, tomorrow, and 3 p.m., and how appointment times appear in confirmations and reminders.",
      example: "For Ontario and Windsor, use America/Toronto."
    },
    {
      match: "Slot interval",
      text: "Controls the spacing between available start times. It does not change the service duration. A smaller interval gives callers more choices; a larger interval keeps the schedule simpler.",
      example: "Example: 30 means the AI may offer 9:00, 9:30, 10:00, and so on."
    },
    {
      match: "Minimum notice (minutes)",
      text: "The minimum amount of time required before a new appointment can start. This prevents customers from booking too close to the current time.",
      example: "Example: 120 means customers must book at least 2 hours ahead. Use 0 only when immediate bookings are allowed."
    },
    {
      match: "Maximum advance days",
      text: "The furthest date into the future that the AI or dashboard may book. Requests beyond this limit should not be confirmed.",
      example: "Example: 90 allows bookings up to 90 days from today."
    },
    {
      match: "Allow preferred resource",
      text: "Lets the caller request a specific technician, staff member, vehicle, room, chair, or other resource. The AI still checks that resource's working hours and availability before confirming.",
      example: "Turn this off when customers should not choose who performs the service."
    },
    {
      match: "Allow random assignment",
      text: "Allows the system to choose any qualified available resource when the caller has no preference. The system uses your service assignments, working hours, time off, and existing bookings.",
      example: "Recommended: ON when any qualified technician or staff member may take the appointment."
    },
    {
      match: "Require admin approval",
      text: "New appointments are saved as waiting for approval instead of being treated as fully confirmed. The company admin must review and confirm them before the customer is promised a final appointment.",
      example: "Use this when travel time, inventory, same-day service, pricing, or staff confirmation must be checked manually."
    }
  ];

  function addStyles() {
    if (document.getElementById("booking-rules-help-style")) return;
    const style = document.createElement("style");
    style.id = "booking-rules-help-style";
    style.textContent = `
      [${HELP_ATTR}]{margin-top:.42rem;font-size:.72rem;line-height:1.48;color:rgb(148 163 184)}
      [${HELP_ATTR}] strong{color:rgb(186 230 253);font-weight:600}
      .booking-rules-intro{border:1px solid rgba(14,165,233,.22);background:rgba(14,165,233,.055);border-radius:.6rem;padding:.75rem .85rem;font-size:.75rem;line-height:1.55;color:rgb(159 176 200)}
      .booking-rules-intro strong{color:rgb(224 242 254)}
    `;
    document.head.appendChild(style);
  }

  function directText(element) {
    return Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findTarget(match) {
    const candidates = Array.from(document.querySelectorAll("label, h2, span"));
    return candidates.find(element => {
      const text = (directText(element) || element.textContent || "").replace(/\s+/g, " ").trim();
      return text === match;
    }) || null;
  }

  function addHelp(target, item) {
    if (target.parentElement?.querySelector(`:scope > [${HELP_ATTR}='${CSS.escape(item.match)}']`)) return;
    const help = document.createElement("div");
    help.setAttribute(HELP_ATTR, item.match);
    help.innerHTML = `${item.text} <strong>${item.example}</strong>`;

    const isSwitchRow = target.tagName === "LABEL" && target.querySelector("button,[role='switch']");
    if (isSwitchRow) {
      target.style.alignItems = "flex-start";
      const wrapper = document.createElement("span");
      wrapper.style.minWidth = "0";
      wrapper.style.flex = "1";
      const textNodes = Array.from(target.childNodes).filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const labelText = textNodes.map(node => node.textContent?.trim()).join(" ");
      textNodes.forEach(node => node.remove());
      const title = document.createElement("span");
      title.textContent = labelText || item.match;
      title.style.display = "block";
      wrapper.append(title, help);
      target.appendChild(wrapper);
      return;
    }

    target.insertAdjacentElement("afterend", help);
  }

  function enhance() {
    if (location.pathname !== PAGE_PATH) return false;
    addStyles();
    const title = Array.from(document.querySelectorAll("h2")).find(el => el.textContent?.trim() === "Company Booking Rules");
    if (!title) return false;

    const section = title.closest("section");
    if (section && !section.querySelector(".booking-rules-intro")) {
      const intro = document.createElement("div");
      intro.className = "booking-rules-intro";
      intro.innerHTML = "<strong>How these rules work:</strong> They control which appointment times the AI and dashboard are allowed to offer. The AI must also respect services, staff/resource assignments, working hours, time off, existing appointments, and the company timezone.";
      title.parentElement?.insertAdjacentElement("afterend", intro);
    }

    explanations.forEach(item => {
      const target = findTarget(item.match);
      if (target) addHelp(target, item);
    });
    return true;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const complete = enhance();
    if (complete || attempts >= 20) window.clearInterval(timer);
  }, 500);

  window.addEventListener("popstate", () => {
    attempts = 0;
    enhance();
  });
  enhance();
})();
