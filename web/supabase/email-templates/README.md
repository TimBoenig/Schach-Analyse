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


**Wichtig für die Zustellung:** Die Links in den Vorlagen führen auf
`{{ .SiteURL }}/#token_hash=…`, also auf die eigene Domain und nicht auf
`…supabase.co`. Ein Link, dessen Domain nicht zum Absender passt, ist ein
typisches Spam-Merkmal. Die App löst den Code selbst ein
(`redeemMailToken` in `src/storage/sync.ts`). Deshalb müssen die Vorlagen
nach diesem Update **neu eingefügt** werden, und „Site URL“ muss
`https://endgameking.com` sein.

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
4. In Resend → Domains → `endgameking.com`: Open- und Click-Tracking
   **ausschalten** (umgeschriebene Links und Zählpixel erhöhen das Spam-Risiko
   bei Bestätigungsmails).
5. DNS bei Cloudflare: neben SPF/DKIM von Resend einen DMARC-Eintrag setzen,
   Name `_dmarc`, Typ TXT, Wert `v=DMARC1; p=none; rua=mailto:support@endgameking.com`.
   Gmail und Outlook werten fehlendes DMARC als Mangel.
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
