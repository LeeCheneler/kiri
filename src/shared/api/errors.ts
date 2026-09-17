/** HTTP failure, optionally carrying field-level validation issues. */
export interface ApiErrorBody {
  error: string;
  issues?: { path: (string | number)[]; message: string }[];
}
/** Error stored with a failed workflow run or step. */
export interface ExecutionError {
  message: string;
  stack?: string;
}
