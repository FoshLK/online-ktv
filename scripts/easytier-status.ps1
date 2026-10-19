[CmdletBinding()]
param(
    [string]$BinaryPath,
    [string]$RpcPortal = "127.0.0.1:15888"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BinaryPath)) {
    $repositoryRoot = Split-Path -Parent $PSScriptRoot
    $BinaryPath = Join-Path $repositoryRoot "data\easytier-v2.6.4\easytier-windows-x86_64\easytier-cli.exe"
}
if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    throw "easytier-cli.exe was not found. Run npm run easytier:start first or pass -BinaryPath."
}

$cliPath = (Resolve-Path -LiteralPath $BinaryPath).Path
Write-Host "Node status"
& $cliPath --rpc-portal $RpcPortal node
if ($LASTEXITCODE -ne 0) { throw "Could not connect to EasyTier RPC at $RpcPortal." }
Write-Host "Peers"
& $cliPath --rpc-portal $RpcPortal peer
if ($LASTEXITCODE -ne 0) { throw "Could not read EasyTier peers." }
Write-Host "Routes"
& $cliPath --rpc-portal $RpcPortal route
if ($LASTEXITCODE -ne 0) { throw "Could not read EasyTier routes." }
