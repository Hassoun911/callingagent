const originalFetch = window.fetch.bind(window);

function addCompanyScope(rawUrl: string): string {
  const companyId = new URLSearchParams(window.location.search).get("companyId");
  if (!companyId) return rawUrl;

  const url = new URL(rawUrl, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/call-logs")) {
    return rawUrl;
  }

  if (!url.searchParams.has("companyId")) {
    url.searchParams.set("companyId", companyId);
  }

  return `${url.pathname}${url.search}`;
}

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string") {
    return originalFetch(addCompanyScope(input), init);
  }

  if (input instanceof URL) {
    return originalFetch(new URL(addCompanyScope(input.toString()), window.location.origin), init);
  }

  const scopedUrl = addCompanyScope(input.url);
  if (scopedUrl !== input.url) {
    return originalFetch(new Request(scopedUrl, input), init);
  }

  return originalFetch(input, init);
}) as typeof window.fetch;
