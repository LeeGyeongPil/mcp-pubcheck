/** Bad invocation or unreadable input: the CLI exits with code 2. */
export class InputError extends Error {
  /** Language-neutral message key (looked up in the i18n tables by the CLI). */
  readonly key: string;
  readonly params: Record<string, string | number>;
  constructor(key: string, params: Record<string, string | number> = {}, fallback?: string) {
    super(fallback ?? `${key} ${JSON.stringify(params)}`);
    this.name = "InputError";
    this.key = key;
    this.params = params;
  }
}

/** An archive is corrupt or truncated. */
export class ArchiveError extends InputError {
  constructor(key: string, params: Record<string, string | number> = {}, fallback?: string) {
    super(key, params, fallback);
    this.name = "ArchiveError";
  }
}

/** An archive uses a feature this tool deliberately does not read (zip64, sparse tar, encryption). */
export class UnsupportedArchiveError extends ArchiveError {
  constructor(key: string, params: Record<string, string | number> = {}, fallback?: string) {
    super(key, params, fallback);
    this.name = "UnsupportedArchiveError";
  }
}

/** Run `fn`; archive errors are re-thrown with the offending file name attached. */
export function withFile<T>(file: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ArchiveError && e.params.file === undefined) {
      const params = { ...e.params, file };
      const msg = `${file}: ${e.message}`;
      throw e instanceof UnsupportedArchiveError ? new UnsupportedArchiveError(e.key, params, msg) : new ArchiveError(e.key, params, msg);
    }
    throw e;
  }
}
