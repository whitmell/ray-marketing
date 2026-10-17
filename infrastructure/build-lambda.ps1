. (Join-Path $PSScriptRoot '_common.ps1')

Push-Location $ProjectRoot
try {
    npm run build:lambda
    if ($LASTEXITCODE -ne 0) { throw 'npm run build:lambda failed' }

    foreach ($name in 'api-handler', 'pipeline-handler') {
        $zip = "dist\$name.zip"
        if (Test-Path $zip) { Remove-Item $zip }

        # Stage files in a temp directory so the zip has the right structure
        $staging = "dist\staging-$name"
        if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
        New-Item -ItemType Directory -Path $staging | Out-Null

        Copy-Item "dist\$name.js" $staging
        if (Test-Path "dist\$name.js.map") { Copy-Item "dist\$name.js.map" $staging }

        # Install sharp with all dependencies for Linux Lambda runtime
        Push-Location $staging
        npm init -y 2>$null | Out-Null
        npm install --cpu=x64 --os=linux --production sharp 2>$null
        if ($LASTEXITCODE -ne 0) { throw "Failed to install sharp in staging for $name" }
        Remove-Item 'package.json', 'package-lock.json' -ErrorAction SilentlyContinue
        Pop-Location

        Compress-Archive -Path "$staging\*" -DestinationPath $zip
        Remove-Item -Recurse -Force $staging

        $sizeMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)
        Write-Host "Created $zip ($sizeMB MB)"
    }
} finally {
    Pop-Location
}
