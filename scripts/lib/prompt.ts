/**
 * Saisie d'un secret dans le terminal sans écho à l'écran.
 * Hors terminal interactif (entrée redirigée), lit stdin une seule fois et renvoie
 * une ligne par appel (ex. mot de passe puis confirmation).
 */
let pipedLines: Promise<string[]> | undefined;
let pipedIndex = 0;

function readPipedLines(): Promise<string[]> {
  pipedLines ??= new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.split(/\r?\n/)));
    process.stdin.on("error", reject);
  });
  return pipedLines;
}

function readHiddenFromTty(): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Saisie annulée."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  if (process.stdin.isTTY) return readHiddenFromTty();
  const lines = await readPipedLines();
  process.stdout.write("\n");
  return lines[pipedIndex++] ?? "";
}
