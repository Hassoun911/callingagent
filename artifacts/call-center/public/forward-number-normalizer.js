(() => {
  const NUMBER_PAGE = /^\/(?:portal\/)?numbers\/\d+\/?$/;

  function normalizeNorthAmericanPhone(raw) {
    const value = String(raw ?? "").trim();
    if (!value) return "";

    const digits = value.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    if (value.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    return null;
  }

  function findDestinationInput() {
    if (!NUMBER_PAGE.test(location.pathname)) return null;

    const labels = Array.from(document.querySelectorAll("label"));
    const label = labels.find(el => el.textContent?.replace(/\s+/g, " ").trim() === "Destination Number");
    if (!label) return null;

    const container = label.parentElement;
    return container?.querySelector("input") ?? null;
  }

  function setReactInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function normalizeInput(showError = false) {
    const input = findDestinationInput();
    if (!input) return true;

    const normalized = normalizeNorthAmericanPhone(input.value);
    if (normalized === null) {
      input.setCustomValidity("Enter a valid phone number, such as 2263473180 or +12263473180.");
      if (showError) input.reportValidity();
      return false;
    }

    input.setCustomValidity("");
    if (normalized && input.value !== normalized) setReactInputValue(input, normalized);
    return true;
  }

  document.addEventListener("focusout", event => {
    if (event.target === findDestinationInput()) normalizeInput(false);
  }, true);

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.textContent?.replace(/\s+/g, " ").trim() !== "Save Changes") return;

    if (!normalizeInput(true)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
