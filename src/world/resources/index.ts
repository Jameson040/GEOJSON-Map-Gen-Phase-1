import type { GeneratedRegion } from "../types";
import type { ResourceFilterConfig, ResourceLayerResult } from "./resource-types";
import { DEFAULT_RESOURCE_CONFIG } from "./resource-filter";
import { generateRawDeposits } from "./resource-generate";
import { runResourceFinetune } from "./resource-finetune";

export * from "./resource-types";
export * from "./resource-catalog";
export * from "./resource-filter";
export * from "./resource-generate";
export * from "./resource-finetune";

/**
 * Generates the full geological and mineral resource layer for a region.
 */
export async function generateResourceLayer(
  geo: GeneratedRegion,
  customConfig?: Partial<ResourceFilterConfig>
): Promise<ResourceLayerResult> {
  const config: ResourceFilterConfig = {
    ...DEFAULT_RESOURCE_CONFIG,
    ...customConfig,
  };

  const rawDeposits = generateRawDeposits(geo, config);
  const result = runResourceFinetune(rawDeposits, geo, config);
  return result;
}
