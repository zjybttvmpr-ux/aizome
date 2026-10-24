window.__aizomeEvents = window.__aizomeEvents || {};
export async function listen(name, cb) {
  (window.__aizomeEvents[name] ||= []).push(cb);
  return () => {};
}
