# ZipX x DSH plugin - P0 acceptance check. Exits 1 if any step fails.
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
# pnpm/node write banners to stderr; under "Stop" that becomes a terminating error.
$ErrorActionPreference = "Continue"
$DshRoot  = if ($env:ZIPX_DSH_ROOT) { $env:ZIPX_DSH_ROOT } else { "D:\DHS\deepseek-harness" }
$Profile  = if ($env:ZIPX_DSH_PROFILE) { $env:ZIPX_DSH_PROFILE } else { "web" }
$ProjectId = if ($env:ZIPX_PROJECT_ID) { $env:ZIPX_PROJECT_ID } else { "9c43e373-9ce6-4d72-b797-23b941541a7f" }
$Backend  = if ($env:ZIPX_BACKEND) { $env:ZIPX_BACKEND } else { "http://localhost:8000" }
$pkg = Split-Path -Parent $PSScriptRoot
$fail = 0

# 2026-11-13: node/pnpm exit codes were never checked here, so a script that printed
# one FAIL line and exited 1 was still reported as PASS (Out-Null swallowed the output).
# An acceptance script must be able to go red.
# NOTE: do not name this helper "Node" - a function named Node shadows the node.exe
# lookup inside its own body (PowerShell is case-insensitive), and $LASTEXITCODE stays null.
function RunNodeScript([string[]]$argv) {
  $out = (& node @argv 2>&1 | Out-String)
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    throw ("node " + ($argv -join " ") + " -> exit " + $code + [Environment]::NewLine + $out.Trim())
  }
  return $out
}

function Step($name, [scriptblock]$body) {
  try { & $body; Write-Host ("PASS  " + $name) }
  catch { $script:fail++; Write-Host ("FAIL  " + $name + " :: " + $_.Exception.Message) }
}

# 2026-11-13 (real machine): after a backend container restart uvicorn binds the port
# before the deep routes are ready. Step 6 (state) then passes while audit/E2E flakily fail
# with 'fetch failed', turning "backend is still booting" into "the plugin is broken".
# Wait for two consecutive /health 200s first; a timeout is a failed step, never a silent pass.
# NOTE: this file must stay ASCII-only (Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI).
Step "backend ready (/health twice, up to 90s)" {
  $deadline = (Get-Date).AddSeconds(90)
  $okCount = 0
  while ((Get-Date) -lt $deadline) {
    try {
      $h = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri ($Backend + "/health")
      if ($h.StatusCode -eq 200) { $okCount++ } else { $okCount = 0 }
    } catch { $okCount = 0 }
    if ($okCount -ge 2) { break }
    Start-Sleep -Seconds 3
  }
  if ($okCount -lt 2) { throw ("backend did not become healthy within 90s: " + $Backend + "/health") }
}

Step "build (zero-dependency type strip)" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/build.mjs") | Out-Null } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $pkg "lib/index.js"))) { throw "lib/index.js was not produced" }
}
Step "tool surface intact (34 tools + discoverability section)" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/check-tools.mjs") | Out-Null } finally { Pop-Location }
}
Step "skill surface mounted (zipx-creator reachable from the skill catalog)" {
  Push-Location $pkg
  try { RunNodeScript @("--import", "./scripts/register-stub.mjs", "scripts/check-skill.mjs") | Out-Null } finally { Pop-Location }
}
Step "network edges (409 human text / GET retry / no write retry)" {
  Push-Location $pkg
  try { RunNodeScript @("--import", "./scripts/register-stub.mjs", "scripts/check-net.mjs") | Out-Null } finally { Pop-Location }
}
Step "account proxy (token stays on the Host / sign-out invalidates)" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/check-account-route.mjs") | Out-Null } finally { Pop-Location }
}
Step "artifact visibility wiring (every step readable, incl. directing)" {
  docker exec zipx-backend python -m pytest /app/tests/test_artifact_visibility_wiring_nov2026.py -q 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "artifact visibility wiring test failed (directing or another asset type is unreadable)" }
}
Step "dispatch receipts honest (pipeline_fired on every async action)" {
  # 2026-11-16 真机：START_WORKFLOW 其实起跑了却判 blocked:dispatch_not_fired。
  docker exec zipx-backend python -m pytest /app/tests/test_async_action_dispatch_flag_nov2026.py -q 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "async action dispatch flag test failed (a started pipeline is reported as not dispatched)" }
}
Step "embedded Studio preview (one-time code -> 15-minute token)" {
  # 2026-11-16 B1: the panel embeds Studio's own step view in an iframe. The whole
  # feature rests on "browser never holds the long-lived token": host mints a
  # single-use code, the iframe trades it for a short-lived one. Both halves get a
  # red test here - the code unit tests, and the route actually being mounted.
  docker exec zipx-backend python -m pytest /app/tests/test_studio_embed_nov2026.py -q 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "studio embed credential test failed (one-time code or token lifetime regressed)" }
  $status = 0
  try {
    $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Method POST -Uri ($Backend + "/api/v3/director/embed/exchange") -ContentType "application/json" -Body '{"code":"verify-probe"}'
    $status = $probe.StatusCode
  } catch { $status = [int]$_.Exception.Response.StatusCode }
  # 404 = the endpoint answered "invalid code" (route is mounted). Anything else means
  # the endpoint is missing (404 from routing looks identical in HTTP but not in body,
  # so accept only a JSON body carrying code_invalid).
  if ($status -ne 404) { throw ("embed/exchange expected 404 for a bogus code, got " + $status) }
  Push-Location $pkg
  try {
    $bundle = Get-Content (Join-Path $pkg "lib/client.js") -Raw
    if ($bundle -notmatch "/zipx-embed/url") { throw "client bundle never calls /zipx-embed/url" }
    if ($bundle -notmatch "function StudioEmbed") { throw "client bundle has no StudioEmbed component" }
  } finally { Pop-Location }
}
Step "panel renders (minimal React render, no browser)" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/check-panel.mjs") | Out-Null } finally { Pop-Location }
}
Step "locale files match the panel dictionary" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/sync-locale.mjs", "--check") | Out-Null } finally { Pop-Location }
}
Step "bundle layer applied (dsh --dump-config)" {
  Push-Location $DshRoot
  try { $dump = & pnpm dsh --profile $Profile --dump-config 2>&1 | Out-String } finally { Pop-Location }
  if ($dump -notmatch "@zipx/dsh-plugin") { throw "@zipx/dsh-plugin is missing from the composed tree" }
  if ($dump -notmatch "zipx-tools") { throw "row zipx-tools is missing" }
}
Step "backend reachable and credential valid (real project state)" {
  $tokenFile = Join-Path $env:USERPROFILE ".zipx/dialogue-token.json"
  if (-not (Test-Path $tokenFile)) { throw "no pairing credential at $tokenFile (run scripts/pair.ts first)" }
  $token = (Get-Content $tokenFile -Raw | ConvertFrom-Json).token
  $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri ($Backend + "/api/v3/director/state/" + $ProjectId) -Headers @{ Authorization = ("Bearer " + $token) }
  $json = $res.Content | ConvertFrom-Json
  if (-not $json.current.step) { throw "state has no current.step" }
  Write-Host ("      step=" + $json.current.step + " gates=" + $json.gates.overall)
}
Step "market readiness (generator will accept this package)" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/check-market-ready.mjs") | Out-Null } finally { Pop-Location }
}
Step "distributable tarball" {
  Push-Location $pkg
  try { $out = & pnpm pack 2>&1 | Out-String } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw ("pnpm pack -> exit " + $LASTEXITCODE) }
  if ($out -notmatch "lib/index.js") { throw "tarball is missing lib/index.js" }
  if ($out -notmatch "cordis.patch.yml") { throw "tarball is missing cordis.patch.yml" }
}
Step "write-path E2E on a throwaway project (creates + deletes it)" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/e2e-write.mjs") | Out-Null } finally { Pop-Location }
}
Step "contract + render audit" {
  Push-Location $pkg
  try { RunNodeScript @("scripts/audit.mjs") | Out-Null } finally { Pop-Location }
}
if ($fail -gt 0) { Write-Host ""; Write-Host ("FAILED: " + $fail + " step(s)"); exit 1 }
Write-Host ""
Write-Host "P0 acceptance: all green"
