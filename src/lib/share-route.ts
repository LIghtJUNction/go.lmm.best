export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function sharePath(shareId: string): string {
  if (!SHARE_ID_PATTERN.test(shareId)) throw new Error("Invalid share ID");
  return `/watch/${shareId}`;
}

export function shareIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/watch\/([^/]+)\/?$/);
  if (!match) return null;
  return SHARE_ID_PATTERN.test(match[1]) ? match[1] : null;
}
