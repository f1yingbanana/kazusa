#!/usr/bin/env node
/**
 * Builds an unsigned installer into `dist/` on a Mac: `node scripts/package.mjs
 * <win-x64|darwin-arm64> [version]`. Windows needs `brew install makensis`.
 * `.github/workflows/release.yml` runs this for tags. Beside the installer goes
 * a `.tar.gz` of the same files, which Settings → Updates downloads
 * (`scripts/update.mjs`).
 *
 * Only git-tracked files are staged, so a local world, its keys and `.env`
 * can't end up in a package. The repo's layout is kept because the world's
 * config and the plugin find each other by relative path.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const NODE_VERSION = process.version;

const TARGETS = {
  "win-x64": {
    os: "win32",
    cpu: "x64",
    archive: `node-${NODE_VERSION}-win-x64.zip`,
    nodeBinary: "node.exe",
    git: {
      asset: "windows-x64",
      sha256:
        "f1e17876337d7be143e5d51976da36643d65528125cfbc14d57f171de0fd5f14",
    },
    natives: [
      "@next/swc-win32-x64-msvc",
      "@openclaw/fs-safe-win32-x64-msvc",
      "@lydell/node-pty-win32-x64",
      "@koromix/koffi-win32-x64",
      "sqlite-vec-windows-x64",
    ],
  },
  "darwin-arm64": {
    os: "darwin",
    cpu: "arm64",
    archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeBinary: "bin/node",
    git: {
      asset: "macOS-arm64",
      sha256:
        "1110de343de11cc6f469b782b60f36217b9199b5e06875dd65baa26dd60563c7",
    },
    natives: ["@next/swc-darwin-arm64", "@openclaw/fs-safe-darwin-arm64"],
  },
};

// GitHub Desktop's portable git (github.com/desktop/dugite-native): built to
// run from any folder, for both systems. Pinned; each asset's sha256 is above.
const GIT_RELEASE =
  "https://github.com/desktop/dugite-native/releases/download/v2.56.0-2/dugite-native-v2.56.0-a44aeca";

const INCLUDED = [
  "package.json",
  "package-lock.json",
  "scripts/dev.mjs",
  "scripts/plugin-startup.mjs",
  "scripts/provider-keys.mjs",
  "scripts/system-agent.mjs",
  "scripts/update.mjs",
  "scripts/world-package.mjs",
  "scripts/world-repo.mjs",
  "apps/",
  "packages/",
  ".agents/skills/",
];
const EXCLUDED = [/\.test\.tsx?$/, /\.env\.example$/];
const WORKSPACE_LINKS = ["@kazusa/plugin", "@kazusa/web", "@openrp-ai/kazusa"];
// Windows refuses paths over 260 characters, and the install folder takes up to 70.
const LONGEST_PATH = 190;

/** Build workers and file indexers can still be letting go of a big folder. */
function removeTree(target) {
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}

function run(command, args, cwd, env = process.env) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

function stageTrackedFiles(stage) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0");
  for (const file of tracked) {
    if (!INCLUDED.some((prefix) => file === prefix || file.startsWith(prefix)))
      continue;
    if (EXCLUDED.some((pattern) => pattern.test(file))) continue;
    if (existsSync(path.join(ROOT, file)))
      cpSync(path.join(ROOT, file), path.join(stage, file));
  }
}

/** The web build needs dev tools and runs here, so it gets its own host install. */
function buildFrontend(stage) {
  run("npm", ["ci", "--no-audit", "--no-fund"], stage);
  run(
    "node",
    [path.join(stage, "node_modules/next/dist/bin/next"), "build"],
    path.join(stage, "apps/web"),
  );
  removeTree(path.join(stage, "apps/web/.next/cache"));
  removeTree(path.join(stage, "apps/web/.next/dev"));
  removeTree(path.join(stage, "node_modules"));
  for (const dir of ["apps/web/node_modules", "apps/kazusa/node_modules"])
    removeTree(path.join(stage, dir));
}

/** Scripts are skipped: they'd run here, for the wrong platform. */
function installForTarget(stage, target) {
  run(
    "npm",
    [
      "ci",
      "--omit=dev",
      `--os=${target.os}`,
      `--cpu=${target.cpu}`,
      "--ignore-scripts",
      "--no-bin-links",
      "--no-audit",
      "--no-fund",
    ],
    stage,
  );
  // Workspace symlinks don't survive an installer. Only the client is imported.
  const modules = path.join(stage, "node_modules");
  for (const link of WORKSPACE_LINKS)
    rmSync(path.join(modules, link), { force: true });
  rmSync(path.join(modules, "@kazusa/client"), { force: true });
  cpSync(
    path.join(stage, "packages/client"),
    path.join(modules, "@kazusa/client"),
    {
      recursive: true,
    },
  );
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

async function stageNode(stage, target) {
  const work = path.join(DIST, "node-download", target.archive);
  removeTree(work);
  mkdirSync(work, { recursive: true });
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const archive = path.join(work, target.archive);
  await download(`${base}/${target.archive}`, archive);
  await download(`${base}/SHASUMS256.txt`, path.join(work, "SHASUMS256.txt"));
  const expected = readFileSync(path.join(work, "SHASUMS256.txt"), "utf8")
    .split("\n")
    .find((line) => line.endsWith(`  ${target.archive}`))
    ?.split(" ")[0];
  const actual = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  if (!expected || actual !== expected)
    throw new Error(`Checksum mismatch for ${target.archive}.`);
  run("tar", ["-xf", archive, "-C", work], work);
  const folder = target.archive.replace(/\.(zip|tar\.gz)$/, "");
  const binary = path.basename(target.nodeBinary);
  cpSync(
    path.join(work, folder, target.nodeBinary),
    path.join(stage, "node", binary),
  );
}

/**
 * Git Credential Manager (a .NET app with its own UI) and Git LFS: most of the
 * download, and nothing a world's repository uses. git itself links none of
 * their libraries.
 */
function isGitExtra(name, isDirectory) {
  if (/^git-(credential-manager|lfs)/.test(name)) return true;
  if (isDirectory) return /^[a-z]{2}(-[A-Za-z]+)?$/.test(name);
  return (
    /^([A-Z].*|mscorlib|netstandard)\.dll$/.test(name) ||
    /\.(dylib|pdb)$/.test(name) ||
    /^(gcmcore|av_libglesv2|msalruntime|libSkiaSharp|libHarfBuzzSharp)\.dll$/.test(
      name,
    ) ||
    /\.(deps|runtimeconfig)\.json$/.test(name) ||
    ["NOTICE", "createdump", "uninstall.sh"].includes(name)
  );
}

async function stageGit(stage, target) {
  const work = path.join(DIST, "git-download", target.git.asset);
  removeTree(work);
  mkdirSync(work, { recursive: true });
  const archive = path.join(work, "git.tar.gz");
  await download(`${GIT_RELEASE}-${target.git.asset}.tar.gz`, archive);
  const actual = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  if (actual !== target.git.sha256)
    throw new Error(`Checksum mismatch for git (${target.git.asset}).`);
  const git = path.join(stage, "git");
  mkdirSync(git);
  run("tar", ["-xzf", archive, "-C", git], work);
  const extras =
    target.os === "win32"
      ? ["ucrt64/bin", "ucrt64/libexec/git-core"]
      : ["libexec/git-core"];
  for (const dir of extras)
    for (const entry of readdirSync(path.join(git, dir), {
      withFileTypes: true,
    }))
      if (isGitExtra(entry.name, entry.isDirectory()))
        removeTree(path.join(git, dir, entry.name));
}

/**
 * Each template's mock remote, built from this checkout's history: an installed
 * copy has none to build from. Run from the stage, whose `node_modules` has
 * simple-git.
 */
async function stageRemotes(stage) {
  const { buildRemotes, REMOTES } = await import(
    pathToFileURL(path.join(stage, "scripts/world-repo.mjs")).href
  );
  for (const line of await buildRemotes(ROOT, path.join(stage, REMOTES)))
    console.log(line);
}

function allFiles(stage) {
  return readdirSync(stage, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      path.relative(stage, path.join(entry.parentPath, entry.name)),
    );
}

function verify(stage, target) {
  const files = allFiles(stage);
  const secrets = files.filter(
    (file) =>
      !file.includes("node_modules/") &&
      /(^|\/)(\.env[^/]*|\.state\/.*|openclaw\.json[^/]*)$|^apps\/kazusa\/world\//.test(
        file,
      ),
  );
  if (secrets.length)
    throw new Error(`Would ship local state: ${secrets.join(", ")}`);
  // A Mac's git links its commands to itself; only Windows can't keep links.
  const links = readdirSync(stage, {
    recursive: true,
    withFileTypes: true,
  }).filter(
    (entry) =>
      entry.isSymbolicLink() &&
      !(
        target.os === "darwin" &&
        path.relative(stage, entry.parentPath).startsWith(`git${path.sep}`)
      ),
  );
  if (links.length)
    throw new Error(
      `Symlinks left: ${links.map((link) => path.join(link.parentPath, link.name)).join(", ")}`,
    );
  const missing = target.natives.filter(
    (name) => !existsSync(path.join(stage, "node_modules", name)),
  );
  if (missing.length)
    throw new Error(`Missing native packages: ${missing.join(", ")}`);
  const longest = files.reduce((a, b) => (b.length > a.length ? b : a), "");
  console.log(
    `\n${files.length} files. Longest path is ${longest.length} characters.`,
  );
  if (longest.length > LONGEST_PATH)
    throw new Error(`Path too long for Windows: ${longest}`);
}

function buildInstaller(stage, version) {
  const script = path.join(DIST, "kazusa.nsi");
  const output = path.join(DIST, `Kazusa-Setup-${version}.exe`);
  const launch = `/k ""$INSTDIR\\node\\node.exe" "$INSTDIR\\scripts\\dev.mjs" --packaged"`;
  const uninstallKey =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Kazusa";
  // Per-user, so no admin prompt. An update defaults to the folder already in
  // use. A chosen folder may hold other things, so only what's installed is ever
  // removed. `cmd /k` keeps the window open to show any error.
  writeFileSync(
    script,
    `Unicode true
Name "Kazusa"
OutFile "${output}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\\Programs\\Kazusa"
InstallDirRegKey HKCU "${uninstallKey}" "InstallLocation"
SetCompressor /SOLID lzma
ShowInstDetails nevershow
DirText "Kazusa and your world will be kept in this folder. To update, keep the folder you installed to: your world stays as it is."
Page directory "" "" CheckFolder
Page instfiles
UninstPage instfiles

; Nothing can be replaced or removed while it's running.
!macro WaitUntilStopped
  retry:
  IfFileExists "$INSTDIR\\node\\node.exe" 0 stopped
  ClearErrors
  FileOpen $0 "$INSTDIR\\node\\node.exe" a
  IfErrors 0 closeNode
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Kazusa is still running. Press Ctrl+C in its window and wait for it to finish, then choose Retry." /SD IDCANCEL IDRETRY retry
  Abort "Kazusa is still running."
  closeNode:
  FileClose $0
  stopped:
!macroend

; Everything but the player's world, in apps\\kazusa\\world.
!macro RemoveAppFiles
  RMDir /r "$INSTDIR\\node"
  RMDir /r "$INSTDIR\\git"
  RMDir /r "$INSTDIR\\node_modules"
  RMDir /r "$INSTDIR\\scripts"
  RMDir /r "$INSTDIR\\packages"
  RMDir /r "$INSTDIR\\.agents"
  RMDir /r "$INSTDIR\\.update"
  RMDir /r "$INSTDIR\\apps\\web"
  RMDir /r "$INSTDIR\\apps\\kazusa\\plugins"
  RMDir /r "$INSTDIR\\apps\\kazusa\\shared"
  RMDir /r "$INSTDIR\\apps\\kazusa\\worlds"
  RMDir /r "$INSTDIR\\apps\\kazusa\\.remotes"
  Delete "$INSTDIR\\apps\\kazusa\\package.json"
  Delete "$INSTDIR\\package.json"
  Delete "$INSTDIR\\package-lock.json"
  Delete "$INSTDIR\\VERSION"
!macroend

Function CheckFolder
  ; Its own folder, wherever the player points, so nothing mixes with their files.
  StrCpy $0 $INSTDIR "" -7
  StrCmp $0 "\\Kazusa" named
  StrCpy $INSTDIR "$INSTDIR\\Kazusa"
  named:
  StrLen $0 $INSTDIR
  IntCmp $0 ${260 - LONGEST_PATH} shortEnough shortEnough
  MessageBox MB_ICONEXCLAMATION "That folder's path is too long for Windows. Choose one closer to the top of the drive."
  Abort
  shortEnough:
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\\.kazusa-write-test" w
  IfErrors 0 writable
  MessageBox MB_ICONEXCLAMATION "Kazusa can't write to that folder, and it needs to keep your world there. Choose a folder in your user account."
  Abort
  writable:
  FileClose $0
  Delete "$INSTDIR\\.kazusa-write-test"
FunctionEnd

Section
  !insertmacro WaitUntilStopped
  !insertmacro RemoveAppFiles
  SetOutPath "$INSTDIR"
  File /r "${stage}/*.*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\\Kazusa.lnk" "$SYSDIR\\cmd.exe" '${launch}'
  CreateShortcut "$DESKTOP\\Kazusa.lnk" "$SYSDIR\\cmd.exe" '${launch}'
  WriteRegStr HKCU "${uninstallKey}" "DisplayName" "Kazusa"
  WriteRegStr HKCU "${uninstallKey}" "DisplayVersion" "${version}"
  WriteRegStr HKCU "${uninstallKey}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${uninstallKey}" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
SectionEnd

Section Uninstall
  !insertmacro WaitUntilStopped
  !insertmacro RemoveAppFiles
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your world and its API keys? This can't be undone." /SD IDNO IDNO keepWorld
  RMDir /r "$INSTDIR\\apps\\kazusa\\world"
  keepWorld:
  Delete "$SMPROGRAMS\\Kazusa.lnk"
  Delete "$DESKTOP\\Kazusa.lnk"
  DeleteRegKey HKCU "${uninstallKey}"
  Delete "$INSTDIR\\Uninstall.exe"
  ; Only empty folders go: a kept world, or anything else in them, stays.
  RMDir "$INSTDIR\\apps\\kazusa"
  RMDir "$INSTDIR\\apps"
  RMDir "$INSTDIR"
SectionEnd
`,
  );
  // Homebrew's makensis 3.13 dies with bad_alloc without a UTF-8 locale.
  run("makensis", ["-V2", script], DIST, {
    ...process.env,
    LC_ALL: "en_US.UTF-8",
  });
  return output;
}

/**
 * Finder gives an app no terminal, and a downloaded unsigned app may run from a
 * read-only copy. So the app copies itself to a folder of the player's and runs
 * in Terminal from there, which also keeps the world safe when the app is
 * replaced. Quarantine is cleared on that copy because the player has approved
 * the app by then, and native modules can't load with it set. The copy is made
 * again only for a different app: Settings can update the copy past the app.
 */
function launcherScript() {
  return `#!/bin/bash
set -e
bundle="$(cd "$(dirname "$0")/../Resources/kazusa" && pwd)"
home="$HOME/Library/Application Support/Kazusa"
command="$home/Kazusa.command"
mkdir -p "$home"
cat > "$command" <<EOF
#!/bin/bash
set -e
cd "$home"
if [ -f "$bundle/VERSION" ] && ! cmp -s "$bundle/VERSION" .bundle-version; then
  echo "Setting up Kazusa. This takes a minute, once per version."
  rsync -a --delete --exclude /apps/kazusa/world/ --exclude /.update/ --exclude /.bundle-version --exclude /Kazusa.command "$bundle/" ./
  xattr -dr com.apple.quarantine . 2>/dev/null || true
  cp "$bundle/VERSION" .bundle-version
fi
exec ./node/node scripts/dev.mjs --packaged
EOF
chmod +x "$command"
open -a Terminal "$command"
`;
}

/** What an installed copy updates from: the installer's files, nothing else. */
function buildArchive(stage, name, version) {
  const output = path.join(DIST, `Kazusa-${version}-${name}.tar.gz`);
  // No AppleDouble `._` files or extended attributes, which Windows would unpack.
  run("tar", ["--no-xattrs", "-czf", output, "-C", stage, "."], DIST, {
    ...process.env,
    COPYFILE_DISABLE: "1",
  });
  console.log(`\nBuilt ${output}`);
}

function buildDiskImage(stage, version) {
  const root = path.join(DIST, "dmg-root");
  const contents = path.join(root, "Kazusa.app/Contents");
  const output = path.join(DIST, `Kazusa-${version}-mac-arm64.dmg`);
  removeTree(root);
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  mkdirSync(path.join(contents, "Resources"));
  renameSync(stage, path.join(contents, "Resources/kazusa"));
  writeFileSync(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Kazusa</string>
  <key>CFBundleIdentifier</key><string>ai.openrp.kazusa</string>
  <key>CFBundleName</key><string>Kazusa</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
</dict>
</plist>
`,
  );
  const launcher = path.join(contents, "MacOS/Kazusa");
  writeFileSync(launcher, launcherScript());
  chmodSync(launcher, 0o755);
  symlinkSync("/Applications", path.join(root, "Applications"));
  run(
    "hdiutil",
    [
      "create",
      "-volname",
      "Kazusa",
      "-srcfolder",
      root,
      "-ov",
      "-format",
      "UDZO",
      output,
    ],
    DIST,
  );
  removeTree(root);
  return output;
}

const name = process.argv[2] ?? "win-x64";
const target = TARGETS[name];
if (!target)
  throw new Error(
    `Unknown target ${name}. Use: ${Object.keys(TARGETS).join(", ")}`,
  );
const version =
  process.argv[3] ??
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const stage = path.join(DIST, `kazusa-${name}`);
removeTree(stage);
mkdirSync(stage, { recursive: true });

stageTrackedFiles(stage);
buildFrontend(stage);
installForTarget(stage, target);
await stageNode(stage, target);
await stageGit(stage, target);
await stageRemotes(stage);
writeFileSync(path.join(stage, "VERSION"), `${version}\n`);
verify(stage, target);
buildArchive(stage, name, version);
const build = target.os === "win32" ? buildInstaller : buildDiskImage;
console.log(`\nBuilt ${build(stage, version)}`);
