export function withoutRegion<T>(layers: Map<string, T>, regionId: string): Map<string, T> {
  if (!layers.has(regionId)) return layers;
  const next = new Map(layers);
  next.delete(regionId);
  return next;
}

export function evictRegionIndexes<T>(indexes: Map<string, T>, regionId: string): void {
  for (const key of indexes.keys()) {
    if (key.startsWith(`${regionId}:`)) indexes.delete(key);
  }
}