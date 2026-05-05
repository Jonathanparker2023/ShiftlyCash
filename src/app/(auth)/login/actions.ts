"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function signInWithPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const email = process.env.SHIFTLYCASH_LOGIN_EMAIL?.trim().toLowerCase();

  if (!email) {
    redirect(
      "/login?error=SHIFTLYCASH_LOGIN_EMAIL%20is%20not%20configured%20on%20the%20server.",
    );
  }

  if (!password) {
    redirect("/login?error=Enter%20your%20password.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect("/login?error=Password%20did%20not%20work.");
  }

  redirect("/");
}
