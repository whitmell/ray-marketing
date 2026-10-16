. (Join-Path $PSScriptRoot '_common.ps1')

if (-not $env:HOSTED_ZONE_ID -or -not $env:COGNITO_USER_EMAIL) {
    throw 'HOSTED_ZONE_ID and COGNITO_USER_EMAIL must be set in .env'
}

& (Join-Path $PSScriptRoot 'build-lambda.ps1')

$overrides = @(
    "HostedZoneId=$($env:HOSTED_ZONE_ID)",
    "CognitoUserEmail=$($env:COGNITO_USER_EMAIL)"
)
# CloudFormation parameter -> .env variable (only passed when set)
$optional = [ordered]@{
    DomainName          = 'DOMAIN_NAME'
    PhotosBucket        = 'PHOTOS_BUCKET'
    ResourcesBucketName = 'RESOURCES_BUCKET'
    AnthropicApiKey     = 'ANTHROPIC_API_KEY'
    ClaudeModel         = 'CLAUDE_MODEL'
    OpenaiApiKey        = 'OPENAI_API_KEY'
    OpenaiModel         = 'OPENAI_MODEL'
    GeminiApiKey        = 'GEMINI_API_KEY'
    GeminiModel         = 'GEMINI_MODEL'
    MetaPageAccessToken = 'META_PAGE_ACCESS_TOKEN'
    FacebookPageId      = 'FACEBOOK_PAGE_ID'
    InstagramUserId     = 'INSTAGRAM_USER_ID'
    MetaApiVersion      = 'META_API_VERSION'
}
foreach ($p in $optional.GetEnumerator()) {
    $v = [System.Environment]::GetEnvironmentVariable($p.Value, 'Process')
    if ($v) { $overrides += "$($p.Key)=$v" }
}

# The template ships placeholder Lambda code; real code is pushed once the stack
# (and its resources bucket) exists. `deploy` blocks until the stack completes.
Invoke-Aws cloudformation deploy --stack-name $StackName `
    --template-file (Join-Path $PSScriptRoot 'template.yaml') `
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM `
    --parameter-overrides @overrides `
    --no-fail-on-empty-changeset

$outputs = Get-StackOutputs
Write-FrontendConfig $outputs
Publish-Lambdas $outputs

# Create the Cognito user if it does not exist yet
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& aws cognito-idp admin-get-user --user-pool-id $outputs.CognitoUserPoolId --username $env:COGNITO_USER_EMAIL *> $null
$userExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEAP
if (-not $userExists) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = [byte[]]::new(16)
    $rng.GetBytes($bytes)
    $temp = [Convert]::ToBase64String($bytes).Substring(0, 16) + '-Aa1!'
    & aws cognito-idp admin-create-user --user-pool-id $outputs.CognitoUserPoolId --username $env:COGNITO_USER_EMAIL `
        --user-attributes "Name=email,Value=$($env:COGNITO_USER_EMAIL)" 'Name=email_verified,Value=true' `
        --temporary-password $temp --desired-delivery-mediums EMAIL | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Cognito user' }
    Write-Host "Cognito user created; a temporary password was emailed to $($env:COGNITO_USER_EMAIL)."
} else {
    Write-Host 'Cognito user already exists.'
}

Publish-Frontend $outputs

Write-Host ''
Write-Host '=== Deploy complete ==='
Write-Host "URL:        https://$DomainName/"
Write-Host "CloudFront: $($outputs.CloudFrontDomainName)"
Write-Host "API:        $($outputs.ApiGatewayUrl)"
Write-Host 'Next: run upload-resources.ps1 and (once) seed-dynamodb.ps1'
