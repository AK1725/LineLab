import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { authConfigFromEnv } from "./auth.js";
import { SmtpMailer } from "./mailer.js";

/** A minimal SMTP server that accepts one message and keeps what it received. */
function fakeSmtp(): Promise<{
  server: Server;
  port: number;
  messages: { from: string; to: string[]; data: string }[];
}> {
  const messages: { from: string; to: string[]; data: string }[] = [];
  const server = createServer((sock) => {
    let buf = "";
    let inData = false;
    let cur = { from: "", to: [] as string[], data: "" };
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          cur.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          messages.push(cur);
          cur = { from: "", to: [], data: "" };
          sock.write("250 OK queued\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250-fake\r\n250 8BITMIME\r\n");
        else if (cmd === "MAIL") {
          cur.from = line;
          sock.write("250 OK\r\n");
        } else if (cmd === "RCPT") {
          cur.to.push(line);
          sock.write("250 OK\r\n");
        } else if (cmd === "DATA") {
          inData = true;
          sock.write("354 go\r\n");
        } else if (cmd === "QUIT") {
          sock.end("221 bye\r\n");
          return;
        } else sock.write("250 OK\r\n");
      }
    });
  });
  return new Promise((r) => {
    server.listen(0, "127.0.0.1", () => {
      r({ server, port: (server.address() as AddressInfo).port, messages });
    });
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("SMTP mailer", () => {
  it("sends the sign-in link to the address, from MAIL_FROM", async () => {
    const smtp = await fakeSmtp();
    servers.push(smtp.server);
    const m = new SmtpMailer(
      `smtp://127.0.0.1:${String(smtp.port)}?ignoreTLS=true`,
      "LineLab <login@linelab.test>",
    );
    await m.send(
      "ada@example.com",
      "http://web.test/api/auth/email/callback?token=abc&next=%2Fgallery",
    );
    expect(smtp.messages).toHaveLength(1);
    const msg = smtp.messages[0];
    expect(msg?.from).toContain("login@linelab.test");
    expect(msg?.to.join()).toContain("ada@example.com");
    expect(msg?.data).toContain("Subject: Your LineLab sign-in link");
    expect(msg?.data).toMatch(/token=3Dabc|token=abc/);
  });

  it("is chosen over the log mailer when SMTP_URL is set", () => {
    const base = { AUTH_SECRET: "s".repeat(40) };
    expect(
      authConfigFromEnv({ ...base, SMTP_URL: "smtp://localhost:2525" }, () => undefined)?.mailer,
    ).toBeInstanceOf(SmtpMailer);
    expect(
      authConfigFromEnv({ ...base, LINELAB_MAIL: "log" }, () => undefined)?.mailer,
    ).not.toBeInstanceOf(SmtpMailer);
    expect(authConfigFromEnv(base, () => undefined)?.mailer).toBeUndefined();
  });
});
