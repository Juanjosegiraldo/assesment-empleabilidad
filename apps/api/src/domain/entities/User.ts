/**
 * A person who can sign in and belong to channels.
 *
 * There is no passwordHash field here on purpose. The hash never leaves the
 * authentication path, so it has no place in the entity the rest of the system passes
 * around.
 */
export type User = {
  id: number;
  email: string;
  fullName: string;
  /** Injected into the copilot system prompt, so the assistant knows who it is talking to. */
  jobTitle: string;
  locale: Locale;
};

export type Locale = "es" | "en";

export const isLocale = (value: unknown): value is Locale => value === "es" || value === "en";
