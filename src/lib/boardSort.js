const FEATURE_PRIORITY = { High: 0, Medium: 1, Low: 2 };
const BUG_SEVERITY = { Critical: 0, Major: 1, Minor: 2 };
const BUG_STATUS = { Open: 0, Blocked: 1, Testing: 2, Fixed: 3, Archived: 4 };

export function compareFeaturesByFocus(a, b) {
  const pa = FEATURE_PRIORITY[a.priority] ?? 9;
  const pb = FEATURE_PRIORITY[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return b.progress - a.progress;
}

export function compareBugsByFocus(a, b) {
  const sa = BUG_SEVERITY[a.severity] ?? 9;
  const sb = BUG_SEVERITY[b.severity] ?? 9;
  if (sa !== sb) return sa - sb;
  const sta = BUG_STATUS[a.status] ?? 9;
  const stb = BUG_STATUS[b.status] ?? 9;
  if (sta !== stb) return sta - stb;
  return a.id.localeCompare(b.id);
}

export function sortFeaturesForDisplay(features) {
  return [...features].sort(compareFeaturesByFocus);
}

export function sortBugsForDisplay(bugs) {
  return [...bugs].sort(compareBugsByFocus);
}
