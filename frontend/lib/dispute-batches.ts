// Matches the API contract and keeps a 500–2,000 item order atomic. Larger
// future selections remain recoverable as independently idempotent batches.
export const DISPUTE_RESOURCE_BATCH_SIZE = 2_000;

export function chunkDisputeResourceIds(
  resourceIds: number[],
  batchSize = DISPUTE_RESOURCE_BATCH_SIZE,
): number[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError("batchSize must be a positive integer");
  }

  const uniqueIds = [...new Set(resourceIds)];
  const batches: number[][] = [];
  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    batches.push(uniqueIds.slice(index, index + batchSize));
  }
  return batches;
}
