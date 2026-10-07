function suffix(segments: string[], count: number): string {
  return segments.slice(Math.max(0, segments.length - count)).join("/");
}

// Labels each path with the fewest trailing segments that no other path in the
// same set shares, so `src/utils` shows as `utils` unless another `utils` is on
// screen too.
export function shortestUniqueLabels(paths: string[]): Map<string, string> {
  const split = paths.map((value) => ({ value, segments: value.split("/") }));
  const labels = new Map<string, string>();
  for (const { value, segments } of split) {
    let count = 1;
    while (
      count < segments.length &&
      split.some((other) => other.value !== value && suffix(other.segments, count) === suffix(segments, count))
    ) {
      count += 1;
    }
    labels.set(value, suffix(segments, count));
  }
  return labels;
}
