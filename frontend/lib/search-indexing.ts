export function isGoogleIndexingEnabled(): boolean {
  return process.env.GOOGLE_INDEXING_ENABLED === "true";
}
