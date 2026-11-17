$ProjId = '9c43e373-9ce6-4d72-b797-23b941541a7f'
$base = 'http://127.0.0.1:3998'
'=== 1) state (契约别名 /zipx-api/project/<id>/state) ==='
curl.exe -s -o state.json -w "HTTP %{http_code}  bytes=%{size_download}  time=%{time_total}s`n" "$base/zipx-api/project/$ProjId/state"
(Get-Content state.json -Raw).Substring(0,220)
''
'=== 2) projects ==='
curl.exe -s -o projects.json -w "HTTP %{http_code}  bytes=%{size_download}`n" "$base/zipx-api/projects?page=1&page_size=3"
((Get-Content projects.json -Raw).Substring(0,200) -replace "[^\x20-\x7E]",".")
''
'=== 3) capabilities (尚未实现 -> 404 透传) ==='
curl.exe -s -o cap.json -w "HTTP %{http_code}  bytes=%{size_download}`n" "$base/zipx-api/capabilities"
Get-Content cap.json -Raw
''
'=== 4) media Range 0-99 (206 透传) ==='
$mediaUrl = "$base/zipx-api/files/download"
curl.exe -s -g -D media-headers.txt -o mediabytes.bin -w "HTTP %{http_code}  bytes=%{size_download}`n" -H "Range: bytes=0-99" --get --data-urlencode "file_path=/outputs/$ProjId/final_video_ai_edit.mp4" "$mediaUrl"
Get-Content media-headers.txt | Select-String -Pattern 'HTTP/|content-range|accept-ranges|content-length|content-type|x-zipx-proxy'
"first bytes: " + [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes("mediabytes.bin")[4..11])
''
'=== 5) 目录穿越被拒 ==='
curl.exe -s -o trav.json -w "HTTP %{http_code}  bytes=%{size_download}`n" "$base/zipx-api/..%2f..%2fetc/passwd"
Get-Content trav.json -Raw
Remove-Item state.json, projects.json, cap.json, media-headers.txt, mediabytes.bin, trav.json -ErrorAction SilentlyContinue