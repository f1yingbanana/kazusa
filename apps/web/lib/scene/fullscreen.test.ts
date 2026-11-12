import { describe, expect, it } from "vitest";
import {
  canAskBrowser,
  modeAfterChange,
  type FullscreenMode,
} from "./fullscreen";

const request = () => Promise.resolve();

describe("canAskBrowser", () => {
  it.each<[string, { fullscreenEnabled?: boolean }, object, boolean]>([
    [
      "a desktop browser",
      { fullscreenEnabled: true },
      { requestFullscreen: request },
      true,
    ],
    [
      "one that doesn't say whether it may",
      {},
      { requestFullscreen: request },
      true,
    ],
    [
      "an iframe not allowed full screen",
      { fullscreenEnabled: false },
      { requestFullscreen: request },
      false,
    ],
    ["an iPhone: elements have no API", { fullscreenEnabled: true }, {}, false],
  ])("%s: %s", (_, doc, element, expected) => {
    expect(canAskBrowser(doc, element)).toBe(expected);
  });
});

describe("modeAfterChange", () => {
  it.each<[FullscreenMode, boolean, FullscreenMode]>([
    // The browser made the stage full screen.
    ["off", true, "browser"],
    ["browser", true, "browser"],
    // The browser left it: Escape, the system's gesture, another element.
    ["browser", false, "off"],
    // Someone else's change doesn't touch the app's own full window.
    ["window", false, "window"],
    ["off", false, "off"],
    // A browser that agrees late, after the app fell back.
    ["window", true, "browser"],
  ])("%s, the stage full screen %s: %s", (mode, ours, expected) => {
    expect(modeAfterChange(mode, ours)).toBe(expected);
  });
});
