import { createAuthMiddleware } from "@better-auth/core/api";
import { APIError } from "@better-auth/core/error";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getSessionFromCtx } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { renderToStaticMarkup } from "react-dom/server";
import * as ConfigService from "@/features/config/service/config.service";
import { AuthEmail } from "@/features/email/templates/AuthEmail";
import {
  inspectApiKeyManagementAccess,
  isApiKeyManagementPath,
} from "@/lib/auth/api-key-guard";
import { createAuthConfig } from "@/lib/auth/auth.config";
import * as authSchema from "@/lib/db/schema/auth.table";
import { serverEnv } from "@/lib/env/server.env";
import { m } from "@/paraglide/messages";

async function checkEmailRateLimit(
  env: Env,
  scope: string,
  email: string,
): Promise<boolean> {
  const identifier = `${scope}:${email.toLowerCase().trim()}`;
  const id = env.RATE_LIMITER.idFromName(identifier);
  const rateLimiter = env.RATE_LIMITER.get(id);
  const result = await rateLimiter.checkLimit({
    capacity: 3,
    interval: "1h",
  });
  return result.allowed;
}

export function getAuth({ db, env }: { db: DB; env: Env }) {
  const {
    BETTER_AUTH_SECRET,
    BETTER_AUTH_URL,
    LOCALE,
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
  } = serverEnv(env);

  return betterAuth({
    ...createAuthConfig({ db, env }), // 👈 建议把 context 传给 createAuthConfig，方便后续扩展
    socialProviders: {
      github: {
        clientId: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          const email =
            typeof ctx.body?.email === "string" ? ctx.body.email.trim() : "";
          if (!email) return;

          // ⚠️ 注意：这里依然保留了“注册接口”的防刷限制。
          // 如果你发现无法注册，可能是这个限制生效了。测试时可以一并注释。
          const allowed = await checkEmailRateLimit(env, "email-signup", email);
          if (!allowed) {
            throw APIError.from("BAD_REQUEST", {
              code: "RATE_LIMITED",
              message: "Too many sign up attempts",
            });
          }
        }

        if (!isApiKeyManagementPath(ctx.path)) return;

        const headers = ctx.headers ?? ctx.request?.headers ?? null;
        const hasApiKeyHeader = Boolean(headers?.get("x-api-key"));
        let role: string | null = null;
        if (ctx.request && !hasApiKeyHeader) {
          const session = await getSessionFromCtx(ctx);
          const user = session?.user as { role?: string | null } | undefined;
          role = user?.role ?? null;
        }
        const denial = inspectApiKeyManagementAccess({
          path: ctx.path,
          headers,
          isHttpRequest: Boolean(ctx.request),
          role,
        });
        if (!denial.denied) return;

        throw APIError.from("FORBIDDEN", {
          code: denial.code,
          message:
            denial.code === "API_KEY_CANNOT_MANAGE_API_KEYS"
              ? "API keys cannot manage API keys"
              : "Only an Admin can manage API keys",
        });
      }),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        // 发送重置密码邮件（这里也建议先注释掉，方便你测试）
        const allowed = await checkEmailRateLimit(
          env,
          "email-reset",
          user.email,
        );
        if (!allowed) return;

        const systemConfig = await ConfigService.getSystemConfig({
          db,
          env,
          executionCtx: {
            waitUntil: () => {},
            passThroughOnException: () => {},
          } as unknown as ExecutionContext,
        });
        const emailSignature = systemConfig?.email?.emailSignature;

        const emailHtml = renderToStaticMarkup(
          AuthEmail({ locale: LOCALE, type: "reset-password", url, emailSignature }),
        );

        await env.QUEUE.send({
          type: "EMAIL",
          data: {
            to: user.email,
            subject: m.email_auth_reset_subject({}, { locale: LOCALE }),
            html: emailHtml,
          },
        });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        // 🛠️ 修改点：注释掉了这里的限流检查！
        // 之前的代码是：const allowed = await checkEmailRateLimit(env, "email-verify", user.email);
        // if (!allowed) return;
        // 这样的话，你测试时短时间注册的账号就不会因为被限流而收不到邮件了。
        
        // 注意：虽然解除了发信的限流，但注册接口(sign-up/email)的限流依然存在。
        // 如果注册本身被拦截了，也需要去 hooks.before 里注释掉 sign-up 的限流。

        const systemConfig = await ConfigService.getSystemConfig({
          db,
          env,
          executionCtx: {
            waitUntil: () => {},
            passThroughOnException: () => {},
          } as unknown as ExecutionContext,
        });
        const emailSignature = systemConfig?.email?.emailSignature;

        const emailHtml = renderToStaticMarkup(
          AuthEmail({ locale: LOCALE, type: "verification", url, emailSignature }),
        );

        await env.QUEUE.send({
          type: "EMAIL",
          data: {
            to: user.email,
            subject: m.email_auth_verification_subject({}, { locale: LOCALE }),
            html: emailHtml,
          },
        });
      },
      autoSignInAfterVerification: true,
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const existing = await db.query.user.findFirst({
              columns: { id: true },
            });
            if (!existing) {
              return { data: { ...user, role: "admin" } };
            }
            return { data: user };
          },
        },
      },
    },
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,
  });
}

export type Auth = ReturnType<typeof getAuth>;
export type Session = Auth["$Infer"]["Session"];