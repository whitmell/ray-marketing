. (Join-Path $PSScriptRoot '_common.ps1')

$photos = if ($env:PHOTOS_BUCKET) { $env:PHOTOS_BUCKET } else { 'ray-faa-images' }
$outputs = Get-StackOutputs

Write-Host "This will empty and delete stack '$StackName', including its frontend and resources buckets."
Write-Host "WARNING: the photos bucket ($photos) is NOT emptied or deleted, but its CloudFront access policy will be removed."
$confirm = Read-Host 'Type the stack name to confirm'
if ($confirm -ne $StackName) { throw 'Confirmation did not match; aborting.' }

# Only these two buckets are emptied; the photos bucket is never touched.
foreach ($b in @($outputs.FrontendBucketName, $outputs.ResourcesBucketName)) {
    if (-not $b -or $b -eq $photos -or $b -eq 'ray-faa-images') { throw "Refusing to empty bucket '$b'" }
    Invoke-Aws s3 rm "s3://$b" --recursive
}
Invoke-Aws cloudformation delete-stack --stack-name $StackName
Invoke-Aws cloudformation wait stack-delete-complete --stack-name $StackName
Write-Host "Stack deleted. $photos (photos) was preserved, but its CloudFront OAC policy was removed with the stack."
