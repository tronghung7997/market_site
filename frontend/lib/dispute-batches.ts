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

export function chunkPairedDisputeResources(
  resourceIds: number[],
  replacementResourceIds: number[] | undefined,
  batchSize = DISPUTE_RESOURCE_BATCH_SIZE,
): Array<{ resourceIds: number[]; replacementResourceIds?: number[] }> {
  const claimed = [...new Set(resourceIds)];
  if (replacementResourceIds == null) {
    return chunkDisputeResourceIds(claimed, batchSize).map((ids) => ({ resourceIds: ids }));
  }
  if (replacementResourceIds.length !== claimed.length) {
    throw new RangeError("replacementResourceIds length must match unique resourceIds");
  }
  if (new Set(replacementResourceIds).size !== replacementResourceIds.length) {
    throw new RangeError("replacement resource IDs must be unique");
  }
  const batches: Array<{ resourceIds: number[]; replacementResourceIds: number[] }> = [];
  for (let index = 0; index < claimed.length; index += batchSize) {
    batches.push({
      resourceIds: claimed.slice(index, index + batchSize),
      replacementResourceIds: replacementResourceIds.slice(index, index + batchSize),
    });
  }
  return batches;
}
