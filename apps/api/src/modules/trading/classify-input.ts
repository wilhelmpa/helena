import type { Static } from 'elysia';
import type { classifyBody } from './model';
import { HttpError } from '#shared/lib';

// Elysia's parent application normalizes extra object keys before validation.
// Reject mixed/unknown input before that cleanup can erase a privacy declaration.
export function assertClassificationShape(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const input = body as Record<string, unknown>;
  const publicInput = 'publicNews' in input;
  const allowed = publicInput ? ['kind', 'publicNews'] : ['kind', 'context', 'rule'];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new HttpError(400, 'Use either publicNews or legacy context, without additional fields.');
  const news = input.publicNews;
  if (
    publicInput &&
    news &&
    typeof news === 'object' &&
    !Array.isArray(news) &&
    Object.keys(news).some(
      (key) => !['articleText', 'instruments', 'publicDataConfirmed'].includes(key),
    )
  )
    throw new HttpError(
      400,
      'Public news accepts only articleText, instruments and publicDataConfirmed.',
    );
}

export function classificationInput(body: Static<typeof classifyBody>) {
  if ('publicNews' in body) {
    // Deliberately construct a new allowlisted payload. Confirmation authorizes
    // the caller's supplied public data; it does not verify the article's origin.
    return {
      context: {
        articleText: body.publicNews.articleText,
        instruments: [...body.publicNews.instruments],
      },
      localOnly: false,
      rule: undefined,
    };
  }
  return { context: body.context, localOnly: true, rule: body.rule };
}
