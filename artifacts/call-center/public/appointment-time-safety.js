(() => {
  const MAX_REASONABLE_MINUTES = 12 * 60;
  const DEFAULT_DURATION_MINUTES = 90;
  const processed = new WeakMap();

  function dispatchInput(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function repairDialog(dialog) {
    const title = dialog.textContent || "";
    if (!/Edit Appointment|New Appointment/i.test(title)) return;

    const inputs = [...dialog.querySelectorAll('input[type="datetime-local"]')];
    if (inputs.length < 2) return;

    const [startInput, endInput] = inputs;
    const signature = `${startInput.value}|${endInput.value}`;
    if (processed.get(dialog) === signature) return;
    processed.set(dialog, signature);

    if (!startInput.value) return;
    const start = new Date(startInput.value);
    const end = endInput.value ? new Date(endInput.value) : null;
    if (Number.isNaN(start.getTime())) return;

    const durationMinutes = end && !Number.isNaN(end.getTime())
      ? Math.round((end.getTime() - start.getTime()) / 60000)
      : null;

    const invalid = durationMinutes !== null && (
      durationMinutes <= 0 || durationMinutes > MAX_REASONABLE_MINUTES
    );

    if (!endInput.value || invalid) {
      const corrected = new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60000);
      const pad = (n) => String(n).padStart(2, "0");
      endInput.value = `${corrected.getFullYear()}-${pad(corrected.getMonth() + 1)}-${pad(corrected.getDate())}T${pad(corrected.getHours())}:${pad(corrected.getMinutes())}`;
      dispatchInput(endInput);
    }
  }

  function scan() {
    document.querySelectorAll('[role="dialog"]').forEach(repairDialog);
  }

  const observer = new MutationObserver(() => requestAnimationFrame(scan));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "datetime-local") {
      requestAnimationFrame(scan);
    }
  }, true);
  scan();
})();
