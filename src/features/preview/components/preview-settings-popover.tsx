"use client";

import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { SettingsIcon } from "lucide-react";

import { useUpdateProjectSettings } from "@/features/projects/hooks/use-projects";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";

import { Doc, Id } from "../../../../convex/_generated/dataModel";

export const ENV_VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnvVariableValidationError {
  lineNumber: number;
  message: string;
}

export interface EnvVariableValidationResult {
  valid: boolean;
  errors: EnvVariableValidationError[];
  env: Record<string, string>;
}

export const validateEnvVariables = (text?: string): EnvVariableValidationResult => {
  if (!text) {
    return { valid: true, errors: [], env: {} };
  }

  const errors: EnvVariableValidationError[] = [];
  const env: Record<string, string> = {};
  const lines = text.split("\n");

  for (let idx = 0; idx < lines.length; idx++) {
    const originalLineNumber = idx + 1;
    const line = lines[idx];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      errors.push({
        lineNumber: originalLineNumber,
        message: `Line ${originalLineNumber}: Missing "=" separator.`,
      });
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();

    if (!key || !ENV_VAR_NAME_REGEX.test(key)) {
      errors.push({
        lineNumber: originalLineNumber,
        message: `Line ${originalLineNumber}: Invalid environment variable name "${key}".`,
      });
      continue;
    }

    env[key] = val;
  }

  return {
    valid: errors.length === 0,
    errors,
    env,
  };
};

export const parseEnvVariables = (text?: string): Record<string, string> => {
  const result = validateEnvVariables(text);
  if (!result.valid) {
    throw new Error(result.errors.map((e) => e.message).join("\n"));
  }
  return result.env;
};

export const formatEnvVariables = (env?: Record<string, string>): string => {
  if (!env) return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
};

const formSchema = z.object({
  installCommand: z.string(),
  devCommand: z.string(),
  envVariablesText: z.string().superRefine((val, ctx) => {
    const result = validateEnvVariables(val);
    if (!result.valid) {
      for (const err of result.errors) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err.message,
        });
      }
    }
  }),
});

interface PreviewSettingsPopoverProps {
  projectId: Id<"projects">;
  initialValues?: Doc<"projects">["settings"];
  onSave?: () => void;
}

export const PreviewSettingsPopover = ({
  projectId,
  initialValues,
  onSave,
}: PreviewSettingsPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const updateSettings = useUpdateProjectSettings();
  const previousProjectIdRef = useRef<Id<"projects"> | null>(null);
  const saveSequenceRef = useRef(0);
  const pendingSaveRef = useRef<number | null>(null);

  const getFormValues = () => ({
    installCommand: initialValues?.installCommand ?? "",
    devCommand: initialValues?.devCommand ?? "",
    envVariablesText: formatEnvVariables(initialValues?.envVariables),
  });

  const form = useForm({
    defaultValues: getFormValues(),
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      if (pendingSaveRef.current !== null) return;
      const result = validateEnvVariables(value.envVariablesText);
      if (!result.valid) {
        return;
      }

      const submittedProjectId = projectId;
      const requestId = ++saveSequenceRef.current;
      const submittedSettings = {
        installCommand: value.installCommand.trim() || undefined,
        devCommand: value.devCommand.trim() || undefined,
        envVariables: Object.keys(result.env).length > 0 ? { ...result.env } : undefined,
      };

      pendingSaveRef.current = requestId;
      setSaveError(null);
      try {
        await updateSettings({ id: submittedProjectId, settings: submittedSettings });
        if (pendingSaveRef.current === requestId && projectId === submittedProjectId) {
          setOpen(false);
          onSave?.();
        }
      } catch (error) {
        if (pendingSaveRef.current === requestId && projectId === submittedProjectId) {
          setSaveError(
            error instanceof Error && error.message.trim()
              ? error.message
              : "Unable to save preview settings. Please try again.",
          );
        }
      } finally {
        if (pendingSaveRef.current === requestId) pendingSaveRef.current = null;
      }
    },
  });

  useEffect(() => {
    if (previousProjectIdRef.current === null) {
      previousProjectIdRef.current = projectId;
      return;
    }
    if (previousProjectIdRef.current !== projectId) {
      previousProjectIdRef.current = projectId;
      saveSequenceRef.current += 1;
      pendingSaveRef.current = null;
      setSaveError(null);
      form.reset(getFormValues());
    }
  }, [form, initialValues?.devCommand, initialValues?.envVariables, initialValues?.installCommand, projectId]);

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      form.reset(getFormValues());
      setSaveError(null);
    }
    setOpen(isOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-full rounded-none"
          title="Preview settings"
        >
          <SettingsIcon className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-88" align="end">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <div className="space-y-4">
            <div className="space-y-1">
              <h4 className="font-medium text-sm">
                Preview Settings
              </h4>
              <p className="text-xs text-muted-foreground">
                Configure runtime commands and environment variables.
              </p>
            </div>
            <form.Field name="installCommand">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>
                    Install Command
                  </FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="npm install"
                  />
                  <FieldDescription>
                    Command to install dependencies (default: npm install)
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Field name="devCommand">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Start Command</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="npm run dev"
                  />
                  <FieldDescription>
                    Command to start the development server (default: npm run dev)
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Field name="envVariablesText">
              {(field) => {
                const isInvalid = !field.state.meta.isValid;

                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Environment Variables</FieldLabel>
                    <textarea
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      placeholder={"NODE_ENV=development\nPORT=3000"}
                      rows={3}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-y"
                    />
                    <FieldDescription>
                      KEY=VALUE pairs, one per line
                    </FieldDescription>
                    {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  size="sm"
                  className="w-full"
                  disabled={!canSubmit || isSubmitting}
                >
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </form.Subscribe>
            {saveError && (
              <p role="alert" className="text-xs text-destructive">
                {saveError}
              </p>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};
