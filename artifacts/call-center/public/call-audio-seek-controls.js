(() => {
  const MARKER = "data-call-audio-seek-controls";

  function parseTime(text) {
    const match = String(text || "").trim().match(/^(\d+):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function findPlayer(track) {
    let node = track.parentElement;
    while (node && node !== document.body) {
      const buttons = node.querySelectorAll("button");
      const times = Array.from(node.querySelectorAll("span"))
        .map(el => ({ el, seconds: parseTime(el.textContent) }))
        .filter(item => item.seconds !== null);
      if (buttons.length && times.length >= 2) return { container: node, times };
      node = node.parentElement;
    }
    return null;
  }

  function seek(track, seconds, duration) {
    if (!duration || duration <= 0) return;
    const target = Math.max(0, Math.min(duration, seconds));
    const rect = track.getBoundingClientRect();
    const clientX = rect.left + (target / duration) * rect.width;
    track.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY: rect.top + rect.height / 2,
      view: window,
    }));
  }

  function makeButton(label, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.style.cssText = [
      "height:34px",
      "min-width:48px",
      "padding:0 10px",
      "border:1px solid rgba(148,163,184,.25)",
      "border-radius:8px",
      "background:rgba(30,41,59,.55)",
      "color:rgb(203,213,225)",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
      "white-space:nowrap",
    ].join(";");
    button.addEventListener("mouseenter", () => { button.style.background = "rgba(51,65,85,.75)"; });
    button.addEventListener("mouseleave", () => { button.style.background = "rgba(30,41,59,.55)"; });
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function enhancePlayers() {
    if (!window.location.pathname.includes("/calls") && !window.location.pathname.startsWith("/portal")) return;

    const tracks = Array.from(document.querySelectorAll("div.cursor-pointer.rounded-full.bg-muted"));
    for (const track of tracks) {
      if (!(track instanceof HTMLElement)) continue;
      const player = findPlayer(track);
      if (!player || player.container.hasAttribute(MARKER)) continue;

      const controls = document.createElement("div");
      controls.setAttribute(MARKER, "true");
      controls.style.cssText = "display:flex;align-items:center;gap:6px;flex-shrink:0";

      const current = () => {
        const values = player.times.map(item => parseTime(item.el.textContent)).filter(value => value !== null);
        return values[0] ?? 0;
      };
      const duration = () => {
        const values = player.times.map(item => parseTime(item.el.textContent)).filter(value => value !== null);
        return values[values.length - 1] ?? 0;
      };

      controls.appendChild(makeButton("−10s", "Go back 10 seconds", () => seek(track, current() - 10, duration())));
      controls.appendChild(makeButton("+10s", "Go forward 10 seconds", () => seek(track, current() + 10, duration())));

      const download = Array.from(player.container.querySelectorAll("a")).find(a => a.hasAttribute("download"));
      if (download?.parentElement) download.parentElement.insertBefore(controls, download);
      else player.container.appendChild(controls);

      player.container.setAttribute(MARKER, "true");
    }
  }

  window.addEventListener("load", enhancePlayers);
  window.addEventListener("popstate", enhancePlayers);
  document.addEventListener("click", () => setTimeout(enhancePlayers, 100));
  setInterval(enhancePlayers, 1500);
  enhancePlayers();
})();
