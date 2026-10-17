// MIT. Preserve only this tab's public URL draft through native back navigation.
// Reports, credentials and remote data do not enter browser history state.
(() => {
  const url = document.querySelector<HTMLInputElement>('#url');
  const discovery = document.querySelector<HTMLInputElement>('#discovery');
  if (!url || !discovery) return;
  const property = 'composerLinkcheckDraft';
  const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const publicURL = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch { return false; }
  };
  try {
    const state: unknown = history.state;
    const draft = record(state) ? state[property] : null;
    if (record(draft) && draft.version === 1 && publicURL(draft.url) && typeof draft.discovery === 'boolean') {
      url.value = draft.url;
      discovery.checked = draft.discovery;
    }
  } catch { /* Unavailable history leaves the current form usable. */ }
  function remember() {
    if (!url || !discovery || !publicURL(url.value)) return;
    try {
      const state: unknown = history.state;
      history.replaceState({ ...(record(state) ? state : {}), [property]: {
        version: 1, url: url.value, discovery: discovery.checked,
      } }, '');
    } catch { /* History capacity/permission failure must not interrupt inspection. */ }
  }
  url.addEventListener('input', remember);
  discovery.addEventListener('change', remember);
  window.addEventListener('pagehide', remember);
})();
