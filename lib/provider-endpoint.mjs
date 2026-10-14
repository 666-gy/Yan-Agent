// Keep query credentials/routing parameters on the final endpoint, rather
// than allowing SDK string concatenation to append /chat/completions after ?.
export function providerEndpoint(baseURL, fetch) {
  let endpoint;
  try { endpoint = new URL(baseURL); } catch { return { baseURL, fetch }; }
  if (!endpoint.search) return { baseURL, fetch };
  const parameters = [...endpoint.searchParams]; endpoint.search = '';
  return {
    baseURL: endpoint.toString().replace(/\/$/, ''),
    fetch(input, init) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      for (const [key,value] of parameters) if (!url.searchParams.has(key)) url.searchParams.append(key,value);
      return fetch(input instanceof Request ? new Request(url, input) : url.toString(), init);
    }
  };
}
