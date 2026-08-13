import type { ReactElement, ReactNode } from "react";

import { I18nProvider } from "../i18n/I18nProvider";
import { useLayoutMode, useLayoutPreference } from "../layout/useLayoutMode";
import type { LayoutPreference } from "../layout/detectLayoutMode";
import { ThemeProvider } from "../theme/ThemeProvider";
import { TopBar, type TopBarActions } from "./TopBar";
import { useCommandKeys } from "./useCommandKeys";
import "./AppShell.css";

export interface AppShellProps extends TopBarActions {
  children: ReactNode;
  /**
   * Forces a layout. Absent, the shell detects one and lets whoever disagrees say so — the choice is
   * remembered. A host that pins this takes both away, which is what a test harness wants and what
   * an application should not do.
   */
  layoutPreference?: LayoutPreference;
}

export function AppShell({ children, layoutPreference, ...actions }: AppShellProps): ReactElement {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Frame layoutPreference={layoutPreference} actions={actions}>
          {children}
        </Frame>
      </I18nProvider>
    </ThemeProvider>
  );
}

function Frame({
  children,
  layoutPreference,
  actions,
}: {
  children: ReactNode;
  layoutPreference?: LayoutPreference;
  actions: TopBarActions;
}): ReactElement {
  // Undo, redo, save, open and export answer wherever the focus is, so they are handled here rather
  // than in the bar that shows them: a key that only worked while the header had the focus would be
  // a key nobody could reach.
  useCommandKeys(actions);
  const chosen = useLayoutPreference();
  const preference = layoutPreference ?? chosen.preference;
  const layout = useLayoutMode(preference);

  return (
    <div className="v-shell" data-layout={layout} data-testid="app-shell">
      <TopBar
        {...actions}
        compact={layout === "phone"}
        roomy={layout === "desktop"}
        layout={preference}
        onLayout={layoutPreference === undefined ? chosen.setPreference : undefined}
      />
      <main className="v-shell__content">{children}</main>
    </div>
  );
}
