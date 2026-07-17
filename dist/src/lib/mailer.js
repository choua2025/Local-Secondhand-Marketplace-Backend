"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMailTransport = setMailTransport;
exports.resetMailTransport = resetMailTransport;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
exports.initMailerFromEnv = initMailerFromEnv;
/**
 * Outbound email, with no mail provider behind it yet.
 *
 * There is one seam — `transport` — and everything else in the app goes through
 * it. The default writes the message to the console, which is what a developer
 * running `npm run dev` needs: the reset link is right there in the terminal.
 * Wiring a real provider later means writing one `Transport` and calling
 * `setMailTransport` at boot; nothing in authService changes.
 *
 * The same seam is what lets the tests read the token. They never scrape stdout
 * and they cannot read it from the database (only the hash is stored), so they
 * install a transport that captures the message. That is the honest way to test
 * a side effect: make it injectable rather than pretending it did not happen.
 */
require("dotenv/config");
const nodemailer_1 = __importDefault(require("nodemailer"));
const consoleTransport = (email) => {
    // Never in production: this line puts a live credential in the log stream.
    if (process.env.NODE_ENV === 'production') {
        console.warn(`[mailer] No transport configured — the reset email for ${email.to} was NOT sent.`);
        return;
    }
    console.log(`\n[mailer] Password reset for ${email.to}\n[mailer] ${email.resetUrl}\n` +
        `[mailer] (dev only — configure a real transport before production)\n`);
};
let transport = consoleTransport;
function setMailTransport(next) {
    transport = next;
}
function resetMailTransport() {
    transport = consoleTransport;
}
/**
 * The first entry in CLIENT_ORIGIN. That variable is a comma-separated list
 * because CORS must accept whichever port Vite settled on, but a link in an
 * email has to name exactly one origin — so the first is treated as canonical.
 */
function clientOrigin() {
    const origins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
    return origins[0] ?? 'http://localhost:5173';
}
async function sendPasswordResetEmail(to, token) {
    const resetUrl = `${clientOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
    await transport({ to, resetUrl, token });
}
/**
 * Wires a real SMTP transport from environment, if one is configured. Call once
 * at boot (see index.ts).
 *
 * SMTP rather than a specific provider's SDK, because every provider worth using
 * — SES, Postmark, Resend, Mailgun, even Gmail — speaks it. Set SMTP_HOST and
 * friends and reset emails start flowing; add nothing, and the console transport
 * from above stays in place (fine for dev, a no-send warning in production).
 *
 * This is the seam the security review pointed at: password reset does nothing
 * useful in production until a transport exists, and here is where it comes
 * from. It is deliberately not called from the app factory, so the test suite —
 * which installs its own capturing transport — is never touched by it.
 */
function initMailerFromEnv() {
    const host = process.env.SMTP_HOST;
    if (!host) {
        if (process.env.NODE_ENV === 'production') {
            console.warn('[mailer] SMTP_HOST is not set — password-reset emails will NOT be delivered. ' +
                'Configure SMTP_* in the environment to enable them.');
        }
        return; // Keep the console/no-send default transport.
    }
    const transporter = nodemailer_1.default.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        // true for port 465 (implicit TLS); false for 587 (STARTTLS upgrade).
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
            : undefined,
    });
    const from = process.env.MAIL_FROM ?? 'no-reply@localhost';
    setMailTransport(async ({ to, resetUrl }) => {
        await transporter.sendMail({
            from,
            to,
            subject: 'Reset your password',
            text: `Someone asked to reset the password for this account.\n\nReset it here (the link expires in an hour):\n${resetUrl}\n\nIf this wasn't you, ignore this email — nothing has changed.`,
            html: `<p>Someone asked to reset the password for this account.</p>` +
                `<p><a href="${resetUrl}">Reset your password</a> (the link expires in an hour).</p>` +
                `<p>If this wasn't you, ignore this email — nothing has changed.</p>`,
        });
    });
    console.log(`[mailer] SMTP transport configured via ${host}.`);
}
//# sourceMappingURL=mailer.js.map