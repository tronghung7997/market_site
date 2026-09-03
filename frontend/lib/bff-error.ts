/** BFF-owned JSON errors. `detail` stays English; the client maps `error_code`. */
export function bffErrorBody(errorCode: string, detail: string) {
  return { detail, error_code: errorCode, params: {} };
}
