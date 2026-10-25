import { Data } from "effect";
import { publicUrl } from "./browser/public-url.ts";

export class InvalidTarget extends Data.TaggedError("InvalidTarget")<{
  message: string;
}> {}
export function target(input: string): URL {
  try {
    return publicUrl(input);
  } catch (error) {
    throw new InvalidTarget({
      message:
        error instanceof Error ? error.message : "Enter a public HTTPS URL.",
    });
  }
}
