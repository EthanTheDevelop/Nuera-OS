"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadedDocument } from "../document.types";

export interface UploadFailure {
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Le stockage n'est pas configuré : « connexion requise ». */
  connectionRequired?: boolean;
}

/** Champs d'un nouveau document. Le serveur impose ce qui ne dépend pas d'un client du portail. */
export interface UploadTarget {
  title?: string;
  kind?: string;
  status?: string;
  visibility?: string;
  note?: string;
  companyId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  siteId?: string | null;
  ticketId?: string | null;
  quoteId?: string | null;
}

const UPLOAD_URL = "/api/documents/upload";

function buildUrl(
  base: string,
  file: File,
  fields: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams({ filename: file.name });
  for (const [key, value] of Object.entries(fields)) {
    if (value) params.set(key, value);
  }
  return `${base}?${params.toString()}`;
}

const NETWORK_ERROR: UploadFailure = {
  message: "Le dépôt a été interrompu. Vérifiez votre connexion et réessayez.",
};

/**
 * Envoie un fichier à la route de dépôt, en flux brut, et suit la progression. `XMLHttpRequest` et
 * non `fetch` : seul moyen de connaître la progression d'un envoi dans un navigateur.
 */
export function useFileUpload() {
  const [progress, setProgress] = useState<number | null>(null);
  const request = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const send = useCallback(
    (url: string, file: File) =>
      new Promise<UploadedDocument>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        request.current = xhr;
        xhr.open("POST", url);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.responseType = "json";
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onerror = () => {
          setProgress(null);
          reject(NETWORK_ERROR);
        };
        xhr.onabort = () => {
          setProgress(null);
          reject(NETWORK_ERROR);
        };
        xhr.onload = () => {
          setProgress(null);
          const body = xhr.response as {
            document?: UploadedDocument;
            error?: UploadFailure;
          } | null;
          if (xhr.status >= 200 && xhr.status < 300 && body?.document) resolve(body.document);
          else reject(body?.error ?? NETWORK_ERROR);
        };
        setProgress(0);
        xhr.send(file);
      }),
    [],
  );

  const uploadDocument = useCallback(
    (file: File, target: UploadTarget = {}) =>
      send(buildUrl(UPLOAD_URL, file, { ...target }), file),
    [send],
  );

  const uploadVersion = useCallback(
    (documentId: string, file: File, note?: string) =>
      send(buildUrl(`/api/documents/${documentId}/versions`, file, { note }), file),
    [send],
  );

  return { progress, uploading: progress !== null, uploadDocument, uploadVersion };
}
