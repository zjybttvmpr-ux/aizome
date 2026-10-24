export function getCurrentWebview() {
  return {
    onDragDropEvent: async (cb) => {
      window.__drop = (type, paths) => cb({ payload: { type, paths } });
      return () => {};
    },
  };
}
