import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type BootstrapStatus = {
  profileReady: boolean;
  settingsReady: boolean;
  defaultTemplateReady: boolean;
  bootstrapAttempted: boolean;
  bootstrapError: string | null;
};

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  return { supabase, user };
}

export async function requireUserWithBootstrapStatus() {
  const { supabase, user } = await requireUser();
  let bootstrapAttempted = false;
  let bootstrapError: string | null = null;

  const readStatus = async (): Promise<BootstrapStatus> => {
    const [{ data: profile }, { data: settings }, { data: template }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id,email,display_name")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("settings")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("weekly_templates")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_default", true)
          .maybeSingle(),
      ]);

    return {
      profileReady: Boolean(profile),
      settingsReady: Boolean(settings),
      defaultTemplateReady: Boolean(template),
      bootstrapAttempted,
      bootstrapError,
    };
  };

  let status = await readStatus();

  if (!status.profileReady || !status.settingsReady || !status.defaultTemplateReady) {
    bootstrapAttempted = true;
    const { error } = await supabase.rpc("bootstrap_user_defaults", {
      p_user_id: user.id,
      p_email: user.email ?? null,
    });

    if (error) {
      bootstrapError = error.message;
    } else {
      status = await readStatus();
    }
  }

  return { supabase, user, status };
}
