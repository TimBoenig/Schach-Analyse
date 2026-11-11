# Konto-E-Mails (Supabase Auth)

Supabase verschickt Bestätigungs- und Passwort-Mails selbst. Die Vorlagen
hier werden im Supabase-Dashboard eingefügt, sie werden nicht automatisch
übernommen.

## 1. URL-Konfiguration (behebt die Fehlermeldung beim Klick auf den Link)

Dashboard → Authentication → URL Configuration:

| Feld | Wert |
|---|---|
| Site URL | `https://schach-analyse.vercel.app` |
| Redirect URLs | `https://schach-analyse.vercel.app/**` |
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
| Confirm signup | `Bestätige deine E-Mail-Adresse` | `confirm-signup.html` |
| Reset Password | `Neues Passwort für Schach-Analyse` | `reset-password.html` |
| Magic Link | `Dein Anmeldelink für Schach-Analyse` | `magic-link.html` |
| Change Email Address | `Neue E-Mail-Adresse bestätigen` | `change-email.html` |
