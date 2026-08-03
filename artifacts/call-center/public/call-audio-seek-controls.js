(() => {
  const MARKER = "data-call-audio-seek-controls";
  const NativeAudio = window.Audio;
  const trackedAudio = [];

  // The React player creates recordings with `new Audio(src)` but does not render
  // an <audio> tag. Capture those real media objects so the injected controls can
  // seek the recording directly instead of faking a click on the progress bar.
  function TrackedAudio(src) {
    const audio = new NativeAudio(src);
    trackedAudio.push(audio);
    if (trackedAudio.length > 20) trackedAudio.shift();
    return audio;
  }
  TrackedAudio.prototype = NativeAudio.prototype;
  Object.setPrototypeOf(TrackedAudio, NativeAudio);
  window.Audio = TrackedAudio;

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

  function getCurrentAudio() {
    // Prefer the actively playing recording. Otherwise use the newest recording
    // object, which corresponds to the currently open call-details dialog.
    for (let index = trackedAudio.length - 1; index >= 0; index -= 1) {
      const audio = trackedAudio[index];
      if (!audio.paused && !audio.ended) return audio;
    }
    return trackedAudio[trackedAudio.length - 1] || null;
  }

  function seekBy(deltaSeconds) {
    const audio = getCurrentAudio();
    if (!audio) return;

    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    let upperLimit = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : Number.POSITIVE_INFINITY;

    if (audio.seekable && audio.seekable.length > 0) {
      upperLimit = Math.min(upperLimit, audio.seekable.end(audio.seekable.length - 1));
    }

    const requested = Math.max(0, current + deltaSeconds);
    const target = Number.isFinite(upperLimit) ? Math.min(requested, upperLimit) : requested;

    try {
      if (typeof audio.fastSeek === "function") audio.fastSeek(target);
      else audio.currentTime = target;
    } catch {
      audio.currentTime = target;
    }

    // Force the React player display to refresh promptly in browsers that delay
    // the normal timeupdate event after a programmatic seek.
    audio.dispatchEvent(new Event("timeupdate"));
  }

  function makeButton(label, title, deltaSeconds) {
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
      seekBy(deltaSeconds);
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
      controls.appendChild(makeButton("−10s", "Go back 10 seconds", -10));
      controls.appendChild(makeButton("+10s", "Go forward 10 seconds", 10));

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
