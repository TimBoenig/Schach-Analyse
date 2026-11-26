# Konto-E-Mails (Supabase Auth)

Supabase verschickt Bestätigungs- und Passwort-Mails selbst. Die Vorlagen
hier werden im Supabase-Dashboard eingefügt, sie werden nicht automatisch
übernommen.

## 1. URL-Konfiguration (behebt die Fehlermeldung beim Klick auf den Link)

Dashboard → Authentication → URL Configuration:

| Feld | Wert |
|---|---|
| Site URL | `https://endgameking.com` |
| Redirect URLs | `https://endgameking.com/**` |
| | `https://www.endgameking.com/**` |
| | `http://localhost:5173/**` (nur für lokale Entwicklung) |

Die App bittet Supabase, nach dem Klick zurück auf die eigene Adresse zu
leiten. Steht diese Adresse nicht in den Redirect URLs, nimmt Supabase die
Site URL, und die stand auf `http://localhost:3000`. Der Link landete dann
auf einer Seite, die es nicht gibt.

## 2. Vorlagen

Dashboard → Authentication → Emails → Templates. Für jede Vorlage Betreff
setzen und den Inhalt der HTML-Datei in „Message body“ einfügen:

| Vorlage | Betreff | Datei |
|---|---|---|
| Confirm signup | `Willkommen bei EndGameKing – bitte bestätigen` | `confirm-signup.html` |
| Reset Password | `Neues Passwort für EndGameKing` | `reset-password.html` |
| Magic Link | `Dein Anmeldelink für EndGameKing` | `magic-link.html` |
| Change Email Address | `Neue E-Mail-Adresse bestätigen` | `change-email.html` |


Die Links in den Vorlagen zeigen auf die eigene Domain
(`{{ .SiteURL }}/?token_hash=…&type=…`) statt auf `supabase.co`. Absender und
Link gehören dann zur selben Domain, das mögen Spamfilter, und die App tauscht
den Einmal-Code beim Öffnen selbst gegen die Anmeldung (`sync.ts`, `verifyOtp`).
**Erst die neue App-Version ausliefern, dann die Vorlagen einfügen.** Die
Site URL muss `https://endgameking.com` sein.

Die HTML-Dateien entstehen aus `web/scripts/build-email-templates.mjs`
(`node scripts/build-email-templates.mjs`); Änderungen bitte dort machen.

## 3. Eigener Mail-Versand (wichtig vor der Veröffentlichung)

Ohne eigenen Mailserver verschickt Supabase höchstens **2 Mails pro Stunde**
für das ganze Projekt, als Absender steht „Supabase Auth“, und die Mails landen
oft im Spam. Für echte Nutzer braucht es einen SMTP-Dienst, z. B. Resend
(3.000 Mails/Monat kostenlos):

1. Bei resend.com registrieren, eine eigene Domain hinzufügen und die DNS-Einträge
   (SPF, DKIM) setzen. Ohne eigene Domain geht es nur zu Testzwecken.
2. API-Key anlegen.
3. Supabase → Authentication → Emails → SMTP Settings → „Enable custom SMTP“:
   Host `smtp.resend.com`, Port `465`, User `resend`, Passwort = API-Key,
   Absender `EndGameKing <konto@endgameking.com>`.
4. **DMARC setzen** (fehlte am 2026-11-26): In Cloudflare → DNS einen TXT-Eintrag
   `_dmarc` mit dem Wert `v=DMARC1; p=none; rua=mailto:support@endgameking.com`
   anlegen. Gmail und Yahoo verlangen DMARC, ohne landen Mails eher im Spam.
   Nach 2 bis 4 Wochen ohne Fehlberichte auf `p=quarantine` erhöhen.
5. In Resend: „Click tracking“ und „Open tracking“ für die Domain ausschalten
   (verändern Links und Mail, schlecht für Zustellung).
6. Authentication → Rate Limits: „Emails sent per hour“ auf z. B. 100 erhöhen.

## 4. Konto selbst löschen

Den Knopf „Konto löschen“ gibt es in der App. Damit er das Konto wirklich
entfernt (und nicht nur die Online-Daten), einmal
`web/supabase/migrations/20261112_delete_account.sql` im SQL-Editor ausführen.

## 5. Postfach support@endgameking.com

Die Adresse steht im Impressum und in der Datenschutzerklärung, sie muss
also Mails empfangen können. Resend verschickt nur. Zum Empfangen in
Cloudflare → endgameking.com → Email → Email Routing einschalten und
`support@endgameking.com` an das eigene Postfach weiterleiten lassen
(kostenlos; Cloudflare setzt die MX-Einträge selbst).
