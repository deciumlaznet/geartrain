# Geartrain web app

Server-rendered demo over the fake clients and the stand-in Xero, HMRC and
Companies House.

## Sign-in

Accounts are by invitation; there is no public sign-up. Set two secrets
(on Replit: Tools > Secrets):

| Secret | Value |
| --- | --- |
| `SESSION_SECRET` | At least 32 random characters, e.g. from `openssl rand -base64 48` |
| `GEARTRAIN_USERS` | A JSON array of invited users (below) |

Hash each password (12 characters or more) and paste the result into the user's entry:

```sh
echo 'correct horse battery staple' | pnpm --silent --filter @geartrain/web hash-password
```

```json
[
  { "email": "michael@geartrain.co.uk", "name": "Michael", "role": "staff", "clients": [], "passwordHash": "scrypt$16384$..." },
  { "email": "hannah@northgate-precision.example", "name": "Hannah Voss", "role": "client", "clients": ["northgate"], "passwordHash": "scrypt$16384$..." }
]
```

- `staff` sees every client, the expert queue and the audit trail.
- `client` sees only the clients listed in `clients` (keys: `fenwick`, `copperleaf`, `northgate`). Any other client returns "not found".

Sessions last eight hours. Five wrong passwords for an email lock it for fifteen
minutes. Every sign-in, failed sign-in, decision and upload goes in the audit trail
under the person's name. To remove someone, delete their entry and restart.

For local development over plain http, set `INSECURE_LOCAL_COOKIES=1`; never set it on Replit.
