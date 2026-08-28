# Tracing Board ↔ Nextcloud setup

Tracing Board can keep its whole library in your Nextcloud so every device
reads the same content, while still caching everything locally for offline
use. (The folder — like the app's URL and repository — keeps the original
`AutoCue` name so existing setups never break.)

## Folder layout

```
AutoCue/
├── 01 - Installation/
│   ├── 01 - Opening Address.md
│   └── 02 - Address to the Brethren.md
├── 02 - First Degree/
│   └── 01 - Charge.md
└── Loose piece.md            ← files in the root show as “Unfiled”
```

- One folder per ceremony, one `.md` (or `.txt`) file per piece.
- A leading `01 - ` style number sets the running order and is hidden from display.
- Inside a piece: blank line = new paragraph, `[square brackets]` = stage
  direction (shown dim/italic, ignored by voice-follow).
- Create, rename, move, reorder and delete in any Nextcloud client; Tracing
  Board picks changes up on its next sync. Text edits made inside the app are
  saved straight back to the file.

## One-off server setup (CORS)

The app runs on `https://opcsdesign.github.io` and talks WebDAV directly to
your Nextcloud from the browser. Browsers block that cross-site traffic until
your server explicitly allows the app's origin. Two routes — pick one:

### Route A (preferred): the WebAppPassword app

1. Nextcloud → Apps → search **WebAppPassword** → install
   (source: <https://github.com/digital-blueprint/webapppassword>).
2. Admin settings → WebAppPassword → add allowed origin:
   `https://opcsdesign.github.io`
3. Alternatively add it to `config/config.php`:

```php
'webapppassword.origins' => ['https://opcsdesign.github.io'],
```

### Route B: CORS headers in the reverse proxy

Add to the server block / vhost that fronts Nextcloud. **nginx**:

```nginx
# Tracing Board browser access to WebDAV
location /remote.php/dav/ {
    if ($http_origin = "https://opcsdesign.github.io") {
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Methods "GET, PUT, PROPFIND, MKCOL, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Depth, If-Match, If-None-Match" always;
        add_header Access-Control-Expose-Headers "ETag" always;
        add_header Access-Control-Allow-Credentials "true" always;
    }
    if ($request_method = OPTIONS) { return 204; }
    # ... keep your existing proxy_pass / fastcgi config here ...
}
```

**Apache** (inside the Nextcloud vhost, `mod_headers` enabled):

```apache
<If "%{HTTP:Origin} == 'https://opcsdesign.github.io'">
    Header always set Access-Control-Allow-Origin "https://opcsdesign.github.io"
    Header always set Access-Control-Allow-Methods "GET, PUT, PROPFIND, MKCOL, OPTIONS"
    Header always set Access-Control-Allow-Headers "Authorization, Content-Type, Depth, If-Match, If-None-Match"
    Header always set Access-Control-Expose-Headers "ETag"
    Header always set Access-Control-Allow-Credentials "true"
</If>
RewriteEngine On
RewriteCond %{REQUEST_METHOD} OPTIONS
RewriteCond %{HTTP:Origin} =https://opcsdesign.github.io
RewriteRule ^remote\.php/dav/ - [R=204,L]
```

**Caddy**:

```caddy
@autocue_cors {
    path /remote.php/dav/*
    header Origin https://opcsdesign.github.io
}
header @autocue_cors {
    Access-Control-Allow-Origin "https://opcsdesign.github.io"
    Access-Control-Allow-Methods "GET, PUT, PROPFIND, MKCOL, OPTIONS"
    Access-Control-Allow-Headers "Authorization, Content-Type, Depth, If-Match, If-None-Match"
    Access-Control-Expose-Headers "ETag"
    Access-Control-Allow-Credentials "true"
}
@autocue_preflight {
    method OPTIONS
    path /remote.php/dav/*
    header Origin https://opcsdesign.github.io
}
respond @autocue_preflight 204
```

**Nginx Proxy Manager**: paste the nginx block above into the proxy host's
Advanced → Custom Nginx Configuration.

## Connecting a device

1. In Nextcloud: Settings → Security → Devices & sessions → create an **app
   password** (name it e.g. “Tracing Board phone”). One per device; revocable
   individually.
2. In Tracing Board: ☰ → ☁ Nextcloud → enter server address, username, app password →
   Connect.
3. First device with existing content: use **Upload** when offered — it
   creates the folder structure from your current library. Every other device
   just pulls.

## Troubleshooting

- **“Could not reach the server”** but Nextcloud works in a normal tab →
  almost always CORS. Open the browser dev-tools console; blocked requests say
  so explicitly. Re-check Route A/B.
- **Piece edits rejected (“changed on another device”)** → the file was
  modified elsewhere since this device last synced. Sync, then save again to
  overwrite deliberately.
- Sync is pull-based: it runs when the app opens and when ⟳ Sync is tapped.
