param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000,
  [ValidateRange(1, 60)]
  [int]$DebounceSeconds = 2
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $root ".local-deploy"
$nextCli = Join-Path $root "node_modules\next\dist\bin\next"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$script:serverProcess = $null

function Get-DeploymentSnapshot {
  $files = @()
  foreach ($directory in @("src", "prisma", "public")) {
    $path = Join-Path $root $directory
    if (Test-Path -LiteralPath $path -PathType Container) {
      $files += Get-ChildItem -LiteralPath $path -File -Recurse
    }
  }
  $files += Get-ChildItem -LiteralPath $root -File | Where-Object {
    $_.Name -match '^(package\.json|package-lock\.json|tsconfig\.json|next\.config\..+|postcss\.config\..+|eslint\.config\..+|vitest\.config\..+)$' -or
    $_.Name -match '^\.env(\..+)?$'
  }

  $snapshot = @{}
  foreach ($file in $files) {
    $snapshot[$file.FullName] = "$($file.LastWriteTimeUtc.Ticks):$($file.Length)"
  }
  return $snapshot
}

function Stop-LocalServer {
  if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
    Stop-Process -Id $script:serverProcess.Id -Force
    $script:serverProcess.WaitForExit()
  }
  $script:serverProcess = $null
}

function Start-LocalServer {
  $arguments = '"{0}" start --hostname 127.0.0.1 --port {1}' -f $nextCli, $Port
  $script:serverProcess = Start-Process -FilePath $node -ArgumentList $arguments `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDirectory "server.stdout.log") `
    -RedirectStandardError (Join-Path $logDirectory "server.stderr.log")

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    if ($script:serverProcess.HasExited) {
      throw "The local Next.js server exited during startup. Check .local-deploy\server.stderr.log."
    }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port" -TimeoutSec 2 | Out-Null
      Write-Host "Local production server is ready at http://127.0.0.1:$Port"
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "The local Next.js server did not become ready within 60 seconds."
}

function Deploy-Local {
  Stop-LocalServer
  Write-Host "Building the production app..."
  Push-Location $root
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
      throw "Production build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
  Start-LocalServer
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
try {
  Deploy-Local
  $snapshot = Get-DeploymentSnapshot
  $pendingChangeAt = $null
  Write-Host "Watching src, prisma, public, and build configuration. Press Ctrl+C to stop."

  while ($true) {
    Start-Sleep -Seconds 1
    if ($script:serverProcess.HasExited) {
      throw "The local Next.js server stopped unexpectedly. Check .local-deploy\server.stderr.log."
    }

    $currentSnapshot = Get-DeploymentSnapshot
    $changed = $currentSnapshot.Count -ne $snapshot.Count
    if (-not $changed) {
      foreach ($path in $currentSnapshot.Keys) {
        if (-not $snapshot.ContainsKey($path) -or $snapshot[$path] -ne $currentSnapshot[$path]) {
          $changed = $true
          break
        }
      }
    }

    if ($changed) {
      $pendingChangeAt = Get-Date
      $snapshot = $currentSnapshot
    } elseif ($pendingChangeAt -and ((Get-Date) - $pendingChangeAt).TotalSeconds -ge $DebounceSeconds) {
      Write-Host "Source changes detected; redeploying locally..."
      Deploy-Local
      $snapshot = Get-DeploymentSnapshot
      $pendingChangeAt = $null
    }
  }
} finally {
  Stop-LocalServer
}
