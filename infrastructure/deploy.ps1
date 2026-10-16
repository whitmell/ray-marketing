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
& aws cognito-idp admin-get-user --user-pool-id $outputs.CognitoUserPoolId --username $env:COGNITO_USER_EMAIL *> $null
if ($LASTEXITCODE -ne 0) {
    $chars = (48..57) + (65..90) + (97..122)
    $temp = (-join ($chars | Get-Random -Count 16 | ForEach-Object { [char]$_ })) + '-Aa1!'
    Invoke-Aws cognito-idp admin-create-user --user-pool-id $outputs.CognitoUserPoolId --username $env:COGNITO_USER_EMAIL `
        --user-attributes "Name=email,Value=$($env:COGNITO_USER_EMAIL)" 'Name=email_verified,Value=true' `
        --temporary-password $temp --desired-delivery-mediums EMAIL | Out-Null
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
