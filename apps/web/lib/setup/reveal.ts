import path from "node:path";

/** The command that shows a file in the system's file manager. */
export function revealCommand(
  platform: NodeJS.Platform,
  file: string,
): readonly [string, readonly string[]] {
  if (platform === "darwin") return ["open", ["-R", file]];
  // Separate arguments, so a space in the path is quoted without the switch.
  if (platform === "win32") return ["explorer.exe", ["/select,", file]];
  return ["xdg-open", [path.dirname(file)]];
}
