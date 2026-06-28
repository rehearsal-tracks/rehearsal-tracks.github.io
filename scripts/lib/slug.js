import { basename, extname } from "node:path";

export function stemNameFromFilename(file) {
  const b = basename(file);
  return b.slice(0, b.length - extname(b).length);
}

export function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
