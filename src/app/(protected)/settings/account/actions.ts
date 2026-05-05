"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 10) {
    redirect("/settings/account?error=Use%20at%20least%2010%20characters.");
  }

  if (password !== confirmPassword) {
    redirect("/settings/account?error=Passwords%20do%20not%20match.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(`/settings/account?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/settings/account?message=Password%20updated.");
}
