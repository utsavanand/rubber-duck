import { initBotId } from "botid/client/core";

initBotId({
  protect: [{ path: "/api/code-download", method: "POST", advancedOptions: { checkLevel: "basic" } }],
});
