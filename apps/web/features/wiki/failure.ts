import { KazusaApiError } from "@/lib/source/http";

/** What went wrong, in the Gateway's words when it gave any. */
export function failureText(failure: unknown): string {
  if (failure instanceof KazusaApiError)
    return failure.message.replace(/^Request failed \(\d+\): /, "");
  return failure instanceof Error ? failure.message : String(failure);
}

/** A save made over a version someone else changed meanwhile. */
export const isConflict = (failure: unknown): boolean =>
  failure instanceof KazusaApiError && failure.status === 409;
