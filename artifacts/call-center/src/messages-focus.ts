const THREAD_OPEN_CLASS = "messages-thread-open";

function syncMessagesThreadState() {
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  const hasOpenThread = Boolean(document.querySelector('button[aria-label="Back to conversations"]'));
  document.body.classList.toggle(THREAD_OPEN_CLASS, isMobile && hasOpenThread);
}

if (typeof window !== "undefined") {
  const observer = new MutationObserver(syncMessagesThreadState);

  const start = () => {
    syncMessagesThreadState();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", syncMessagesThreadState);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
