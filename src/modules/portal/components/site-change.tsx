"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { CompactButton } from "@/components/ui/compact-button";
import { FormAlert, TextareaField } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { requestSiteChangeAction } from "../portal.actions";
import { usePortalForm } from "./use-portal-form";

/**
 * « Modifier mon site » (C7). Le client décrit l'élément à changer et sa nouvelle version ; la demande
 * arrive côté agence comme toute demande. L'édition directe sur le vrai site n'existe pas (figma-map
 * §8) : ce formulaire ne prétend pas la remplacer, il en garde le geste.
 */
export function SiteChangeRequest({ siteId }: { siteId: string }) {
  const router = useRouter();
  const toast = useToast();
  const preset = useMotionPreset();
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(true);
  const [state, formAction, pending] = usePortalForm(requestSiteChangeAction, (done) => {
    toast({ message: done.message, tone: "success" });
    form.current?.reset();
    setOpen(false);
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-4 lg:flex-1">
      <form ref={form} action={formAction} className="contents">
        <input type="hidden" name="siteId" value={siteId} />
        <div className="flex flex-col gap-4 rounded-lg bg-accent-pale p-4 sm:p-6 lg:flex-1 lg:items-center lg:justify-center">
          <div className="w-full max-w-[420px] rounded-md border-2 border-dashed border-accent bg-surface/60 transition-colors duration-(--dur-fast) hover:bg-surface lg:max-w-[640px]">
            <label htmlFor="site-change-current" className="sr-only">
              Le texte ou la photo à changer
            </label>
            <div className="flex items-start gap-2 px-3 py-2">
              <textarea
                id="site-change-current"
                name="current"
                rows={1}
                required
                onFocus={() => setOpen(true)}
                placeholder="Le texte ou la photo à changer"
                defaultValue={state.status === "error" ? state.values?.current : undefined}
                className="min-h-6 min-w-0 flex-1 resize-none bg-transparent text-sm font-semibold text-ink outline-none placeholder:font-medium placeholder:text-muted"
              />
              <Icon name="edit" size={16} className="mt-0.5 shrink-0 text-accent" />
            </div>
          </div>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.div
                key="bubble"
                initial={preset.message.initial}
                animate={preset.message.animate}
                exit={preset.leave}
                className="flex w-full max-w-[420px] flex-col gap-3 rounded-lg border border-border bg-surface p-5 lg:max-w-[640px]"
              >
                <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
                <TextareaField
                  name="next"
                  label="Votre nouvelle version"
                  state={state}
                  rows={3}
                  required
                />
                <div className="flex flex-wrap items-center gap-3">
                  <CompactButton type="submit" icon="send" loading={pending}>
                    Envoyer la demande
                  </CompactButton>
                  <CompactButton variant="quiet" onClick={() => setOpen(false)}>
                    Annuler
                  </CompactButton>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </form>
      {open ? null : (
        <div>
          <CompactButton
            variant="secondary"
            icon="edit"
            onClick={() => {
              setOpen(true);
              document.getElementById("site-change-current")?.focus();
            }}
          >
            Proposer un changement
          </CompactButton>
        </div>
      )}
    </div>
  );
}
