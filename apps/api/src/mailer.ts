import { createTransport, type Transporter } from "nodemailer";
import type { Mailer } from "./auth.js";

/**
 * Sends sign-in links by SMTP (any provider: SES, Postmark, Mailgun, Gmail, a local relay).
 * SMTP_URL is e.g. smtps://user:pass@smtp.example.com:465 or smtp://user:pass@host:587
 * (STARTTLS is used when the server offers it). MAIL_FROM is the sender address.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
    private readonly site = "LineLab",
  ) {
    this.transport = createTransport(url);
  }

  async send(to: string, link: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to,
      subject: `Your ${this.site} sign-in link`,
      text: [
        `Sign in to ${this.site}:`,
        "",
        link,
        "",
        "The link works once and expires in 15 minutes.",
        "If you didn't ask to sign in, ignore this email.",
      ].join("\n"),
      html: `<p>Sign in to ${this.site}:</p><p><a href="${encodeURI(link)}">Sign in</a></p><p style="color:#666">The link works once and expires in 15 minutes. If you didn't ask to sign in, ignore this email.</p>`,
    });
  }

  /** Checks the connection and credentials (at startup), so a bad config shows up early. */
  verify(): Promise<true> {
    return this.transport.verify();
  }
}
