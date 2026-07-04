import type { WorkflowSummary } from "../../api.ts";
import { type TabDef, Tabs } from "../../design-system/navigation/tabs.tsx";
import { ArticlesSpec } from "./articles-spec.tsx";
import { InputsSpec } from "./inputs-spec.tsx";
import { Runs } from "./runs.tsx";
import { SchemaSpec } from "./schema-spec.tsx";

/**
 * The workflow detail tab strip: the workflow's runs, its declared inputs,
 * what it publishes, and its pipeline schema. Built on the design-system
 * `Tabs`, so the active tab deep-links to the URL.
 */
export function WorkflowDetails({ workflow }: { workflow: WorkflowSummary }) {
  const tabs: TabDef[] = [
    { id: "runs", label: "Runs", content: <Runs workflowName={workflow.name} /> },
    { id: "inputs", label: "Inputs", content: <InputsSpec inputs={workflow.inputs} /> },
    { id: "publishes", label: "Publishes", content: <ArticlesSpec entries={workflow.articles} /> },
    {
      id: "schema",
      label: "Schema",
      content: (
        <SchemaSpec
          steps={workflow.steps}
          articles={workflow.articles}
          summarize={workflow.summarize}
        />
      ),
    },
  ];
  return <Tabs tabs={tabs} label="Workflow details" />;
}
