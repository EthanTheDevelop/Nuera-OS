import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

export interface StubMail {
  from: string;
  to: string[];
  data: string;
}

/**
 * Faux serveur SMTP local, sans TLS ni authentification : éprouve l'adaptateur par une vraie
 * conversation SMTP. `rejectData` refuse le message, pour éprouver un échec d'envoi.
 */
export async function startSmtpStub(options: { rejectData?: () => boolean } = {}): Promise<{
  port: number;
  mails: StubMail[];
  close: () => Promise<void>;
}> {
  const mails: StubMail[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 stub ESMTP\r\n");
    let buffer = "";
    let inData = false;
    let data = "";
    let current: StubMail = { from: "", to: [], data: "" };

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            if (options.rejectData?.()) {
              socket.write("554 refusé\r\n");
            } else {
              mails.push({ ...current, data });
              socket.write("250 reçu\r\n");
            }
            data = "";
            current = { from: "", to: [], data: "" };
          } else {
            data += `${line}\n`;
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) socket.write("250 stub\r\n");
        else if (command.startsWith("MAIL FROM")) {
          current.from = line;
          socket.write("250 ok\r\n");
        } else if (command.startsWith("RCPT TO")) {
          current.to.push(line);
          socket.write("250 ok\r\n");
        } else if (command === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
        } else if (command === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("250 ok\r\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    mails,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
