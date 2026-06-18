import { tavily } from "@tavily/core";

/** Env var holding the Tavily API key. The Tavily-backed tools are offered only when it's set. */
export const TAVILY_API_KEY_ENV = "TAVILY_API_KEY";

/** A Tavily SDK client, built per call from the configured API key. */
export type TavilyClient = ReturnType<typeof tavily>;

/** Build a Tavily SDK client for the given API key. */
export const createTavilyClient = (apiKey: string): TavilyClient => tavily({ apiKey });

/** Coerce an untrusted external JSON field to a string, defaulting to "". */
export const asString = (value: unknown): string => (typeof value === "string" ? value : "");
