[CmdletBinding()]
param(
    [string]$BinaryPath,
    [string]$NetworkName = $env:KTV_EASYTIER_NETWORK_NAME,
    [string]$Ipv4 = $env:KTV_EASYTIER_IPV4,
    [string[]]$Peer = @(),
    [string]$ExternalNode = $env:KTV_EASYTIER_EXTERNAL_NODE,
    [string]$Hostname = $env:COMPUTERNAME,
    [string]$InstanceName = "online-ktv",
    [string[]]$Listener = @(),
    [string]$RpcPortal = "127.0.0.1:15888",
    [switch]$Dhcp,
    [switch]$NoTun,
    [switch]$NoListener,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-EasyTierCore {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
            throw "EasyTier executable does not exist: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $repositoryRoot = Split-Path -Parent $PSScriptRoot
    $extractRoot = Join-Path $repositoryRoot "data\easytier-v2.6.4"
    $defaultPath = Join-Path $extractRoot "easytier-windows-x86_64\easytier-core.exe"
    if (-not (Test-Path -LiteralPath $defaultPath -PathType Leaf)) {
        $toolsDirectoryName = ([char]0x5DE5).ToString() + [char]0x5177
        $archivePath = Join-Path (Join-Path $repositoryRoot $toolsDirectoryName) "easytier-windows-x86_64-v2.6.4.zip"
        if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
            throw "EasyTier was not found. Put easytier-windows-x86_64-v2.6.4.zip in the repository tools directory or pass -BinaryPath."
        }
        New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
        Write-Host "Extracting EasyTier into the Git-ignored data directory..."
        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    }

    if (-not (Test-Path -LiteralPath $defaultPath -PathType Leaf)) {
        throw "The EasyTier archive layout was unexpected. Pass -BinaryPath to easytier-core.exe."
    }
    return (Resolve-Path -LiteralPath $defaultPath).Path
}

if ([string]::IsNullOrWhiteSpace($NetworkName)) {
    $NetworkName = $env:ET_NETWORK_NAME
}
if ([string]::IsNullOrWhiteSpace($NetworkName)) {
    throw "Network name is required. Set KTV_EASYTIER_NETWORK_NAME or pass -NetworkName."
}

if ($Peer.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($env:KTV_EASYTIER_PEERS)) {
    $Peer = @($env:KTV_EASYTIER_PEERS -split "\s*,\s*" | Where-Object { $_ })
}
if ($Listener.Count -eq 0 -and -not $NoListener) {
    if (-not [string]::IsNullOrWhiteSpace($env:KTV_EASYTIER_LISTENERS)) {
        $Listener = @($env:KTV_EASYTIER_LISTENERS -split "\s*,\s*" | Where-Object { $_ })
    } else {
        $Listener = @("tcp://0.0.0.0:11010", "udp://0.0.0.0:11010")
    }
}

if (-not $Dhcp -and -not $NoTun -and [string]::IsNullOrWhiteSpace($Ipv4)) {
    throw "Virtual IPv4 is required. Pass -Ipv4 (10.126.126.1 is recommended for the server) or use -Dhcp."
}

$networkSecret = if (-not [string]::IsNullOrWhiteSpace($env:KTV_EASYTIER_NETWORK_SECRET)) {
    $env:KTV_EASYTIER_NETWORK_SECRET
} elseif (-not [string]::IsNullOrWhiteSpace($env:ET_NETWORK_SECRET)) {
    $env:ET_NETWORK_SECRET
} else {
    if ($NonInteractive) {
        throw "Network secret is required. Set KTV_EASYTIER_NETWORK_SECRET in non-interactive mode."
    }
    $secureSecret = Read-Host "Enter the EasyTier network secret (hidden and not added to the command line)" -AsSecureString
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}
if ([string]::IsNullOrWhiteSpace($networkSecret)) {
    throw "EasyTier network secret cannot be empty."
}

$corePath = Resolve-EasyTierCore -RequestedPath $BinaryPath
$arguments = @(
    "--network-name", $NetworkName,
    "--hostname", $Hostname,
    "--instance-name", $InstanceName,
    "--rpc-portal", $RpcPortal,
    "--multi-thread", "true"
)
if ($Dhcp) {
    $arguments += @("--dhcp", "true")
} elseif (-not [string]::IsNullOrWhiteSpace($Ipv4)) {
    $arguments += @("--ipv4", $Ipv4)
}
if ($NoTun) { $arguments += @("--no-tun", "true") }
if ($NoListener) {
    $arguments += "--no-listener"
} elseif ($Listener.Count -gt 0) {
    $arguments += "--listeners"
    $arguments += $Listener
}
if ($Peer.Count -gt 0) {
    $arguments += "--peers"
    $arguments += $Peer
}
if (-not [string]::IsNullOrWhiteSpace($ExternalNode)) {
    $arguments += @("--external-node", $ExternalNode)
}
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $NoTun -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Warning "Creating a TUN adapter normally requires Administrator rights. Retry in an elevated PowerShell if startup fails."
    }
} catch {
    Write-Verbose "Could not inspect current PowerShell privileges: $($_.Exception.Message)"
}

$previousSecret = [Environment]::GetEnvironmentVariable("ET_NETWORK_SECRET", "Process")
try {
    [Environment]::SetEnvironmentVariable("ET_NETWORK_SECRET", $networkSecret, "Process")
    $addressLabel = if ($Dhcp) { "DHCP" } elseif ($NoTun -and [string]::IsNullOrWhiteSpace($Ipv4)) { "relay-only" } else { $Ipv4 }
    Write-Host "Starting EasyTier: network=$NetworkName, node=$Hostname, virtual-address=$addressLabel"
    Write-Host "RPC is restricted to $RpcPortal. The network secret is not present in the command line or log."
    & $corePath @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "EasyTier exited with code $LASTEXITCODE."
    }
} finally {
    [Environment]::SetEnvironmentVariable("ET_NETWORK_SECRET", $previousSecret, "Process")
    $networkSecret = $null
}
