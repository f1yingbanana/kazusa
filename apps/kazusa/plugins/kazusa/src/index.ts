import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { registerClock } from "./clock/register.ts";
import { registerContextEngine } from "./context-engine/register.ts";
import { registerTaskman } from "./taskman/register.ts";

export default definePluginEntry({
  id: "kazusa",
  name: "Kazusa",
  description: "Core simulation plugin for Kazusa roleplay agents",
  register(api: OpenClawPluginApi): void {
    const clock = registerClock(api);
    registerTaskman(api, { clock });
    registerContextEngine(api, { clock });
  },
});
