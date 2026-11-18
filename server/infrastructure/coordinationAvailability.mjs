export function coordinationUnavailable(cause) {
  const error = new Error("Coordenacao distribuida indisponivel. Tente novamente em instantes.", { cause });
  error.code = "REDIS_REQUIRED";
  error.status = 503;
  error.expose = true;
  error.data = { code: error.code };
  return error;
}

export function redisCoordinationAvailable(runtime) {
  return runtime?.enabled === true
    && [runtime.client, runtime.publisher, runtime.subscriber].every((client) => client?.isReady === true);
}

export function createCoordinationGuard({ required, runtime, locks, rateLimiter }) {
  return () => {
    if (required && (!redisCoordinationAvailable(runtime) || !locks?.acquire || !rateLimiter?.consume)) {
      throw coordinationUnavailable();
    }
  };
}
