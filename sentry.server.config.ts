import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  enableLogs: true,
  includeLocalVariables: true,
  // Strip sensitive headers before sending to Sentry (PCI DSS compliance)
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization']
      delete event.request.headers['stripe-signature']
      delete event.request.headers['cookie']
    }
    return event
  },
});
