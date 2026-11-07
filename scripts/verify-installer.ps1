# Installs, updates, runs and uninstalls Kazusa on a real Windows machine, for
# .github/workflows/release.yml. A failure stops the release.
param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$Web = 'http://127.0.0.1:3000'
$Folder = Join-Path $env:RUNNER_TEMP 'Kazusa Test\Kazusa'
$World = Join-Path $Folder 'apps\kazusa\world'

function Assert($condition, [string]$what) {
  if (-not $condition) { throw "Failed: $what" }
  Write-Host "OK: $what"
}

function Run-Silently([string]$file, [string[]]$arguments) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru
  Assert ($process.ExitCode -eq 0) "$(Split-Path $file -Leaf) exited with 0"
}

function Wait-Until([scriptblock]$ready, [string]$what, [int]$seconds = 180) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { if (& $ready) { Write-Host "OK: $what"; return } } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Timed out: $what"
}

# /D has to come last, and unquoted even with a space in it.
Run-Silently $Installer @('/S', "/D=$Folder")
Assert (Test-Path (Join-Path $Folder 'node\node.exe')) 'installed to the chosen folder'
Assert (Test-Path (Join-Path $Folder 'Kazusa.cmd')) 'bundled Windows launcher'
Assert (Test-Path (Join-Path $Folder 'Kazusa.ico')) 'bundled app icon'
Assert (Test-Path (Join-Path $Folder 'git\cmd\git.exe')) 'bundled Git'
Assert (Test-Path (Join-Path $Folder 'apps\kazusa\world-sources.json')) 'bundled world sources'

New-Item -ItemType Directory -Force -Path $World | Out-Null
Set-Content (Join-Path $World 'kept.txt') 'mine'
Set-Content (Join-Path $Folder 'scripts\from-an-old-version.txt') 'stale'
New-Item -ItemType Directory -Force -Path (Join-Path $Folder 'node_modules\from-an-old-version') | Out-Null

# Without /D, an update has to find the folder for itself.
Run-Silently $Installer @('/S')
Assert (Test-Path (Join-Path $World 'kept.txt')) 'an update keeps the world'
Assert (-not (Test-Path (Join-Path $Folder 'scripts\from-an-old-version.txt'))) 'an update removes old scripts'
Assert (-not (Test-Path (Join-Path $Folder 'node_modules\from-an-old-version'))) 'an update removes old packages'
Remove-Item -Recurse -Force $World

# Read both real shortcuts, so packaging and quoting are part of this test.
$shell = New-Object -ComObject WScript.Shell
foreach ($location in 'DesktopDirectory', 'Programs') {
  $shortcutPath = Join-Path ([Environment]::GetFolderPath($location)) 'Kazusa.lnk'
  Assert (Test-Path $shortcutPath) "$location shortcut exists"
  $shortcut = $shell.CreateShortcut($shortcutPath)
  Assert ((Split-Path $shortcut.TargetPath -Leaf) -eq 'cmd.exe') "$location shortcut opens a terminal"
  Assert ($shortcut.Arguments.Contains((Join-Path $Folder 'Kazusa.cmd'))) "$location shortcut runs the installed launcher"
  Assert ($shortcut.Arguments -match '(?i)(^|\s)/d(\s|$)') "$location shortcut skips shell AutoRun"
  Assert ($shortcut.Arguments -match '(?i)(^|\s)/v:off(\s|$)') "$location shortcut disables delayed expansion"
  Assert ($shortcut.WorkingDirectory -eq $Folder) "$location shortcut starts in the install folder"
  Assert (($shortcut.IconLocation -replace ',\s*0$', '').Trim('"') -eq (Join-Path $Folder 'Kazusa.ico')) "$location shortcut uses the app icon"
}
$displayIcon = Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Kazusa' -Name DisplayIcon
Assert (($displayIcon -replace ',\s*0$', '').Trim('"') -eq (Join-Path $Folder 'Kazusa.ico')) 'Installed Apps uses the app icon'

# Kept apart from the runner's own output, and shown only if a step fails:
# otherwise a failed start says no more than "Timed out".
$AppOut = Join-Path $env:RUNNER_TEMP 'kazusa-app.out.log'
$AppErr = Join-Path $env:RUNNER_TEMP 'kazusa-app.err.log'
# Execute the shortcut's exact command with redirected output. Shell-opening
# the .lnk cannot redirect its console. Deliberately start elsewhere: on CI,
# Windows is on C: and the installation is on D:, exercising cd /d as well.
Write-Host "Launching from $env:SystemRoot; installed in $Folder; TEMP=$env:TEMP"
$app = Start-Process -FilePath $shortcut.TargetPath `
  -ArgumentList $shortcut.Arguments -WorkingDirectory $env:SystemRoot -PassThru `
  -RedirectStandardOutput $AppOut -RedirectStandardError $AppErr
try {
  Wait-Until { (Invoke-WebRequest "$Web/" -UseBasicParsing).StatusCode -eq 200 } 'the frontend starts'
  Invoke-RestMethod "$Web/setup" -Method Post -ContentType 'application/json' -Body '{"world":"starter"}' | Out-Null
  Assert ((Get-Item (Join-Path $World 'workspaces\arona\.agents')).LinkType -eq 'Junction') 'setup links the guides'
  Assert (Test-Path (Join-Path $Folder 'apps\kazusa\worlds\starter\package.json')) 'setup cloned the starter world'
  Wait-Until { (Invoke-WebRequest "$Web/kazusa/world" -UseBasicParsing).StatusCode -eq 200 } 'the Gateway starts'
  Wait-Until {
    $chat = (Invoke-RestMethod "$Web/kazusa/chats").chats | Where-Object { $_.members -contains 'arona' }
    $chat.lastMessage.senderId -eq 'arona'
  } 'the welcome message arrives'
  Wait-Until {
    $models = Invoke-RestMethod "$Web/kazusa/models"
    $models.PSObject.Properties.Name -contains 'models'
  } 'Models returns JSON'
  Wait-Until {
    $providers = Invoke-RestMethod "$Web/kazusa/providers"
    $providers.PSObject.Properties.Name -contains 'providers'
  } 'Providers returns JSON'
  $loadErrors = Select-String -Path $AppOut, $AppErr -Pattern 'failed during (load|register) from|FsSafeError'
  Assert (-not $loadErrors) 'no plugin load or filesystem safety errors'
} catch {
  foreach ($log in $AppOut, $AppErr) {
    if (Test-Path $log) {
      Write-Host "--- Kazusa's $(Split-Path $log -Leaf), last 200 lines"
      Get-Content $log -Tail 200 | ForEach-Object { Write-Host $_ }
    }
  }
  if ($app.HasExited) { Write-Host "Kazusa exited with $($app.ExitCode)." }
  throw
} finally {
  # A runner has no console to send Ctrl+C to, and this world is thrown away.
  # A child can exit while the tree is being stopped, which taskkill calls an
  # error. The check below is what says whether everything stopped.
  & taskkill /T /F /PID $app.Id 2>&1 | Out-Null
  $global:LASTEXITCODE = 0
}

Wait-Until {
  $node = Join-Path $Folder 'node\node.exe'
  $stream = [IO.File]::Open($node, 'Open', 'ReadWrite', 'None')
  $stream.Close()
  $true
} 'everything has stopped' 60

Set-Content (Join-Path $World 'kept.txt') 'mine'
Run-Silently (Join-Path $Folder 'Uninstall.exe') @('/S')
Wait-Until { -not (Test-Path (Join-Path $Folder 'node')) } 'uninstalling removes the app'
Assert (-not (Test-Path (Join-Path $Folder 'Kazusa.cmd'))) 'uninstalling removes the launcher'
Assert (-not (Test-Path (Join-Path $Folder 'Kazusa.ico'))) 'uninstalling removes the icon'
Assert (Test-Path (Join-Path $World 'kept.txt')) 'uninstalling keeps the world unless asked'
