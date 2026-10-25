import { Context, Data, Effect, Layer, Schedule, type Duration } from "effect";
import {
  Array as SchemaArray,
  Boolean as SchemaBoolean,
  Literal,
  String as SchemaString,
  Struct,
  decodeUnknownEffect,
  optional,
} from "effect/Schema";
import {
  FetchFailed,
  INSPECTION_TIMEOUT,
  InvalidContent,
  InvalidTarget,
  TooLarge,
  hosts,
  inspect,
  target,
} from "./inspection.ts";

// One bounded release-check batch: a handful of public pages inspected with a
// fixed concurrency, one permission check before any network read, and a typed
// outcome per page. A batch report is not a durable journal; it is returned to
// the caller and not persisted by this Worker.
export const BATCH_CONTRACT = 1;
export const MAX_TARGETS = 4;
export const MAX_BODY_BYTES = 8 * 1024;
export const BATCH_CONCURRENCY = 2;
export const ATTEMPTS_PER_TARGET = 2;
export const RETRY_BACKOFF: Duration.Input = "250 millis";

export class InvalidBatch extends Data.TaggedError("InvalidBatch")<{
  message: string;
  field: string;
}> {}

export class TargetNotPermitted extends Data.TaggedError("TargetNotPermitted")<{
  message: string;
  target: string;
}> {}

export class DuplicateTarget extends Data.TaggedError("DuplicateTarget")<{
  message: string;
  target: string;
  firstIndex: number;
  index: number;
}> {}

// Request-level refusals happen before any fetch. A page that cannot be read is
// a per-target outcome instead, so one failure does not discard other evidence.
export type BatchRefusal =
  InvalidBatch | InvalidTarget | TargetNotPermitted | DuplicateTarget;

class AttemptTimeout extends Data.TaggedError("AttemptTimeout")<{
  message: string;
}> {}

class InspectorDefect extends Data.TaggedError("InspectorDefect")<{
  message: string;
}> {}

export interface BatchRequest {
  readonly contract: 1;
  readonly targets: readonly string[];
  readonly discovery?: boolean;
}

export const BatchRequestSchema = Struct({
  contract: Literal(BATCH_CONTRACT),
  targets: SchemaArray(SchemaString),
  discovery: optional(SchemaBoolean),
});

export interface TargetOutcome {
  readonly target: string;
  readonly resolved?: string;
  readonly status: "verified" | "failed" | "uncertain";
  readonly attempts: number;
  readonly code: string;
  readonly message: string;
  readonly recovery: string;
  readonly reconciled: boolean;
  readonly findings?: { pass: number; fix: number; review: number };
  readonly images?: { verified: number; failed: number; missing: number };
  readonly bytes?: number;
}

export interface BatchReport {
  readonly contract: 1;
  readonly kind: "batch-inspection";
  readonly status: "complete" | "partial" | "failed";
  readonly startedAt: string;
  readonly checkedAt: string;
  readonly scope: { reviewedHosts: number };
  readonly limits: {
    targets: number;
    concurrency: number;
    attemptsPerTarget: number;
    attemptTimeout: string;
    retry: "read-only transport failures only";
    persisted: false;
  };
  readonly totals: {
    verified: number;
    failed: number;
    uncertain: number;
    attempts: number;
  };
  readonly recovery: string;
  readonly targets: readonly TargetOutcome[];
}

export type InspectionReport = Effect.Success<ReturnType<typeof inspect>>;

export interface InspectionService {
  readonly inspect: (
    url: string,
    options: { discovery: boolean; timeout: Duration.Input },
  ) => ReturnType<typeof inspect>;
}

// Provider access, the reviewed host list and the runner stay separate so tests
// can revoke a host, script a timeout, or count calls without real network IO.
export class Inspector extends Context.Service<Inspector, InspectionService>()(
  "Inspector",
) {}

export class ReviewedScope extends Context.Service<
  ReviewedScope,
  { readonly hosts: readonly string[] }
>()("ReviewedScope") {}

export const InspectorLive = Layer.succeed(Inspector, {
  inspect: (url, options) => inspect(url, undefined, options),
});

export const ReviewedScopeLive = Layer.succeed(ReviewedScope, {
  hosts,
});

export const BatchLive = Layer.merge(InspectorLive, ReviewedScopeLive);

function textOf(input: string | Uint8Array): string {
  return typeof input === "string" ? input : new TextDecoder().decode(input);
}

export function parseBatchRequest(
  input: unknown,
): Effect.Effect<BatchRequest, InvalidBatch> {
  return Effect.gen(function* () {
    let value: unknown = input;
    if (typeof input === "string" || input instanceof Uint8Array) {
      const size = typeof input === "string" ? input.length : input.byteLength;
      if (size > MAX_BODY_BYTES)
        return yield* Effect.fail(
          new InvalidBatch({
            message: "A batch request must be under 8 KiB.",
            field: "body",
          }),
        );
      const text = textOf(input);
      const parsed = yield* Effect.sync(() => {
        try {
          return { ok: true as const, value: JSON.parse(text) as unknown };
        } catch {
          return { ok: false as const };
        }
      });
      if (!parsed.ok)
        return yield* Effect.fail(
          new InvalidBatch({
            message: "Send a JSON object with contract 1 and target URLs.",
            field: "body",
          }),
        );
      value = parsed.value;
    }
    return yield* decodeUnknownEffect(BatchRequestSchema)(value).pipe(
      Effect.mapError(
        () =>
          new InvalidBatch({
            message:
              "Use contract 1 with a targets array of URL strings and an optional discovery boolean.",
            field: "body",
          }),
      ),
    );
  });
}

export interface AdmittedTarget {
  readonly input: string;
  readonly url: string;
  readonly identity: string;
}

export function admitTargets(
  request: BatchRequest,
): Effect.Effect<readonly AdmittedTarget[], BatchRefusal, ReviewedScope> {
  return Effect.gen(function* () {
    const scope = yield* ReviewedScope;
    if (request.targets.length === 0)
      return yield* Effect.fail(
        new InvalidBatch({
          message: "Add at least one target URL.",
          field: "targets",
        }),
      );
    if (request.targets.length > MAX_TARGETS)
      return yield* Effect.fail(
        new InvalidBatch({
          message: `A batch accepts at most ${MAX_TARGETS} targets. Run another batch for the rest.`,
          field: "targets",
        }),
      );
    const seen = new Map<string, number>();
    const admitted: AdmittedTarget[] = [];
    for (const [index, input] of request.targets.entries()) {
      // Permission is decided on the parsed hostname before full validation and
      // before any fetch. The scope may narrow the reviewed list, never widen it:
      // the operator batch keeps its committed scope; the public web form uses the separate public-DNS policy.
      let parsed: URL | undefined;
      try {
        parsed = new URL(input);
      } catch {
        parsed = undefined;
      }
      if (
        parsed &&
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        (!scope.hosts.includes(parsed.hostname) ||
          !hosts.includes(parsed.hostname))
      )
        return yield* Effect.fail(
          new TargetNotPermitted({
            message:
              "The reviewed host list does not permit this target. Inspect a permitted page or change the list in reviewed source.",
            target: input,
          }),
        );
      let url: URL;
      try {
        url = target(input);
      } catch (error) {
        if (error instanceof InvalidTarget) return yield* Effect.fail(error);
        throw error;
      }
      const identity = url.origin + url.pathname;
      const first = seen.get(identity);
      if (first !== undefined)
        return yield* Effect.fail(
          new DuplicateTarget({
            message:
              "The same public page appears twice in this batch. Keep one entry per page and remove the duplicate.",
            target: url.href,
            firstIndex: first,
            index,
          }),
        );
      seen.set(identity, index);
      admitted.push({ input, url: url.href, identity });
    }
    return admitted;
  });
}

function retryable(error: unknown): boolean {
  return (
    error instanceof AttemptTimeout ||
    (error instanceof FetchFailed && error.retryable)
  );
}

function failureOutcome(
  entry: AdmittedTarget,
  error: unknown,
  attempts: number,
): TargetOutcome {
  if (error instanceof AttemptTimeout)
    return {
      target: entry.input,
      status: "uncertain",
      attempts,
      code: "AttemptTimeout",
      message: `The attempt timed out; ${attempts} attempt${attempts === 1 ? "" : "s"} were made and none finished.`,
      recovery:
        "Run the batch again when the origin responds. A repeated public read is safe, but this attempt is not evidence that the page or its metadata works.",
      reconciled: false,
    };
  if (error instanceof FetchFailed)
    return {
      target: entry.input,
      status: error.retryable ? "uncertain" : "failed",
      attempts,
      code: "FetchFailed",
      message: error.message,
      recovery: error.retryable
        ? "The origin did not answer reliably. Run the batch again later; keep these targets unverified until it does."
        : "Fix the address or the page, then run the batch again.",
      reconciled: false,
    };
  if (error instanceof InvalidContent)
    return {
      target: entry.input,
      status: "failed",
      attempts,
      code: "InvalidContent",
      message: error.message,
      recovery:
        "Change the page so it returns the expected public content, then run the batch again.",
      reconciled: false,
    };
  if (error instanceof TooLarge)
    return {
      target: entry.input,
      status: "failed",
      attempts,
      code: "TooLarge",
      message: error.message,
      recovery:
        "Inspect a specific page rather than a large response, then run the batch again.",
      reconciled: false,
    };
  if (error instanceof InvalidTarget)
    return {
      target: entry.input,
      status: "failed",
      attempts,
      code: "InvalidTarget",
      message: error.message,
      recovery:
        "Use a public page on a supported hostname, without credentials, private paths or unrelated query strings.",
      reconciled: false,
    };
  // Unknown failures are classified, never echoed: provider text is untrusted
  // data and may contain secrets taken from the origin or transport layer.
  return {
    target: entry.input,
    status: "uncertain",
    attempts,
    code: "UnreadableResult",
    message:
      "The response could not be read within the inspection limits. No provider text is retained.",
    recovery:
      "Run the batch again. If this repeats, inspect the page alone and review the origin.",
    reconciled: false,
  };
}

function successOutcome(
  entry: AdmittedTarget,
  report: InspectionReport,
  attempts: number,
): TargetOutcome {
  const findings = { pass: 0, fix: 0, review: 0 };
  for (const finding of report.findings) findings[finding.status] += 1;
  const images = { verified: 0, failed: 0, missing: 0 };
  for (const image of report.images) {
    if (image.status === "verified") images.verified += 1;
    else if (image.status === "failed") images.failed += 1;
    else images.missing += 1;
  }
  return {
    target: entry.input,
    resolved: report.url,
    status: "verified",
    attempts,
    code: "Inspected",
    message: `${report.findings.length} findings: ${findings.fix} to fix, ${findings.review} to review, ${findings.pass} passed. ${images.verified} share image${images.verified === 1 ? "" : "s"} verified.`,
    findings,
    images,
    bytes: report.htmlBytes,
    reconciled: attempts > 1,
    recovery:
      attempts > 1
        ? "A repeated read succeeded. Review the findings before sharing; the earlier attempt is not evidence."
        : "Review the findings before sharing. No retry is needed.",
  };
}

function runTarget(
  inspector: InspectionService,
  entry: AdmittedTarget,
  discovery: boolean,
  options: { timeout: Duration.Input; backoff: Duration.Input },
): Effect.Effect<TargetOutcome> {
  let attempts = 0;
  const attempt = Effect.suspend(() => {
    attempts += 1;
    return inspector.inspect(entry.url, {
      discovery,
      timeout: options.timeout,
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: options.timeout,
      orElse: () =>
        Effect.fail(
          new AttemptTimeout({
            message: "The attempt exceeded its budget.",
          }),
        ),
    }),
  );
  const bounded = attempt.pipe(
    Effect.retry({
      times: ATTEMPTS_PER_TARGET - 1,
      while: retryable,
      schedule: Schedule.spaced(options.backoff),
    }),
  );
  return bounded.pipe(
    Effect.catchDefect(() =>
      Effect.fail(new InspectorDefect({ message: "The inspector failed." })),
    ),
    Effect.match({
      onSuccess: (report) => successOutcome(entry, report, attempts),
      onFailure: (error) => failureOutcome(entry, error, Math.max(attempts, 1)),
    }),
  );
}

export function runBatch(
  body: unknown,
  options: {
    timeout?: Duration.Input;
    backoff?: Duration.Input;
    concurrency?: number;
  } = {},
): Effect.Effect<BatchReport, BatchRefusal, Inspector | ReviewedScope> {
  return Effect.gen(function* () {
    const request = yield* parseBatchRequest(body);
    const admitted = yield* admitTargets(request);
    const inspector = yield* Inspector;
    const scope = yield* ReviewedScope;
    const timeout = options.timeout ?? INSPECTION_TIMEOUT;
    const concurrency = options.concurrency ?? BATCH_CONCURRENCY;
    const startedAt = yield* Effect.sync(() => new Date().toISOString());
    const targets = yield* Effect.forEach(
      admitted,
      (entry) =>
        runTarget(inspector, entry, request.discovery === true, {
          timeout,
          backoff: options.backoff ?? RETRY_BACKOFF,
        }),
      { concurrency },
    );
    const checkedAt = yield* Effect.sync(() => new Date().toISOString());
    const totals = {
      verified: targets.filter((target) => target.status === "verified").length,
      failed: targets.filter((target) => target.status === "failed").length,
      uncertain: targets.filter((target) => target.status === "uncertain")
        .length,
      attempts: targets.reduce((sum, target) => sum + target.attempts, 0),
    };
    const status =
      totals.verified === targets.length
        ? "complete"
        : totals.verified > 0
          ? "partial"
          : "failed";
    return {
      contract: BATCH_CONTRACT,
      kind: "batch-inspection",
      status,
      startedAt,
      checkedAt,
      scope: { reviewedHosts: scope.hosts.length },
      limits: {
        targets: MAX_TARGETS,
        concurrency,
        attemptsPerTarget: ATTEMPTS_PER_TARGET,
        attemptTimeout: String(timeout),
        retry: "read-only transport failures only",
        persisted: false,
      },
      totals,
      recovery:
        status === "complete"
          ? "Every page was read in this run. Review the findings before sharing."
          : "Re-run the batch for uncertain targets once the origin responds. Verified targets are already recorded in this report.",
      targets,
    } satisfies BatchReport;
  });
}

export function refusalStatus(error: BatchRefusal): 400 | 403 {
  return error._tag === "TargetNotPermitted" ? 403 : 400;
}

export interface BatchHttpResult {
  readonly status: 200 | 400 | 403;
  readonly body: Record<string, unknown>;
}

// The HTTP mapping is part of the tested contract: malformed or duplicated
// requests are 400, a revoked host is 403, and a completed batch is 200 even
// when individual pages failed, because the report is the useful result.
export function toHttp<R>(
  effect: Effect.Effect<BatchReport, BatchRefusal, R>,
): Effect.Effect<BatchHttpResult, never, R> {
  return effect.pipe(
    Effect.match({
      onSuccess: (report) => ({
        status: 200 as const,
        body: report as unknown as Record<string, unknown>,
      }),
      onFailure: (error) => ({
        status: refusalStatus(error),
        body: { error: error.message, kind: error._tag },
      }),
    }),
  );
}

export function batchHttp(
  body: string | Uint8Array,
): Effect.Effect<BatchHttpResult> {
  return toHttp(runBatch(body)).pipe(Effect.provide(BatchLive));
}
