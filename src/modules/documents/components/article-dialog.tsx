"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { KNOWLEDGE_KIND_LABELS, KNOWLEDGE_KINDS } from "@/lib/domain-enums";
import { withOption } from "../document.format";
import type { ArticleDetail, LinkOption } from "../document.types";
import { loadArticleLinkOptionsAction, saveArticleAction } from "../knowledge.actions";

function ArticleForm({ article, onClose }: { article?: ArticleDetail; onClose: () => void }) {
  const [state, action] = useActionState(saveArticleAction, IDLE_ACTION_STATE);
  const [options, setOptions] = useState<{ sites: LinkOption[]; projects: LinkOption[] }>({
    sites: [],
    projects: [],
  });
  const [loading, startLoading] = useTransition();
  // Le lien en place reste proposé, même archivé : l'enregistrer ne doit pas l'effacer.
  const sites = withOption(options.sites, article?.siteId, article?.siteName);
  const projects = withOption(options.projects, article?.projectId, article?.projectNumber);

  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  useEffect(() => {
    startLoading(async () => {
      const loaded = await loadArticleLinkOptionsAction();
      if (loaded) setOptions(loaded);
    });
  }, []);

  return (
    <form action={action} className="contents">
      {article ? (
        <>
          <input type="hidden" name="id" value={article.id} />
          <input type="hidden" name="expectedVersion" value={article.version} />
        </>
      ) : null}
      <ModalRow>
        <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
      </ModalRow>
      <ModalRow className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          state={state}
          id="article-title"
          name="title"
          label="Titre"
          required
          data-autofocus
          defaultValue={article?.title}
          fieldClassName="sm:col-span-2"
        />
        <SelectField
          state={state}
          id="article-kind"
          name="kind"
          label="Type"
          defaultValue={article?.kind ?? "internal"}
          fieldClassName="sm:col-span-2"
        >
          {KNOWLEDGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KNOWLEDGE_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`site-${sites.length}`}
          state={state}
          id="article-site"
          name="siteId"
          label="Site lié"
          disabled={loading}
          defaultValue={article?.siteId ?? ""}
        >
          <option value="">Aucun</option>
          {sites.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          key={`project-${projects.length}`}
          state={state}
          id="article-project"
          name="projectId"
          label="Projet lié"
          disabled={loading}
          defaultValue={article?.projectId ?? ""}
        >
          <option value="">Aucun</option>
          {projects.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <TextareaField
          state={state}
          id="article-body"
          name="body"
          label="Contenu"
          rows={10}
          required
          defaultValue={article?.body}
          hint={article ? "Un nouveau contenu crée une nouvelle version." : undefined}
          fieldClassName="sm:col-span-2"
        />
      </ModalRow>
      {/* Un champ désactivé n'est pas envoyé : pendant le chargement, les valeurs restent. */}
      {loading ? (
        <>
          <input type="hidden" name="siteId" value={article?.siteId ?? ""} />
          <input type="hidden" name="projectId" value={article?.projectId ?? ""} />
        </>
      ) : null}
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <SubmitButton>{article ? "Enregistrer" : "Créer l'article"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

export function ArticleDialog({
  open,
  onClose,
  article,
}: {
  open: boolean;
  onClose: () => void;
  article?: ArticleDetail;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={article ? "Modifier l'article" : "Nouvel article"}
      icon="book"
      width={640}
    >
      {open ? <ArticleForm article={article} onClose={onClose} /> : null}
    </Modal>
  );
}
