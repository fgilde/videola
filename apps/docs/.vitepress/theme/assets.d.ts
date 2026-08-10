declare module "*.css";

// A single-file component has no types of its own to import; the compiler only needs to know that
// the module resolves to something a Vue app can register.
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
