# Shared helpers, dot-sourced by the other infrastructure scripts.
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Load .env from the project root into process environment variables
$envFile = Join-Path $ProjectRoot '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*([^#\s][^=]*)=(.*)$') { [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process') } }
}

$Region = if ($env:AWS_REGION) { $env:AWS_REGION } else { 'us-east-1' }
$StackName = if ($env:STACK_NAME) { $env:STACK_NAME } else { 'ray-marketing' }
$DomainName = if ($env:DOMAIN_NAME) { $env:DOMAIN_NAME } else { 'marketing.raymatthews.com' }
$env:AWS_DEFAULT_REGION = $Region

function Invoke-Aws {
    & aws @args
    if ($LASTEXITCODE -ne 0) {
        $cmd = if ($args.Count -ge 2) { "$($args[0]) $($args[1])" } else { "$($args[0])" }
        throw "aws $cmd failed (exit $LASTEXITCODE)"
    }
}

function Get-StackOutputs {
    $json = & aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs' --output json
    if ($LASTEXITCODE -ne 0) { throw "Could not read outputs for stack $StackName" }
    $map = @{}
    foreach ($o in ($json | ConvertFrom-Json)) { $map[$o.OutputKey] = $o.OutputValue }
    return $map
}

function Write-FrontendConfig($Outputs) {
    $cfg = [ordered]@{
        cognitoClientId = $Outputs.CognitoClientId
        cognitoDomain   = "https://$($Outputs.CognitoDomain)"
        redirectUri     = "https://$DomainName/"
        apiBase         = ''
        pipelineBase    = $Outputs.PipelineFunctionUrl
    }
    $body = 'window.__CONFIG__ = ' + ($cfg | ConvertTo-Json) + ";`n"
    Set-Content -Path (Join-Path $ProjectRoot 'frontend\config.js') -Value $body -Encoding utf8
    Write-Host 'Wrote frontend/config.js'
}

function Publish-Frontend($Outputs) {
    Invoke-Aws s3 sync (Join-Path $ProjectRoot 'frontend') "s3://$($Outputs.FrontendBucketName)/" --delete
    Invoke-Aws cloudfront create-invalidation --distribution-id $Outputs.CloudFrontDistributionId --paths '/*' | Out-Null
    Write-Host 'Frontend synced and CloudFront invalidated.'
}

function Publish-Lambdas($Outputs) {
    $bucket = $Outputs.ResourcesBucketName
    $targets = @(
        @{ Name = 'api-handler'; Function = $Outputs.ApiLambdaName },
        @{ Name = 'pipeline-handler'; Function = $Outputs.PipelineLambdaName }
    )
    foreach ($t in $targets) {
        $zip = Join-Path $ProjectRoot "dist\$($t.Name).zip"
        $key = "deploy/$($t.Name).zip"
        Invoke-Aws s3 cp $zip "s3://$bucket/$key"
        Invoke-Aws lambda update-function-code --function-name $t.Function --s3-bucket $bucket --s3-key $key | Out-Null
        Write-Host "Updated Lambda $($t.Function)"
    }
}
