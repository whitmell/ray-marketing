. (Join-Path $PSScriptRoot '_common.ps1')

Push-Location $ProjectRoot
try {
    # Install Linux-specific sharp binary for Lambda (Amazon Linux = glibc, not musl)
    npm install --cpu=x64 --os=linux sharp
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install Linux sharp binary' }

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

        # Include sharp and its Linux native binaries (external from esbuild).
        # Only glibc variants — Lambda runs Amazon Linux, not musl/Alpine.
        Copy-Item -Recurse 'node_modules\sharp' "$staging\node_modules\sharp"
        New-Item -ItemType Directory -Path "$staging\node_modules\@img" | Out-Null
        Copy-Item -Recurse 'node_modules\@img\sharp-linux-x64' "$staging\node_modules\@img\sharp-linux-x64"
        Copy-Item -Recurse 'node_modules\@img\sharp-libvips-linux-x64' "$staging\node_modules\@img\sharp-libvips-linux-x64"
        if (Test-Path 'node_modules\@img\colour') {
            Copy-Item -Recurse 'node_modules\@img\colour' "$staging\node_modules\@img\colour"
        }

        Compress-Archive -Path "$staging\*" -DestinationPath $zip
        Remove-Item -Recurse -Force $staging

        $sizeMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)
        Write-Host "Created $zip ($sizeMB MB)"
    }

    # Restore local sharp binary for development
    npm install sharp 2>$null
} finally {
    Pop-Location
}
