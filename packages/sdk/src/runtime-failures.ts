// Why a runtime's command failed, when its own words say so. A runtime type reads them
// (RuntimeType.classifyFailure); the runner reports the failure with the run or chat answer,
// and Helena records what it learned about the model and fails a failure that cannot pass
// on a retry once, instead of running it again.
//
// This is the same split the Vercel AI SDK (APICallError.isRetryable) and Temporal
// (ApplicationFailure.nonRetryable) make: a provider's 4xx about the request itself does not
// change when it is sent again; a timeout, a rate limit or a 5xx may.

// 'model-unavailable': the provider does not serve the model to this account — Codex with a
// ChatGPT account refusing a model, an unknown model id, a model the plan lacks.
// 'provider-rejected': the provider refused the request for good ("retrying won't help")
// for a reason Helena does not tell apart.
// A plugin runtime may name codes of its own.
export type RuntimeFailureCode = 'model-unavailable' | 'provider-rejected' | (string & {});

export interface RuntimeFailure {
  code: RuntimeFailureCode;
  // False when the same request cannot succeed when sent again: the run fails once, and
  // neither the run queue nor the engine's stage retries start it again.
  retryable: boolean;
  // The model the provider refused, as it named it, when it did.
  model?: string | null;
  // The provider's own words, short.
  detail?: string;
}

// What the runner hands a runtime type's classifier about a command that failed.
export interface RuntimeFailureInput {
  // The command's final answer, or the tail of its output.
  output: string;
  // Its error: the runtime's own error field, else the tail of its stderr.
  error?: string | null;
  // The runtime's own verdict, where its output carries one (Hermes' failure_reason and
  // failure_retryable on the result line).
  reason?: string | null;
  retryable?: boolean | null;
}

export const FAILURE_DETAIL_LIMIT = 300;

// A model id: quoted, or bare when it looks like one (a digit or a dash in it), so "this
// model version is not supported" does not read "version" as a model.
const MODEL = String.raw`(?:['"\`‘’“”]([\w.:/@-]{2,120})['"\`‘’“”]|([\w.:/@]*[\d-][\w.:/@-]*))`;

// How providers word "this account cannot use that model", with the model where they name
// it. Codex (ChatGPT account), Hermes' own copy of a model_not_found, the OpenAI API, the
// Anthropic API, and the plain forms other gateways use.
const MODEL_REFUSALS: RegExp[] = [
  new RegExp(String.raw`\bthe\s+${MODEL}\s+model\s+is\s+not\s+supported\b`, 'i'),
  new RegExp(
    String.raw`\bmodel\s+${MODEL}\s+(?:is\s+not|isn't|isn’t)\s+(?:available|supported)\b`,
    'i',
  ),
  new RegExp(String.raw`\bthe\s+model\s+${MODEL}\s+does\s+not\s+exist\b`, 'i'),
  new RegExp(String.raw`not_found_error[^}]{0,80}?\bmodel:\s*${MODEL}`, 'i'),
  new RegExp(
    String.raw`\b(?:unsupported|unknown|invalid)\s+model(?:\s+(?:id|name))?\s*[:=]\s*${MODEL}`,
    'i',
  ),
  new RegExp(String.raw`\bmodel\s+${MODEL}\s+(?:not\s+found|does\s+not\s+exist)\b`, 'i'),
];

// A refusal that names no model.
const MODEL_REFUSAL_UNNAMED = /\bmodel_not_found\b|\bmodel\s+not\s+found\b|\binvalid[_\s]model\b/i;

// Hermes' copy of a non-retryable provider refusal, and the provider's own wording of it.
const NOT_RETRYABLE = /retrying\s+won['’]?t\s+help|retrying\s+will\s+not\s+help/i;

// The provider's summary line Hermes appends ("Provider said: HTTP 400: …").
const PROVIDER_SAID = /Provider said:\s*([^\n]+)/i;

function clip(text: string, limit = FAILURE_DETAIL_LIMIT): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

// The provider's own words about the failure: the "Provider said" line, the JSON detail of
// an HTTP error, or the line the refusal was found on.
function detailOf(text: string, at: number): string {
  const said = PROVIDER_SAID.exec(text)?.[1];
  if (said) {
    const json = /"(?:detail|message)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(said)?.[1];
    return clip(json ? json.replace(/\\"/g, '"') : said);
  }
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  return clip(text.slice(start, end < 0 ? undefined : end));
}

// Hermes' failure reasons (agent/error_classifier FailoverReason) that say the model or the
// request itself is the problem.
const REASON_MODEL = new Set(['model_not_found']);
// A refused login or a used-up plan is not this classifier's to call final: a login that is
// signed in again, or a limit that resets, lets the same request pass (hub/token-keeper and
// the provider limits read those).
const REASON_ELSEWHERE = new Set(['auth', 'auth_permanent', 'billing', 'rate_limit']);

// Reads a provider refusal out of any runtime's words. Null for a failure that says nothing
// Helena acts on here: a crash, a timeout, a rate limit, a refused login.
export function classifyProviderFailure(input: RuntimeFailureInput): RuntimeFailure | null {
  if (input.reason && REASON_ELSEWHERE.has(input.reason)) return null;
  const text = [input.error ?? '', input.output].filter(Boolean).join('\n');
  for (const pattern of MODEL_REFUSALS) {
    const match = pattern.exec(text);
    if (match)
      return {
        code: 'model-unavailable',
        retryable: false,
        model: match[1] ?? match[2] ?? null,
        detail: detailOf(text, match.index),
      };
  }
  const unnamed = MODEL_REFUSAL_UNNAMED.exec(text);
  if (unnamed || (input.reason && REASON_MODEL.has(input.reason)))
    return {
      code: 'model-unavailable',
      retryable: false,
      model: null,
      detail: detailOf(text, unnamed?.index ?? 0),
    };
  const final = NOT_RETRYABLE.exec(text);
  if (final || input.retryable === false)
    return {
      code: 'provider-rejected',
      retryable: false,
      detail: detailOf(text, final?.index ?? 0),
    };
  return null;
}

// Whether a failure ends its run for good.
export function isFinalFailure(failure: Pick<RuntimeFailure, 'retryable'> | null | undefined) {
  return failure?.retryable === false;
}
