// The server answers in English; the reasons a change is refused that a person can act on are
// said in plain words (a key of `errors` in the matrix's messages), the rest as a general
// sentence.
export function previewErrorKey(message: string) {
  if (/npu class .* needs a passed eval/i.test(message)) return 'errors.npuClass' as const;
  if (/npu decision eval/i.test(message)) return 'errors.npuDecision' as const;
  if (/unknown agent|unknown project|unknown schema/i.test(message))
    return 'errors.unknown' as const;
  if (/invalid reasoning/i.test(message)) return 'errors.reasoning' as const;
  if (/is unavailable for|escalation model .* unavailable/i.test(message))
    return 'errors.modelUnavailable' as const;
  if (/needs a general role/i.test(message)) return 'errors.needsGeneral' as const;
  if (/still in use/i.test(message)) return 'errors.inUse' as const;
  if (/built-in schemas cannot/i.test(message)) return 'errors.builtIn' as const;
  if (/incomplete role|unknown role/i.test(message)) return 'errors.role' as const;
  if (/^invalid /i.test(message)) return 'errors.invalid' as const;
  return 'errors.rejected' as const;
}
