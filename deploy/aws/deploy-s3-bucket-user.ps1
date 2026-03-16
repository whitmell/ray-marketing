param(
    [string]$UserName = "rayphotog",
    [string]$BucketName = "ray-faa-images",
    [string]$StackName = "marketing-pipeline-s3-user",
    [string]$Region
)

$ErrorActionPreference = "Stop"

$templatePath = Join-Path -Path $PSScriptRoot -ChildPath "s3-bucket-user.yml"

if (-not (Test-Path -Path $templatePath)) {
    throw "Template not found at path: $templatePath"
}

$awsCommand = Get-Command aws -ErrorAction SilentlyContinue
if (-not $awsCommand) {
    throw "AWS CLI is not installed or not available in PATH."
}

$deployArgs = @(
    "cloudformation", "deploy",
    "--template-file", $templatePath,
    "--stack-name", $StackName,
    "--capabilities", "CAPABILITY_NAMED_IAM",
    "--parameter-overrides",
    "UserName=$UserName",
    "BucketName=$BucketName"
)

if ($Region) {
    $deployArgs += @("--region", $Region)
}

Write-Host "Deploying stack '$StackName' with UserName='$UserName' and BucketName='$BucketName'..." -ForegroundColor Cyan
& aws @deployArgs

$describeArgs = @(
    "cloudformation", "describe-stacks",
    "--stack-name", $StackName,
    "--output", "json"
)

if ($Region) {
    $describeArgs += @("--region", $Region)
}

$stackDetailsJson = & aws @describeArgs
$stackDetails = $stackDetailsJson | ConvertFrom-Json
$outputs = $stackDetails.Stacks[0].Outputs

Write-Host ""
Write-Host "Stack Outputs:" -ForegroundColor Green

$keysToPrint = @(
    "BucketName",
    "BucketArn",
    "IamUserName",
    "AccessKeyId",
    "SecretAccessKey"
)

foreach ($key in $keysToPrint) {
    $output = $outputs | Where-Object { $_.OutputKey -eq $key }
    if ($output) {
        Write-Host ("{0}: {1}" -f $output.OutputKey, $output.OutputValue)
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
