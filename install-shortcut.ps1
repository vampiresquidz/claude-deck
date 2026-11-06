# Creates "Claude Deck" shortcuts on your Desktop and in the Start Menu (so you can pin it to the taskbar).
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe  = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'build\icon.ico'
if (-not (Test-Path $exe)) { Write-Error 'Run "npm install" first.'; exit 1 }
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
  $lnk = $ws.CreateShortcut((Join-Path $dir 'Claude Deck.lnk'))
  $lnk.TargetPath = $exe
  $lnk.Arguments = '"' + $root + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = $icon
  $lnk.Description = 'Multi-session terminal manager for Claude Code'
  $lnk.Save()
  Write-Host "Created $($lnk.FullName)"
}
