$pageToken = 'EAAfH5V3Eew8BS28ZBNFkCHT38AkVSv6bjNngOQ2QZCasEk9TZCwWCfuOKXJLhnMVJtHEtzQ7bkIAZCL3aJyqfknBdoXrCgSZCtAjtgR83CGr4LEFV57hcjnZA0VrxSS9jAN2lY48NuXJAqGgCsWwqCvYX4SQZBWHmPPXCTZBjtWlT8aZACLtg5qZBqF8o7l4Ypv0WKW94ZD'
if (-not $pageToken) {
    throw 'Set $pageToken to your Page access token first.'
}

$paths = @(
    '.\extras\comparison\englehard.json'
    '.\extras\comparison\elizabethII.json'
)

$fields = @(
    'id', 'created_time', 'message', 'permalink_url', 'application',
    'is_published', 'is_hidden', 'timeline_visibility',
    'targeting', 'feed_targeting', 'status_type', 'attachments'
)

# Read both IDs before changing either file. Also support re-running the script.
$posts = foreach ($path in $paths) {
    $content = (Get-Content -LiteralPath $path -Raw).Trim()
    if ($content.StartsWith('{')) {
        $id = (ConvertFrom-Json -InputObject $content).postId
    } else {
        $id = $content
    }

    if ($id -notmatch '^\d+_\d+$') {
        throw "Invalid Page post ID in $path"
    }

    [PSCustomObject]@{ path = $path; id = $id }
}

$results = foreach ($post in $posts) {
    $values = [ordered]@{}
    $missingFields = @()
    $errors = [ordered]@{}

    foreach ($field in $fields) {
        try {
            $response = Invoke-RestMethod `
                -Uri "https://graph.facebook.com/v26.0/$($post.id)?fields=$field" `
                -Headers @{ Authorization = "Bearer $pageToken" } `
                -ErrorAction Stop

            $property = $response.PSObject.Properties[$field]
            if ($null -ne $property) {
                $values[$field] = $property.Value
            } else {
                $missingFields += $field
            }
        } catch {
            $errors[$field] = $_.Exception.Message
        }
    }

    if ($errors.Count -eq $fields.Count) {
        throw "Every request failed for post $($post.id); no files were changed."
    }

    [PSCustomObject]@{
        path = $post.path
        data = [ordered]@{
            postId        = $post.id
            fields        = $values
            missingFields = $missingFields
            errors        = $errors
        }
    }
}

foreach ($result in $results) {
    $result.data | ConvertTo-Json -Depth 30 |
        Set-Content -LiteralPath $result.path -Encoding utf8
    Write-Host "Updated $($result.path)"
}