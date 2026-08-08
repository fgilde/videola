import type { ReactElement, ReactNode } from "react";

import { I18nProvider } from "../i18n/I18nProvider";
import { useLayoutMode } from "../layout/useLayoutMode";
import type { LayoutPreference } from "../layout/detectLayoutMode";
import { ThemeProvider } from "../theme/ThemeProvider";
import { TopBar, type TopBarActions } from "./TopBar";
import "./AppShell.css";

export interface AppShellProps extends TopBarActions {
  children: ReactNode;
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
  const layout = useLayoutMode(layoutPreference ?? "auto");

  return (
    <div className="v-shell" data-layout={layout} data-testid="app-shell">
      <TopBar {...actions} compact={layout === "phone"} />
      <main className="v-shell__content">{children}</main>
    </div>
  );
}
