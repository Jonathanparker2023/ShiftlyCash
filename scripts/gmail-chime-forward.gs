/**
 * Gmail → ShiftlyCash bridge for Chime transfer emails.
 *
 * Why this exists: Chime push notifications cover card purchases, but
 * transfers (someone sent you money, you sent money) come via email
 * instead. This script polls Gmail every minute, finds new Chime
 * transfer emails, and forwards them to the same ingest endpoint that
 * the Tasker push pipeline already uses.
 *
 * Setup:
 *   1. https://script.google.com → New project
 *   2. Paste this whole file into Code.gs (replace the default)
 *   3. Project Settings → Script Properties → add two keys:
 *        SHIFTLYCASH_INGEST_URL   = https://shiftlycash.vercel.app/api/chime/ingest
 *        SHIFTLYCASH_INGEST_KEY   = (paste the CHIME_INGEST_SECRET value)
 *   4. Run forwardOnce() manually first time → grant Gmail permission
 *   5. Triggers (clock icon) → Add Trigger
 *        function: forwardOnce, time-driven, minute timer, every minute
 */

// Adjust this if Chime's sender address differs in your inbox.
const CHIME_SENDER = 'no-reply@chime.com';

// Gmail label applied to messages once forwarded, so we never re-send.
const PROCESSED_LABEL = 'chime-forwarded';

function forwardOnce() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SHIFTLYCASH_INGEST_URL');
  const key = props.getProperty('SHIFTLYCASH_INGEST_KEY');

  if (!url || !key) {
    throw new Error(
      'Set SHIFTLYCASH_INGEST_URL and SHIFTLYCASH_INGEST_KEY in Script Properties first.',
    );
  }

  const label = getOrCreateLabel_(PROCESSED_LABEL);

  // Pull last hour of Chime mail that we have not forwarded yet.
  const threads = GmailApp.search(
    `from:${CHIME_SENDER} newer_than:1h -label:${PROCESSED_LABEL}`,
    0,
    20,
  );

  let sent = 0;
  let failed = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const msg of messages) {
      if (alreadyProcessed_(msg, label)) continue;

      const title = msg.getSubject() || '';
      const text = msg.getPlainBody() || msg.getBody() || '';
      const receivedAt = msg.getDate().toISOString();

      const payload = {
        title: title.slice(0, 240),
        text: text.slice(0, 4000),
        receivedAt,
        // Tagged into chime_raw_captures.source_meta so we can distinguish
        // email-forwarded transfers from Tasker push captures later.
        appBundle: 'gmail-chime-forward',
        shortcutVersion: 'apps-script-1',
      };

      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-chime-ingest-key': key },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      const code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        thread.addLabel(label);
        sent += 1;
      } else {
        console.error(
          'Ingest failed',
          code,
          response.getContentText().slice(0, 200),
        );
        failed += 1;
      }
    }
  }

  console.log(`Forwarded ${sent} new, ${failed} failed.`);
}

function alreadyProcessed_(msg, label) {
  const labels = msg.getThread().getLabels();
  return labels.some((l) => l.getName() === label.getName());
}

function getOrCreateLabel_(name) {
  const existing = GmailApp.getUserLabelByName(name);
  return existing || GmailApp.createLabel(name);
}
