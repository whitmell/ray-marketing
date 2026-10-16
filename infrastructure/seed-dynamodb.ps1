. (Join-Path $PSScriptRoot '_common.ps1')

$PostsTable = 'ray-marketing-posts'
$ConfigTable = 'ray-marketing-config'

function ConvertTo-DdbValue($v) {
    if ($null -eq $v) { return @{ NULL = $true } }
    if ($v -is [bool]) { return @{ BOOL = $v } }
    if ($v -is [string]) { return @{ S = $v } }
    if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]) {
        return @{ N = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '{0}', $v) }
    }
    if ($v -is [System.Collections.IEnumerable] -and $v -isnot [pscustomobject]) {
        return @{ L = @($v | ForEach-Object { ConvertTo-DdbValue $_ }) }
    }
    $m = @{}
    foreach ($p in $v.PSObject.Properties) { $m[$p.Name] = ConvertTo-DdbValue $p.Value }
    return @{ M = $m }
}

function ConvertTo-DdbItem($obj) {
    $item = @{}
    foreach ($p in $obj.PSObject.Properties) { $item[$p.Name] = ConvertTo-DdbValue $p.Value }
    return $item
}

# Writes already-typed DynamoDB items in groups of 25, retrying unprocessed items.
function Write-Batch($Table, $Items) {
    for ($i = 0; $i -lt $Items.Count; $i += 25) {
        $chunk = @($Items[$i..([Math]::Min($i + 24, $Items.Count - 1))])
        $requests = @($chunk | ForEach-Object { @{ PutRequest = @{ Item = $_ } } })
        for ($attempt = 0; $attempt -lt 5 -and $requests.Count -gt 0; $attempt++) {
            $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "ddb-batch-$([guid]::NewGuid()).json"
            try {
                (@{ $Table = $requests } | ConvertTo-Json -Depth 30) | Set-Content -Path $tmp -Encoding utf8
                $res = & aws dynamodb batch-write-item --request-items "file://$($tmp -replace '\\', '/')" --output json
                if ($LASTEXITCODE -ne 0) { throw 'batch-write-item failed' }
            } finally {
                Remove-Item $tmp -ErrorAction SilentlyContinue
            }
            $un = ($res | ConvertFrom-Json).UnprocessedItems
            $requests = @()
            if ($un.$Table) {
                $requests = @($un.$Table | ForEach-Object { @{ PutRequest = @{ Item = $_.PutRequest.Item } } })
                Start-Sleep -Seconds (2 * ($attempt + 1))
            }
        }
        if ($requests.Count -gt 0) { throw "Unprocessed items remain after retries for $Table" }
        Write-Host "Wrote $($chunk.Count) items to $Table"
    }
}

$posts = Get-Content (Join-Path $ProjectRoot 'data\posts.json') -Raw | ConvertFrom-Json
$items = @()
foreach ($post in $posts) {
    $isPosted = @($post.publishedTo).Count -gt 0
    $out = [ordered]@{}
    foreach ($p in $post.PSObject.Properties) {
        if ($p.Name -in 'notes', 'reviewedAt', 'status', 'caption') { continue }
        $out[$p.Name] = $p.Value
    }
    $out['status'] = if ($isPosted) { 'posted' } else { 'discarded' }
    $out['caption'] = if ($post.PSObject.Properties['caption']) { $post.caption } else { $null }
    if ($isPosted -and $post.PSObject.Properties['reviewedAt']) { $out['postedAt'] = $post.reviewedAt }
    $items += , (ConvertTo-DdbItem ([pscustomobject]$out))
}

Write-Host "Seeding $($items.Count) posts..."
if ($items.Count -gt 0) { Write-Batch $PostsTable $items }

$cfgItem = @{ key = @{ S = 'app' }; value = @{ M = @{ themeLookback = @{ N = '2' } } } }
Write-Batch $ConfigTable @($cfgItem)
Write-Host 'Seed complete.'
