. (Join-Path $PSScriptRoot '_common.ps1')

$bucket = (Get-StackOutputs).ResourcesBucketName
foreach ($f in 'descriptions.json', 'upload-progress.json', 'caption-prompt.md') {
    Invoke-Aws s3 cp (Join-Path $ProjectRoot "resources\$f") "s3://$bucket/$f"
}
Write-Host "Resources uploaded to s3://$bucket/"
