import type { ModelShortcuts } from "../../api.ts";
import type { ComboboxGroup, ComboboxItem } from "../../design-system/actions/combobox.tsx";

/**
 * A modality's configured shortcuts as the picker's pinned "kiri" group — the
 * shortcut name alone as the label, its configured model id as the committed
 * value, in config order. Absent or empty shortcuts pin nothing.
 */
export const shortcutGroup = (shortcuts: ModelShortcuts | undefined): ComboboxGroup[] => {
  const entries = Object.entries(shortcuts ?? {});
  return entries.length > 0
    ? [{ label: "kiri", options: entries.map(([name, id]) => ({ value: id, label: name })) }]
    : [];
};

/**
 * The model listing as one picker group per provider, providers and models
 * sorted. The group heading names the provider, so each option's label drops
 * the `provider:` prefix; committed values stay the full ids.
 */
export const providerGroups = (ids: readonly string[]): ComboboxGroup[] => {
  const byProvider = new Map<string, ComboboxItem[]>();
  const sorted = [...ids].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const id of sorted) {
    const split = id.indexOf(":");
    const provider = split === -1 ? id : id.slice(0, split);
    const item = { value: id, label: split === -1 ? id : id.slice(split + 1) };
    const items = byProvider.get(provider);
    if (items) items.push(item);
    else byProvider.set(provider, [item]);
  }
  // Ids were sorted up front, so each provider's items are already in order
  // and the providers surface in first-appearance (sorted) order.
  return [...byProvider.entries()].map(([provider, options]) => ({ label: provider, options }));
};
