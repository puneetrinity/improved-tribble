// Public-form file field: success -> remove -> replace, and failure -> retry.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getPublicForm: vi.fn(), uploadPublicFile: vi.fn(), submitPublicForm: vi.fn() }));
vi.mock("@/lib/formsApi", () => ({ formsApi: api, isFormsApiError: () => false }));
vi.mock("wouter", () => ({ useRoute: () => [true, { token: "synthetic" }] }));
vi.mock("@/components/Footer", () => ({ default: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
import PublicFormPage from "@/pages/public-form-page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); vi.clearAllMocks(); });

async function mount() {
  api.getPublicForm.mockResolvedValue({ formName: "Synthetic", fields: [{ id: 1, label: "Resume", type: "file", required: true }] });
  api.submitPublicForm.mockResolvedValue({ success: true });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<PublicFormPage />)); await flush();
}
async function choose(name: string) {
  const input = host.querySelector("input[type=file]") as HTMLInputElement;
  expect(input).not.toBeNull();
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic"], name, { type: "application/pdf" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
}
const dropzone = () => host.querySelector('[role="button"]');
async function submit() {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush();
}

it("removing an uploaded file restores the empty picker, and a replacement submits", async () => {
  api.uploadPublicFile.mockResolvedValueOnce({ fileUrl: "synthetic://old", filename: "old.pdf", size: 9 })
    .mockResolvedValueOnce({ fileUrl: "synthetic://new", filename: "new.pdf", size: 9 });
  await mount(); await choose("old.pdf");
  const remove = Array.from(host.querySelectorAll("button")).find(b => b.querySelector("svg.lucide-x")) as HTMLButtonElement;
  await act(async () => { remove.click(); }); await flush();
  expect(host.textContent).not.toContain("old.pdf");
  expect(dropzone()).not.toBeNull();
  await choose("new.pdf");
  expect(host.textContent).toContain("new.pdf");
  await submit();
  expect(api.submitPublicForm).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(api.submitPublicForm.mock.calls[0])).toContain("synthetic://new");
  expect(JSON.stringify(api.submitPublicForm.mock.calls[0])).not.toContain("synthetic://old");
});

it("a failed upload shows the error, restores the picker, and a retry succeeds", async () => {
  api.uploadPublicFile.mockRejectedValueOnce(new Error("Synthetic unavailable"))
    .mockResolvedValueOnce({ fileUrl: "synthetic://cv", filename: "cv.pdf", size: 9 });
  await mount(); await choose("cv.pdf");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Upload failed: Synthetic unavailable");
  expect(dropzone()).not.toBeNull();
  expect(host.querySelector('button[aria-label="Remove cv.pdf"]')).toBeNull();
  await choose("cv.pdf");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await submit();
  expect(api.submitPublicForm).toHaveBeenCalledTimes(1);
});
