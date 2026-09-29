"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { updatePassword } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MIN_LENGTH = 8;

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters long`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setIsSaving(true);
    try {
      const result = await updatePassword(currentPassword, newPassword);
      if (result?.error) {
        setError(result.error);
        toast.error("Could not update password", { description: result.error });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch {
      setError("An unexpected error occurred");
      toast.error("Could not update password");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="current-password" className="text-sm font-medium">
          Current password
        </label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={isSaving}
          required
        />
      </div>

      <div className="grid gap-2">
        <label htmlFor="new-password" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={isSaving}
          required
        />
        <p className="text-xs text-[var(--color-muted-foreground)]">
          At least {MIN_LENGTH} characters.
        </p>
      </div>

      <div className="grid gap-2">
        <label htmlFor="confirm-password" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={isSaving}
          required
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-[var(--color-destructive)]">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="animate-spin" />}
          {isSaving ? "Updating..." : "Update password"}
        </Button>
      </div>
    </form>
  );
}
