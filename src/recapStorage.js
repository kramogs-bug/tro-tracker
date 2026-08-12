function seenKey(shareId, recapKey) {
  return `troTrackerRecapSeen:v1:${shareId}:${recapKey}`;
}

export function wasRecapSeen(shareId, recapKey) {
  try {
    return localStorage.getItem(seenKey(shareId, recapKey)) === "1";
  } catch {
    return false;
  }
}

export function markRecapSeen(shareId, recapKey) {
  try {
    localStorage.setItem(seenKey(shareId, recapKey), "1");
  } catch {
    // A blocked localStorage should not prevent dismissing the recap.
  }
}
