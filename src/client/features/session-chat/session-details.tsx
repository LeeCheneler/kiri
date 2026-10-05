import { useState } from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { Drawer } from "../../design-system/surfaces/drawer.tsx";
import { useSessionChildren } from "../../state/sessions.ts";
import { SessionActions } from "./session-actions.tsx";
import { SessionAside } from "./session-aside.tsx";
import { SessionChildren } from "./session-children.tsx";

/** Opens session metadata, management actions and worker history without leaving the chat. */
export function SessionDetails({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const children = useSessionChildren(id).data ?? [];
  const waiting = children.filter((child) => child.status === "waiting").length;
  const running = children.filter((child) => child.status === "running").length;
  const activity = [
    waiting > 0 ? `${waiting} waiting` : null,
    running > 0 ? `${running} working` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Button variant="dismissive" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Details{activity ? ` · ${activity}` : ""}
      </Button>
      {open ? (
        <Drawer title="Session details" side="right" onClose={() => setOpen(false)}>
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain">
            <SessionAside id={id} />
            <SessionChildren id={id} />
          </div>
          <div className="mt-6 shrink-0 border-t border-rule pt-4">
            <SessionActions id={id} />
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
