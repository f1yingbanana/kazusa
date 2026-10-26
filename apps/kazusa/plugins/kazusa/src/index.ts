import { createDecisionContextAssembler } from "./context-engine/decision-sources.ts";
import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { registerClock } from "./clock/register.ts";
import { registerContextEngine } from "./context-engine/register.ts";
import { registerPerception } from "./perception/register.ts";
import { registerTaskman } from "./taskman/register.ts";
import { registerMessaging } from "./messaging/register.ts";

export default definePluginEntry({
  id: "kazusa",
  name: "Kazusa",
  description: "Core simulation plugin for Kazusa roleplay agents",
  register(api: OpenClawPluginApi): void {
    const clock = registerClock(api);
    registerTaskman(api, { clock });
    registerContextEngine(api, { clock });
    const assembleDecisionContext = createDecisionContextAssembler(api, {
      clock,
    });
    const perception = registerPerception(api, {
      clock,
      assembleDecisionContext,
    });
    registerMessaging(api, { clock, perception });
  },
});
