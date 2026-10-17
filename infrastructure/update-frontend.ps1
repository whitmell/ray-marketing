. (Join-Path $PSScriptRoot '_common.ps1')

$outputs = Get-StackOutputs
Write-FrontendConfig $outputs
Publish-Frontend $outputs
