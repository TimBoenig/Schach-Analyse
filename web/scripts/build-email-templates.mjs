// Builds the Supabase auth e-mail templates in supabase/email-templates/ from
// one layout, so all mails share the app's look (dark header, gold accent,
// serif headline). Run: node scripts/build-email-templates.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../supabase/email-templates/", import.meta.url));
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";
const GOLD = "#c9a45c";
// Keep in step with src/brand.ts (this script runs in plain Node, without the TS build).
const BRAND = "EndGameKing";
const SITE_URL = "https://endgameking.com";

const benefit = (title, text) => `
<tr><td style="padding:0 0 12px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td valign="top" style="padding:2px 12px 0 0;"><div style="width:22px;height:22px;border-radius:11px;background:#f5ecd8;color:#8a6a24;font:700 12px/22px ${SANS};text-align:center;">&#10003;</div></td>
<td style="font:14px/1.5 ${SANS};color:#3a3a3a;"><strong style="color:#14120e;">${title}</strong><br>${text}</td>
</tr></table>
</td></tr>`;

function mail({ title, preheader, lead, button, extra = "", note }) {
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f3f1ec;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr><td style="background:#0d0e11;padding:22px 30px;border-bottom:3px solid ${GOLD};">
<span style="font:24px/1 ${SERIF};color:${GOLD};">&#9818;</span>
<span style="font:22px/1 ${SERIF};color:#f4f1e8;letter-spacing:.3px;padding-left:8px;">${BRAND}</span>
</td></tr>
<tr><td style="padding:34px 30px 6px;">
<h1 style="margin:0 0 14px;font:400 30px/1.15 ${SERIF};color:#14120e;">${title}</h1>
<p style="margin:0 0 26px;font:15px/1.65 ${SANS};color:#3a3a3a;">${lead}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#0d0e11;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:15px 28px;font:600 15px ${SANS};color:#f4dca2;text-decoration:none;border-radius:999px;">${button}</a>
</td></tr></table>
${extra}
<p style="margin:24px 0 0;font:13px/1.6 ${SANS};color:#6b6b6b;">${note}</p>
</td></tr>
<tr><td style="padding:20px 30px 30px;">
<p style="margin:0;padding-top:16px;border-top:1px solid #ece8df;font:12px/1.6 ${SANS};color:#8a8a8a;">Funktioniert der Knopf nicht? Kopiere diesen Link in deinen Browser:<br><a href="{{ .ConfirmationURL }}" style="color:#6b6b6b;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
</td></tr>
</table>
<p style="margin:16px 0 0;font:12px/1.6 ${SANS};color:#9a9a9a;"><a href="${SITE_URL}" style="color:#9a9a9a;text-decoration:none;">${BRAND}.com</a> &middot; deine Partien, dein Profil, dein Training &middot; <a href="${SITE_URL}/#/rechtliches" style="color:#9a9a9a;">Impressum</a><br>Diese Mail wurde automatisch verschickt, weil jemand diese Adresse in der App eingegeben hat.</p>
</td></tr></table>
</body></html>
`;
}

const templates = {
  "confirm-signup.html": mail({
    title: "Willkommen! Bestätige deine E-Mail",
    preheader: "Ein Klick, dann sind deine Partien gesichert und auf jedem Gerät dabei.",
    lead: "Schön, dass du dabei bist! Bestätige kurz deine Adresse, dann ist dein Konto fertig und deine Partien werden gesichert.",
    button: "E-Mail bestätigen",
    extra: `<p style="margin:30px 0 12px;font:600 13px ${SANS};color:#8a6a24;text-transform:uppercase;letter-spacing:.8px;">Das bringt dir dein Konto</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${benefit("Nichts geht verloren", "Deine Partien und Analysen sind online gesichert.")}${benefit("Auf jedem Gerät", "PC, iPad und Handy zeigen dasselbe Profil und dieselben Statistiken.")}${benefit("Training läuft weiter", "Tagesplan und Fortschritt merken sich, wo du aufgehört hast.")}</table>`,
    note: "Du hast dich nicht registriert? Dann ignoriere diese Mail einfach, es wird kein Konto angelegt.",
  }),
  "magic-link.html": mail({
    title: "Dein Anmeldelink",
    preheader: "Ein Klick und du bist angemeldet, ganz ohne Passwort.",
    lead: `Tippe auf den Knopf und du bist bei ${BRAND} angemeldet. Der Link gilt eine Stunde und nur einmal.`,
    button: "Jetzt anmelden",
    note: "Du wolltest dich nicht anmelden? Dann ignoriere diese Mail einfach. Ohne den Link kommt niemand in dein Konto.",
  }),
  "reset-password.html": mail({
    title: "Neues Passwort festlegen",
    preheader: "Mit diesem Link legst du ein neues Passwort fest.",
    lead: "Du hast ein neues Passwort angefordert. Öffne den Link, dann kannst du in der App direkt ein neues festlegen. Der Link gilt eine Stunde.",
    button: "Neues Passwort festlegen",
    note: "Du hast nichts angefordert? Dann ignoriere diese Mail einfach, dein bisheriges Passwort bleibt gültig.",
  }),
  "change-email.html": mail({
    title: "Neue E-Mail-Adresse bestätigen",
    preheader: `Bestätige deine neue Adresse für ${BRAND}.`,
    lead: "Du möchtest dein Konto künftig mit <strong>{{ .NewEmail }}</strong> nutzen. Bestätige die Änderung mit einem Klick.",
    button: "Neue Adresse bestätigen",
    note: "Das warst du nicht? Dann ignoriere diese Mail, es ändert sich nichts.",
  }),
};

for (const [file, html] of Object.entries(templates)) writeFileSync(OUT + file, html);
console.log(`Wrote ${Object.keys(templates).length} templates to ${OUT}`);
