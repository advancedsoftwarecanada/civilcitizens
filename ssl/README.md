Development TLS assets for Civil Citizens origin hosts.

Files:
- uploads.civilcitizens.ca.crt: self-signed development certificate for uploads.civilcitizens.ca and uploads.dev.civilcitizens.ca
- uploads.civilcitizens.ca.key: matching private key
- uploads.civilcitizens.ca.openssl.cnf: OpenSSL config used to generate the certificate

Notes:
- This certificate is self-signed and intended only for the current dev-mode production server.
- If Cloudflare is used in front of the origin, use Full mode, not Full (strict), unless you replace this with a Cloudflare Origin CA or publicly trusted cert.
- Replace and rotate these files before full production rollout.
