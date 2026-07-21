const originalFetch = window.fetch.bind(window);

function getCompanyId(): string | null {
  return new URLSearchParams(window.location.search).get("companyId");
}

function addCompanyScope(rawUrl: string): string {
  const companyId = getCompanyId();
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

async function normalizeScopedCallLogResponse(url: string, response: Response): Promise<Response> {
  const companyId = getCompanyId();
  const parsedUrl = new URL(url, window.location.origin);

  if (
    !companyId ||
    !response.ok ||
    parsedUrl.pathname !== "/api/call-logs" ||
    parsedUrl.searchParams.get("companyId") !== companyId
  ) {
    return response;
  }

  try {
    const calls = await response.clone().json();
    if (!Array.isArray(calls)) return response;

    const numbersResponse = await originalFetch("/api/phone-numbers", { credentials: "include" });
    if (!numbersResponse.ok) return response;

    const phoneNumbers = await numbersResponse.json();
    if (!Array.isArray(phoneNumbers)) return response;

    const companyNumberById = new Map<number, string>();
    for (const phoneNumber of phoneNumbers) {
      if (String(phoneNumber.companyId) === companyId && phoneNumber.id != null && phoneNumber.number) {
        companyNumberById.set(Number(phoneNumber.id), String(phoneNumber.number));
      }
    }

    const normalizedCalls = calls.map((call: any) => {
      const configuredNumber = companyNumberById.get(Number(call.phoneNumberId));
      if (!configuredNumber) return call;

      return call.direction === "outbound"
        ? { ...call, fromNumber: configuredNumber }
        : { ...call, toNumber: configuredNumber };
    });

    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json");
    headers.delete("content-length");

    return new Response(JSON.stringify(normalizedCalls), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  let requestInput: RequestInfo | URL = input;
  let scopedUrl: string;

  if (typeof input === "string") {
    scopedUrl = addCompanyScope(input);
    requestInput = scopedUrl;
  } else if (input instanceof URL) {
    scopedUrl = addCompanyScope(input.toString());
    requestInput = new URL(scopedUrl, window.location.origin);
  } else {
    scopedUrl = addCompanyScope(input.url);
    if (scopedUrl !== input.url) {
      requestInput = new Request(scopedUrl, input);
    }
  }

  const response = await originalFetch(requestInput, init);
  return normalizeScopedCallLogResponse(scopedUrl!, response);
}) as typeof window.fetch;
