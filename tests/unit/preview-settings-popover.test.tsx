// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mockUpdateSettings = vi.fn();

vi.mock("@/features/projects/hooks/use-projects", () => ({
  useUpdateProjectSettings: () => mockUpdateSettings,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { PreviewSettingsPopover } from "@/features/preview/components/preview-settings-popover";

const projectOne = "project_one" as never;
const projectTwo = "project_two" as never;

const values = {
  installCommand: "npm install",
  devCommand: "npm run dev",
  envVariables: { NODE_ENV: "development" },
};

describe("PreviewSettingsPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSettings.mockResolvedValue(undefined);
  });

  const renderSettings = (projectId = projectOne, initialValues = values, onSave = vi.fn()) =>
    render(
      <PreviewSettingsPopover
        projectId={projectId}
        initialValues={initialValues}
        onSave={onSave}
      />,
    );

  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  it("saves all settings with the project identity captured at submission time", async () => {
    const onSave = vi.fn();
    renderSettings(projectOne, values, onSave);

    fireEvent.change(screen.getByLabelText("Install Command"), { target: { value: "pnpm install" } });
    fireEvent.change(screen.getByLabelText("Start Command"), { target: { value: "pnpm dev" } });
    fireEvent.change(screen.getByLabelText("Environment Variables"), { target: { value: "PORT=3000" } });
    submit();

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({
      id: projectOne,
      settings: {
        installCommand: "pnpm install",
        devCommand: "pnpm dev",
        envVariables: { PORT: "3000" },
      },
    }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("reinitializes values when the active project changes", () => {
    const { rerender } = renderSettings(projectOne, values);

    fireEvent.change(screen.getByLabelText("Install Command"), { target: { value: "custom install" } });
    rerender(
      <PreviewSettingsPopover
        projectId={projectTwo}
        initialValues={{ installCommand: "yarn install", devCommand: "yarn dev", envVariables: { PORT: "4000" } }}
      />,
    );

    expect(screen.getByLabelText("Install Command")).toHaveValue("yarn install");
    expect(screen.getByLabelText("Start Command")).toHaveValue("yarn dev");
    expect(screen.getByLabelText("Environment Variables")).toHaveValue("PORT=4000");
  });

  it("does not complete an old save into a newly active project", async () => {
    let resolveSave!: () => void;
    mockUpdateSettings.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const onSave = vi.fn();
    const { rerender } = renderSettings(projectOne, values, onSave);

    fireEvent.change(screen.getByLabelText("Install Command"), { target: { value: "old install" } });
    submit();
    rerender(
      <PreviewSettingsPopover
        projectId={projectTwo}
        initialValues={{ installCommand: "new install", devCommand: "new dev", envVariables: { APP: "two" } }}
        onSave={onSave}
      />,
    );

    await act(async () => resolveSave());
    expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ id: projectOne }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("prevents overlapping submissions while a save is pending", () => {
    mockUpdateSettings.mockReturnValue(new Promise(() => {}));
    renderSettings();

    submit();
    submit();

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("shows a failure and restores a usable form after a rejected save", async () => {
    mockUpdateSettings.mockRejectedValueOnce(new Error("Settings service unavailable"));
    renderSettings();

    submit();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Settings service unavailable"));
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
    expect(screen.getByLabelText("Install Command")).toHaveValue("npm install");
  });
});
