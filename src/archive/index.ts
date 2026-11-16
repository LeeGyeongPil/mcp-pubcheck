/** Minimal read-only view of an archive: entry names and lazy reads. */
export interface Archive {
  /** Entry names (files only), in archive order. */
  names(): string[];
  /** Contents of a file entry, or undefined when it does not exist. */
  read(name: string): Buffer | undefined;
}
