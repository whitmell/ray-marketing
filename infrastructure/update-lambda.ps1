. (Join-Path $PSScriptRoot '_common.ps1')

& (Join-Path $PSScriptRoot 'build-lambda.ps1')
Publish-Lambdas (Get-StackOutputs)
