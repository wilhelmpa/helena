import { HostdError, hostd } from '#modules/server/hostd';
import { HttpError } from '#shared/lib';

export async function developmentOperation<T>(
  method: string,
  parameters: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await hostd<T>(method, parameters);
  } catch (error) {
    if (!(error instanceof HostdError)) throw error;
    const status =
      {
        InvalidParameter: 400,
        NotAllowed: 403,
        NotFound: 404,
        Busy: 409,
        Unavailable: 503,
        Timeout: 504,
      }[error.code] ?? 502;
    throw new HttpError(status, error.message);
  }
}
