const GAS_API_URL = import.meta.env.VITE_GAS_API_URL;

if (!GAS_API_URL) {
  throw new Error('Missing VITE_GAS_API_URL');
}

export const gasGet = (query) => fetch(`${GAS_API_URL}${query}`);

export const gasPost = (payload) => fetch(GAS_API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify(payload)
});
