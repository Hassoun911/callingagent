# CallingAgent Security Audit Progress

## Completed in this branch

- Restrict credentialed CORS to configured application origins.
- Enforce company ownership on contact reads, creates, imports, updates, and deletes.
- Prevent company users from changing contact sharing or reassigning contacts.
- Add a centralized phone-number tenant guard for status, detail, update, delete, and test-call routes.
- Force newly provisioned numbers into the authenticated company scope.
- Prevent company users from transferring phone numbers between companies.
- Restrict existing Twilio-number imports to platform administrators until explicit company assignment is implemented.

## Next audit targets

1. Validate every Twilio webhook using `X-Twilio-Signature`.
2. Audit call logs and recording access for tenant isolation.
3. Audit SMS, campaigns, appointments, leads, companies, and billing routes.
4. Add login rate limiting and security event logging.
5. Add automated authorization and tenant-isolation tests.

## Required deployment configuration

Set one or both of the following environment variables:

- `APP_ORIGIN=https://your-production-domain.example`
- `CORS_ORIGINS=https://admin.example,https://portal.example`

Same-origin requests and requests without an `Origin` header remain accepted.
