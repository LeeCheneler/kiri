import { Notice } from "../../design-system/feedback/notice.tsx";
import { useModels } from "../../state/sessions.ts";

/** Explains unavailable model providers beside the composer where models are selected. */
export function SessionProviderNotices() {
  const failures = useModels().data?.failures ?? [];
  if (failures.length === 0) return null;

  return (
    <div className="mb-4 space-y-3">
      {failures.map((failure) => (
        <Notice
          key={failure.provider}
          tone="negative"
          announce="polite"
          title={`${failure.provider} models unavailable`}
        >
          {failure.reason}
        </Notice>
      ))}
    </div>
  );
}
