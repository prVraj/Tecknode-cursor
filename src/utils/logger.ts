type Meta = Record<string, unknown>;

export type Logger = {
  debug: (message: string, meta?: Meta) => void;
  info: (message: string, meta?: Meta) => void;
  warn: (message: string, meta?: Meta) => void;
  error: (message: string, meta?: Meta) => void;
  withContext: (base: Meta) => Logger;
};

// Minimal structured console logger. Kept dependency-free on purpose — the
// RunAgents source wires PostHog/OpenTelemetry here, which is out of scope for
// this foundation. `withContext` returns a child logger that merges base
// attributes into every subsequent call so server actions can attach
// `user.id`/action name once. `debug` is a no-op unless `DEBUG_LOGS=true`, so
// the signal engine's high-frequency cache-hit logging doesn't flood stdout
// by default.
function makeLogger(base: Meta): Logger {
  const emit = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta?: Meta,
  ) => {
    if (level === "debug" && process.env.DEBUG_LOGS !== "true") return;
    const payload = { ...base, ...meta };
    if (level === "error") console.error(message, payload);
    else if (level === "warn") console.warn(message, payload);
    else console.info(message, payload);
  };

  return {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    withContext: (extra) => makeLogger({ ...base, ...extra }),
  };
}

const logger = makeLogger({});

export default logger;
