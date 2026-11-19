# Public Demo Deployment

This setup publishes a read-only demo on Render and stores its synthetic data in a separate MongoDB Atlas database. Never point the public demo at a database containing real assets, users, locations, or operational history.

## 1. Prepare MongoDB Atlas

1. Create a dedicated Atlas cluster and database for this demo.
2. Create a database user with access only to that demo database.
3. Allow the Render service's outbound IP addresses in the Atlas network access list.
4. Copy the Atlas connection string. Keep it private; do not commit it or paste it into chat.

## 2. Seed Synthetic Demo Data

Run this once from the project directory against the new, empty demo database. In PowerShell, provide the connection string and a unique password for the seeded accounts in your local environment, then seed:

```powershell
$env:NODE_ENV = 'development'
$env:MONGODB_URI = '<Atlas connection string>'
$env:DEMO_PASSWORD = '<unique random password>'
npm run seed
```

Remove those environment variables after the command completes. The public demo does not use account passwords: it selects the seeded `Management` account as a read-only viewer and disables the login endpoint. The password is still set uniquely so it is not left at the local demo default.

Do not run the seed command against an existing or real database. The seed script may reset incomplete demo datasets.

## 3. Deploy the Render Blueprint

1. Push this repository to a Git provider supported by Render.
2. In Render, create a new Blueprint and select this repository. Render reads `render.yaml` and provisions the web service.
3. When prompted, set `MONGODB_URI` to the dedicated Atlas connection string. Keep the generated `JWT_SECRET` private.
4. Wait for `/api/health` to pass and the deployment to become live.

Render assigns the public URL after deployment. Share that URL; it opens the synthetic demo without a login. The free service may sleep while idle, so the first request can take longer.

## Public Viewer Safeguards

- The backend forces every public request to the `Management` role, which is read-only, and rejects login attempts.
- Production startup requires `PUBLIC_DEMO_DATA_CONFIRMATION=synthetic-only` when public demo mode is enabled.
- `DEMO_SEED` stays disabled in the deployed service; seed only once from the local command above.
- Use a dedicated demo database. Do not import real inventory into it.
- If the service is changed from public demo mode to a normal authenticated deployment, rotate seeded user passwords first.
