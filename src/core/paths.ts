// Windows（\）と Mac/Linux（/）のどちらの区切りでも動くパス操作

export function sepOf(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return i === 0 ? path.slice(0, 1) : "";
  // "C:\" のようなドライブ直下
  if (/^[A-Za-z]:$/.test(path.slice(0, i))) return path.slice(0, i + 1);
  return path.slice(0, i);
}

export function join(dir: string, name: string): string {
  const sep = sepOf(dir);
  return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + sep + name;
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
}

export function stripExt(path: string): string {
  const e = extname(path);
  return e ? path.slice(0, -e.length) : path;
}

export function relative(root: string, path: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root);
  const p = norm(path);
  if (p === r) return "";
  return p.startsWith(r + "/") ? p.slice(r.length + 1) : path;
}

/** path が root の中にあるか（".." による脱出も弾く） */
export function isInside(root: string, path: string): boolean {
  const norm = (p: string) => {
    const out: string[] = [];
    for (const part of p.replace(/\\/g, "/").split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/").toLowerCase();
  };
  const r = norm(root);
  const p = norm(path);
  return p === r || p.startsWith(r + "/");
}

export function resolveIn(root: string, path: string): string {
  if (/^([A-Za-z]:[\\/]|\/)/.test(path)) return path;
  return join(root, path.replace(/^\.[\\/]/, ""));
}
