/** HTTP method label for a gateway endpoint. `null` means the endpoint is
 *  declared as a bare path: the gateway forwards whatever method the buyer
 *  uses, so both common verbs are shown instead of a guessed one. */
export function endpointMethodLabel(method: string | null | undefined): string {
  return method ? method.toUpperCase() : "GET · POST";
}
