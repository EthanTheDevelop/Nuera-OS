import { z } from "@/lib/zod";
import { ValidationError } from "@/server/errors";

/** Valide une entrée non fiable ; lève une `ValidationError` portant les erreurs par champ. */
export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const { fieldErrors, formErrors } = z.flattenError(result.error);
    throw new ValidationError(
      formErrors[0] ?? "Certaines informations sont invalides.",
      fieldErrors as Record<string, string[] | undefined>,
    );
  }
  return result.data;
}
