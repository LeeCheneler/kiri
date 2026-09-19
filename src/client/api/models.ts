import type { ModelsResult } from "../../shared/api/models.ts";
import { apiFetch, json } from "./http.ts";

/** Fetch the models every configured provider offers. Throws on non-2xx. */
export const fetchModels = async (): Promise<ModelsResult> =>
  json<ModelsResult>(await apiFetch("/api/models"));
