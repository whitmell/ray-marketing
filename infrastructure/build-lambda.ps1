. (Join-Path $PSScriptRoot '_common.ps1')

Push-Location $ProjectRoot
try {
    npm run build:lambda
    if ($LASTEXITCODE -ne 0) { throw 'npm run build:lambda failed' }
    foreach ($name in 'api-handler', 'pipeline-handler') {
        $zip = "dist\$name.zip"
        if (Test-Path $zip) { Remove-Item $zip }
        $files = @("dist\$name.js")
        if (Test-Path "dist\$name.js.map") { $files += "dist\$name.js.map" }
        Compress-Archive -Path $files -DestinationPath $zip
        Write-Host "Created $zip"
    }
} finally {
    Pop-Location
}
