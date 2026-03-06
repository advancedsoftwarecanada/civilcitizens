# Civil Meeting RTC Service (Scaffold)

This service is a minimal RTC signaling/session issuer used by the Civil API.

## Endpoints
- `GET /health`
- `POST /v1/rooms/:roomId/sessions`
- `GET /v1/rooms/:roomId/state` (secret-gated debug state)
- `WS /v1/ws?token=<sessionToken>[&roomId=<roomId>]`

## Security
If `MEETING_RTC_SECRET` is set, requests must include:
- `x-meeting-rtc-secret: <MEETING_RTC_SECRET>`

## Notes
This is a signaling scaffold. It is intentionally lightweight and does not yet run full MediaSoup workers/transports.
For browser clients behind Civil nginx, proxy `/rtc/*` to this service so websocket URLs can stay same-origin.
