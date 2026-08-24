function baseEnvelope(status, summary, data, nextActions = [], artifacts = []) {
  return {
    status,
    summary,
    data: data ?? {},
    next_actions: nextActions,
    artifacts,
  }
}

export function successEnvelope(summary, data = {}, nextActions = [], artifacts = []) {
  return baseEnvelope('success', summary, data, nextActions, artifacts)
}

export function warningEnvelope(summary, data = {}, nextActions = [], artifacts = []) {
  return baseEnvelope('warning', summary, data, nextActions, artifacts)
}

export function errorEnvelope(code, summary, options = {}) {
  return {
    ...baseEnvelope('error', summary, options.data ?? {}, options.nextActions ?? [], options.artifacts ?? []),
    error: {
      code,
      retryable: options.retryable === true,
      root_cause_hint: options.rootCauseHint || '',
      safe_retry: options.safeRetry || '',
      stop_condition: options.stopCondition || '',
    },
  }
}

export function withMeta(envelope, meta) {
  return { ...envelope, meta: { ...meta } }
}
