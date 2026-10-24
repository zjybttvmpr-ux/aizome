let fs = false;
export function getCurrentWindow() {
  return {
    setFullscreen: async (v) => { fs = v; },
    isFullscreen: async () => fs,
    onCloseRequested: async () => () => {},
    destroy: async () => {},
    close: async () => {},
  };
}
